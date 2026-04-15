const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

let mainWindow = null;
let bootWindow = null;
let prologProcess = null;
let isCollectingResponse = false;
let currentResponseLines = [];
let responseQueue = [];
let spriteSyncPromise = null;
let bootStatusMessage = 'Inicializando...';
let cachedSpriteSignature = null;
let cachedSprites = null;

const MIN_SPRITE_FILE_COUNT = 20;

function getRepoRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'runtime');
  }
  return path.resolve(__dirname, '..');
}

function getBridgePath() {
  if (app.isPackaged) {
    return path.join(getRepoRoot(), 'gui', 'prolog_bridge.pl');
  }
  return path.join(__dirname, 'prolog_bridge.pl');
}

function getLocalUserBaseDir() {
  const localBase = process.env.LOCALAPPDATA || process.env.APPDATA;
  if (localBase) {
    return path.join(localBase, 'PokedexChatbot');
  }
  return path.join(app.getPath('userData'), 'PokedexChatbot');
}

function resolveNodeCommand() {
  const userBaseDir = getLocalUserBaseDir();
  const localAppData = process.env.LOCALAPPDATA;

  const scoopNode = localAppData
    ? path.join(localAppData, 'scoop', 'apps', 'nodejs-lts', 'current', 'node.exe')
    : null;
  if (scoopNode && fs.existsSync(scoopNode)) {
    return scoopNode;
  }

  const portableNode = path.join(userBaseDir, 'portable', 'node', 'node.exe');
  if (fs.existsSync(portableNode)) {
    return portableNode;
  }

  return 'node';
}

function resolveSwiplCommand() {
  const userBaseDir = getLocalUserBaseDir();
  const localAppData = process.env.LOCALAPPDATA;

  const scoopSwipl = localAppData
    ? path.join(localAppData, 'scoop', 'apps', 'swipl', 'current', 'bin', 'swipl.exe')
    : null;
  if (scoopSwipl && fs.existsSync(scoopSwipl)) {
    return scoopSwipl;
  }

  const portableSwipl = path.join(userBaseDir, 'portable', 'swipl', 'bin', 'swipl.exe');
  if (fs.existsSync(portableSwipl)) {
    return portableSwipl;
  }

  return 'swipl';
}

function getSpriteDir() {
  const userBaseDir = getLocalUserBaseDir();
  if (userBaseDir) {
    return path.join(userBaseDir, 'sprites');
  }
  return path.join(getRepoRoot(), '.local_cache', 'sprites');
}

function getSpriteManifestPath() {
  return path.join(getSpriteDir(), 'sprite_manifest.json');
}

function getSpriteSyncScriptPath() {
  return path.join(getRepoRoot(), 'tools', 'sync_home_sprites.js');
}

function setBootStatus(message) {
  bootStatusMessage = String(message || 'Inicializando...');
  if (bootWindow && !bootWindow.isDestroyed()) {
    bootWindow.webContents.send('boot:status', bootStatusMessage);
  }
}

function hardenWebContents(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
    }
  });
}

function createBootWindow() {
  bootWindow = new BrowserWindow({
    width: 540,
    height: 320,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    center: true,
    autoHideMenuBar: true,
    backgroundColor: '#111827',
    webPreferences: {
      preload: path.join(__dirname, 'boot_preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  hardenWebContents(bootWindow.webContents);
  bootWindow.loadFile(path.join(__dirname, 'public', 'boot.html'));

  bootWindow.once('ready-to-show', () => {
    if (!bootWindow || bootWindow.isDestroyed()) {
      return;
    }
    bootWindow.show();
    setBootStatus(bootStatusMessage);
  });

  bootWindow.on('closed', () => {
    bootWindow = null;
  });
}

function parseSpriteIdentity(fileName) {
  const baseName = path.parse(fileName).name;
  if (baseName.endsWith('_shiny')) {
    return { id: baseName.slice(0, -6), variant: 'shiny' };
  }
  if (baseName.endsWith('-shiny')) {
    return { id: baseName.slice(0, -6), variant: 'shiny' };
  }
  return { id: baseName, variant: 'normal' };
}

function getSpriteDirectorySignature(spriteDir) {
  if (!fs.existsSync(spriteDir)) {
    return 'missing';
  }

  const dirStat = fs.statSync(spriteDir);
  const manifestPath = getSpriteManifestPath();
  const manifestStat = fs.existsSync(manifestPath) ? fs.statSync(manifestPath) : null;
  return `${dirStat.mtimeMs}:${manifestStat ? manifestStat.mtimeMs : 0}`;
}

function normalizeOutput(text) {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  return normalized || 'Bot: Sem resposta.';
}

function parseBridgeJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Resposta JSON inválida do bridge: ${error.message}`);
  }
}

function settleNextResponse(value) {
  const next = responseQueue.shift();
  if (!next) {
    return;
  }
  clearTimeout(next.timeoutId);
  next.resolve(value);
}

function rejectNextResponse(error) {
  const next = responseQueue.shift();
  if (!next) {
    return;
  }
  clearTimeout(next.timeoutId);
  next.reject(error);
}

function handlePrologStdout(chunk) {
  const text = chunk.toString('utf8');
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    if (line.includes('[[BOT_RESPONSE_BEGIN]]')) {
      isCollectingResponse = true;
      currentResponseLines = [];
      continue;
    }

    if (line.includes('[[BOT_RESPONSE_END]]')) {
      isCollectingResponse = false;
      const payload = normalizeOutput(currentResponseLines.join('\n'));
      currentResponseLines = [];
      settleNextResponse(payload);
      continue;
    }

    if (isCollectingResponse) {
      currentResponseLines.push(line);
    }
  }
}

function handlePrologStderr(chunk) {
  const text = chunk.toString('utf8').trim();
  if (!text) {
    return;
  }
  if (responseQueue.length > 0) {
    rejectNextResponse(new Error(text));
  }
}

function killProlog() {
  if (!prologProcess) {
    return;
  }
  prologProcess.kill();
  prologProcess = null;
}

function startProlog() {
  if (prologProcess) {
    return;
  }

  const repoRoot = getRepoRoot();
  const bridgePath = getBridgePath();
  const swiplCommand = resolveSwiplCommand();

  if (!fs.existsSync(bridgePath)) {
    throw new Error(`Bridge Prolog não encontrado em: ${bridgePath}`);
  }

  prologProcess = spawn(swiplCommand, ['-q', '-s', bridgePath], {
    cwd: repoRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });

  prologProcess.stdout.on('data', handlePrologStdout);
  prologProcess.stderr.on('data', handlePrologStderr);

  prologProcess.on('error', (error) => {
    while (responseQueue.length > 0) {
      rejectNextResponse(error);
    }
  });

  prologProcess.on('exit', () => {
    prologProcess = null;
    while (responseQueue.length > 0) {
      rejectNextResponse(new Error('Processo Prolog foi encerrado.'));
    }
  });
}

function sendBridgeCommand(command, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    if (!prologProcess || !prologProcess.stdin.writable) {
      reject(new Error('Bridge Prolog não está disponível.'));
      return;
    }

    const timeoutId = setTimeout(() => {
      rejectNextResponse(new Error('Tempo esgotado aguardando resposta do bot.'));
    }, timeoutMs);

    responseQueue.push({ resolve, reject, timeoutId });
    prologProcess.stdin.write(`${command}\n`);
  });
}

async function askBot(prompt) {
  const text = (prompt || '').trim();
  if (!text) {
    return 'Bot: Digite uma mensagem antes de enviar.';
  }
  return sendBridgeCommand(text, 30000);
}

async function fetchPokedexList() {
  const payload = await sendBridgeCommand('__POKEDEX_LIST_JSON__', 45000);
  return parseBridgeJson(payload);
}

async function fetchPokedexDetail(identifier) {
  const safeIdentifier = String(identifier || '').trim();
  if (!safeIdentifier) {
    throw new Error('Identificador de Pokémon inválido.');
  }
  const payload = await sendBridgeCommand(`__POKEDEX_DETAIL_JSON__:${safeIdentifier}`, 45000);
  return parseBridgeJson(payload);
}

function countLocalSpriteFiles(spriteDir = getSpriteDir()) {
  if (!fs.existsSync(spriteDir)) {
    return 0;
  }

  return fs.readdirSync(spriteDir)
    .filter((name) => /\.(png|jpg|jpeg|webp)$/i.test(name))
    .length;
}

function readSpriteManifest() {
  const manifestPath = getSpriteManifestPath();
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    console.warn(`[sprites] Falha ao ler manifesto: ${error.message}`);
    return null;
  }
}

function resolveExpectedSpriteCount(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    return null;
  }

  if (manifest.totals && Number.isFinite(manifest.totals.files)) {
    return manifest.totals.files;
  }

  if (manifest.sprites && typeof manifest.sprites === 'object') {
    let files = 0;
    for (const sprite of Object.values(manifest.sprites)) {
      if (!sprite || typeof sprite !== 'object') {
        continue;
      }
      if (sprite.normal) {
        files += 1;
      }
      if (sprite.shiny) {
        files += 1;
      }
    }
    if (files > 0) {
      return files;
    }
  }

  if (manifest.counters && Number.isFinite(manifest.counters.written)) {
    return manifest.counters.written;
  }

  if (manifest.map && typeof manifest.map === 'object') {
    return Object.keys(manifest.map).length;
  }

  return null;
}

function evaluateSpriteCache() {
  const spriteDir = getSpriteDir();
  const imageCount = countLocalSpriteFiles(spriteDir);

  if (!fs.existsSync(spriteDir) || imageCount === 0) {
    return { needsSync: true, reason: 'cache local inexistente ou vazio' };
  }

  const manifest = readSpriteManifest();
  if (!manifest) {
    if (imageCount < MIN_SPRITE_FILE_COUNT) {
      return { needsSync: true, reason: 'manifesto ausente e cache pequeno' };
    }
    return { needsSync: false, reason: `cache sem manifesto (${imageCount} arquivos)` };
  }

  const expectedCount = resolveExpectedSpriteCount(manifest);
  if (Number.isFinite(expectedCount) && expectedCount > imageCount) {
    return { needsSync: true, reason: `sprites incompletos (${imageCount}/${expectedCount})` };
  }

  if (imageCount < MIN_SPRITE_FILE_COUNT) {
    return { needsSync: true, reason: 'cache abaixo do mínimo esperado' };
  }

  return { needsSync: false, reason: `cache de sprites válido (${imageCount} arquivos)` };
}

function runSpriteSync(reason) {
  return new Promise((resolve) => {
    const scriptPath = getSpriteSyncScriptPath();
    const spriteDir = getSpriteDir();
    const nodeCommand = resolveNodeCommand();

    if (!fs.existsSync(scriptPath)) {
      console.warn(`[sprites] Script de sincronizacao nao encontrado: ${scriptPath}`);
      resolve(false);
      return;
    }

    fs.mkdirSync(spriteDir, { recursive: true });

    console.log(`[sprites] Iniciando sincronizacao (${reason}) em ${spriteDir}`);
    const syncProcess = spawn(nodeCommand, [scriptPath, '--force', `--output-dir=${spriteDir}`], {
      cwd: getRepoRoot(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    syncProcess.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8').trim();
      if (text) {
        console.log(`[sprites] ${text}`);
      }
    });

    syncProcess.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8').trim();
      if (text) {
        console.warn(`[sprites] ${text}`);
      }
    });

    syncProcess.on('error', (error) => {
      console.error(`[sprites] Falha ao iniciar sincronizacao: ${error.message}`);
      resolve(false);
    });

    syncProcess.on('exit', (code) => {
      if (code === 0) {
        cachedSpriteSignature = null;
        cachedSprites = null;
        console.log('[sprites] Sincronizacao finalizada com sucesso.');
        resolve(true);
        return;
      }

      console.warn(`[sprites] Sincronizacao finalizou com codigo ${code}.`);
      resolve(false);
    });
  });
}

function ensureSpriteCatalog() {
  const cacheStatus = evaluateSpriteCache();
  if (!cacheStatus.needsSync) {
    console.log(`[sprites] ${cacheStatus.reason}`);
    return Promise.resolve(false);
  }

  if (!spriteSyncPromise) {
    spriteSyncPromise = runSpriteSync(cacheStatus.reason)
      .catch((error) => {
        console.error(`[sprites] Erro inesperado na sincronizacao: ${error.message}`);
        return false;
      })
      .finally(() => {
        spriteSyncPromise = null;
      });
  }

  return spriteSyncPromise;
}

function getLocalSprites() {
  const spriteDir = getSpriteDir();
  if (!fs.existsSync(spriteDir)) {
    cachedSpriteSignature = 'missing';
    cachedSprites = [];
    return [];
  }

  const signature = getSpriteDirectorySignature(spriteDir);
  if (cachedSprites && cachedSpriteSignature === signature) {
    return cachedSprites;
  }

  const files = fs.readdirSync(spriteDir)
    .filter((name) => /\.(png|jpg|jpeg|webp)$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  const parsed = files.map((name) => {
    const absolutePath = path.join(spriteDir, name);
    const { id, variant } = parseSpriteIdentity(name);
    return {
      id,
      name: id.replace(/[_-]/g, ' '),
      variant,
      url: pathToFileURL(absolutePath).href
    };
  });

  cachedSpriteSignature = signature;
  cachedSprites = parsed;
  return parsed;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1120,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f4e4b0',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  hardenWebContents(mainWindow.webContents);

  mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
    if (bootWindow && !bootWindow.isDestroyed()) {
      bootWindow.close();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('bot:ask', async (_event, prompt) => {
  return askBot(prompt);
});

ipcMain.handle('bot:reset', async () => {
  return sendBridgeCommand('__RESET__', 10000);
});

ipcMain.handle('bot:ping', async () => {
  return sendBridgeCommand('__PING__', 10000);
});

ipcMain.handle('sprites:list', async () => {
  const sprites = getLocalSprites();
  if (sprites.length > 0) {
    return sprites;
  }

  await ensureSpriteCatalog();
  return getLocalSprites();
});

ipcMain.handle('pokedex:list', async () => {
  return fetchPokedexList();
});

ipcMain.handle('pokedex:detail', async (_event, identifier) => {
  return fetchPokedexDetail(identifier);
});

ipcMain.on('boot:ready', () => {
  setBootStatus(bootStatusMessage);
});

app.whenReady().then(async () => {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });
  });

  if (session.defaultSession) {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
  }

  createBootWindow();

  setBootStatus('Validando cache local de sprites...');
  await ensureSpriteCatalog();

  setBootStatus('Inicializando motor Prolog...');
  startProlog();

  setBootStatus('Carregando interface principal...');
  createMainWindow();

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createMainWindow();
    }
  });
}).catch((error) => {
  console.error(`[boot] Falha na inicializacao: ${error.message}`);
  setBootStatus(`Falha na inicializacao: ${error.message}`);
});

app.on('before-quit', () => {
  if (bootWindow && !bootWindow.isDestroyed()) {
    bootWindow.close();
  }
  killProlog();
});

app.on('window-all-closed', () => {
  killProlog();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
