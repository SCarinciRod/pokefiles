const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

let mainWindow = null;
let prologProcess = null;
let isCollectingResponse = false;
let currentResponseLines = [];
let responseQueue = [];

function getRepoRoot() {
  return path.resolve(__dirname, '..');
}

function getBridgePath() {
  return path.join(__dirname, 'prolog_bridge.pl');
}

function getSpriteDir() {
  return path.join(getRepoRoot(), 'temp_sprites');
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

  prologProcess = spawn('swipl', ['-q', '-s', bridgePath], {
    cwd: repoRoot,
    stdio: ['pipe', 'pipe', 'pipe']
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

function getLocalSprites() {
  const spriteDir = getSpriteDir();
  if (!fs.existsSync(spriteDir)) {
    return [];
  }

  const files = fs.readdirSync(spriteDir)
    .filter((name) => /\.(png|jpg|jpeg|webp)$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  return files.map((name) => {
    const absolutePath = path.join(spriteDir, name);
    const { id, variant } = parseSpriteIdentity(name);
    return {
      id,
      name: id.replace(/[_-]/g, ' '),
      variant,
      url: pathToFileURL(absolutePath).href
    };
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1120,
    minHeight: 700,
    backgroundColor: '#f4e4b0',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'));

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
  return getLocalSprites();
});

ipcMain.handle('pokedex:list', async () => {
  return fetchPokedexList();
});

ipcMain.handle('pokedex:detail', async (_event, identifier) => {
  return fetchPokedexDetail(identifier);
});

app.whenReady().then(async () => {
  startProlog();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('before-quit', () => {
  killProlog();
});

app.on('window-all-closed', () => {
  killProlog();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
