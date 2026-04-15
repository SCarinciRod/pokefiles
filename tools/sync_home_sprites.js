const fs = require('fs');
const path = require('path');
const https = require('https');

const useInsecureTls = process.env.POKEDEX_INSECURE_TLS === '1';

const SOURCE_ARCHIVE_URL = 'https://pokemondb.net/sprites';
const MANIFEST_FILE_NAME = 'sprite_manifest.json';
const RETRY_LIMIT = 3;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_FORM_SCAN_CONCURRENCY = 12;

const NORMAL_CANDIDATES = [
  'https://img.pokemondb.net/sprites/home/normal/{slug}.png',
  'https://img.pokemondb.net/sprites/home/normal/1x/{slug}.png',
  'https://img.pokemondb.net/sprites/sword-shield/normal/{slug}.png',
  'https://img.pokemondb.net/sprites/scarlet-violet/normal/{slug}.png',
  'https://img.pokemondb.net/sprites/scarlet-violet/normal/1x/{slug}.png',
  'https://img.pokemondb.net/sprites/go/normal/{slug}.png',
  'https://img.pokemondb.net/sprites/go/normal/1x/{slug}.png',
  'https://img.pokemondb.net/sprites/bank/normal/{slug}.png',
  'https://img.pokemondb.net/sprites/x-y/normal/{slug}.png',
  'https://img.pokemondb.net/sprites/omega-ruby-alpha-sapphire/dex/normal/{slug}.png',
  'https://img.pokemondb.net/sprites/lets-go-pikachu-eevee/normal/{slug}.png',
  'https://img.pokemondb.net/sprites/ultra-sun-ultra-moon/normal/{slug}.png',
];

const SHINY_CANDIDATES = [
  'https://img.pokemondb.net/sprites/home/shiny/{slug}.png',
  'https://img.pokemondb.net/sprites/home/shiny/1x/{slug}.png',
  'https://img.pokemondb.net/sprites/go/shiny/{slug}.png',
  'https://img.pokemondb.net/sprites/go/shiny/1x/{slug}.png',
  'https://img.pokemondb.net/sprites/bank/shiny/{slug}.png',
  'https://img.pokemondb.net/sprites/x-y/shiny/{slug}.png',
  'https://img.pokemondb.net/sprites/omega-ruby-alpha-sapphire/dex/shiny/{slug}.png',
  'https://img.pokemondb.net/sprites/ultra-sun-ultra-moon/shiny/{slug}.png',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePositiveInteger(rawValue, fallback) {
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    limit: null,
    concurrency: DEFAULT_CONCURRENCY,
    formScanConcurrency: DEFAULT_FORM_SCAN_CONCURRENCY,
    formScan: true,
    force: false,
    dryRun: false,
    outputDir: null,
  };

  for (const arg of argv) {
    if (arg === '--force') {
      options.force = true;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length), null);
      continue;
    }

    if (arg.startsWith('--concurrency=')) {
      options.concurrency = parsePositiveInteger(arg.slice('--concurrency='.length), DEFAULT_CONCURRENCY);
      continue;
    }

    if (arg.startsWith('--forms-concurrency=')) {
      options.formScanConcurrency = parsePositiveInteger(
        arg.slice('--forms-concurrency='.length),
        DEFAULT_FORM_SCAN_CONCURRENCY
      );
      continue;
    }

    if (arg.startsWith('--output-dir=')) {
      const rawPath = arg.slice('--output-dir='.length).trim();
      options.outputDir = rawPath || null;
      continue;
    }

    if (arg === '--skip-form-scan') {
      options.formScan = false;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log('Uso: node tools/sync_home_sprites.js [opcoes]');
  console.log('');
  console.log('Opcoes:');
  console.log('  --limit=<N>          Processa apenas os primeiros N slugs da lista');
  console.log('  --concurrency=<N>    Numero de downloads em paralelo (padrao: 8)');
  console.log('  --forms-concurrency=<N>  Numero de paginas de especies em paralelo (padrao: 12)');
  console.log('  --output-dir=<PATH>  Diretorio de saida para sprites e manifesto');
  console.log('  --skip-form-scan     Nao expande slugs de formas via paginas individuais');
  console.log('  --force              Rebaixa sprites mesmo quando arquivo local existe');
  console.log('  --dry-run            Apenas lista quantos slugs serao processados');
}

function getDefaultOutputDir() {
  const localAppData = process.env.LOCALAPPDATA || process.env.APPDATA;
  if (localAppData && localAppData.trim()) {
    return path.join(localAppData, 'PokedexChatbot', 'sprites');
  }
  return path.resolve(__dirname, '..', '.local_cache', 'sprites');
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function fileLooksValid(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

function isImageResponse(headers) {
  const contentType = String(headers?.['content-type'] || '').toLowerCase();
  return contentType.startsWith('image/');
}

function requestUrl(url, redirectDepth = 0) {
  if (redirectDepth > 6) {
    return Promise.reject(new Error(`Redirecionamentos em excesso: ${url}`));
  }

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        rejectUnauthorized: !useInsecureTls,
        headers: {
          'User-Agent': 'pokedex-local-sprite-sync',
          Accept: 'image/png,image/*;q=0.9,text/html;q=0.8,*/*;q=0.5',
        },
      },
      (res) => {
        const statusCode = Number(res.statusCode || 0);
        if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, url).toString();
          res.resume();
          resolve(requestUrl(redirectUrl, redirectDepth + 1));
          return;
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            url,
            statusCode,
            headers: res.headers || {},
            body: Buffer.concat(chunks),
          });
        });
      }
    );

    req.on('error', (error) => reject(error));
    req.end();
  });
}

async function requestWithRetry(url, maxRetries = RETRY_LIMIT) {
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      const response = await requestUrl(url);
      const retryableStatus = response.statusCode >= 500 && response.statusCode <= 599;
      if (retryableStatus && attempt <= maxRetries) {
        await sleep(attempt * 600);
        continue;
      }
      return response;
    } catch (error) {
      if (attempt > maxRetries) {
        throw error;
      }
      await sleep(attempt * 600);
    }
  }
}

async function fetchHtmlPage(url) {
  const response = await requestWithRetry(url, RETRY_LIMIT);
  if (response.statusCode !== 200) {
    throw new Error(`Falha ao ler ${url}: HTTP ${response.statusCode}`);
  }
  return response.body.toString('utf8');
}

function extractSpriteSlugs(html) {
  const matches = new Set();
  const regex = /href="\/sprites\/([a-z0-9-]+)"/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const slug = String(match[1] || '').toLowerCase().trim();
    if (!slug) {
      continue;
    }
    matches.add(slug);
  }
  return [...matches].sort((a, b) => a.localeCompare(b));
}

function extractEmbeddedFormSlugs(html) {
  const matches = new Set();
  const regex =
    /https:\/\/img\.pokemondb\.net\/sprites\/(?:home|sword-shield|scarlet-violet|go|bank|x-y)\/(?:normal|shiny)\/(?:1x\/)?([a-z0-9-]+)\.png/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const slug = String(match[1] || '').toLowerCase().trim();
    if (!slug) {
      continue;
    }
    matches.add(slug);
  }
  return [...matches];
}

async function expandSlugsWithEmbeddedForms(baseSlugs, options) {
  if (!options.formScan || baseSlugs.length === 0) {
    return baseSlugs;
  }

  const discovered = new Set(baseSlugs);
  let scanned = 0;
  let failed = 0;

  await runWithConcurrency(baseSlugs, options.formScanConcurrency, async (slug) => {
    const speciesPageUrl = `${SOURCE_ARCHIVE_URL}/${slug}`;
    try {
      const html = await fetchHtmlPage(speciesPageUrl);
      const relatedSlugs = extractEmbeddedFormSlugs(html);
      for (const relatedSlug of relatedSlugs) {
        discovered.add(relatedSlug);
      }
    } catch {
      failed += 1;
    }

    scanned += 1;
    if (scanned % 100 === 0 || scanned === baseSlugs.length) {
      console.log(`[sprites] Varredura de formas: ${scanned}/${baseSlugs.length}`);
    }
  });

  const expandedSlugs = [...discovered].sort((a, b) => a.localeCompare(b));
  const added = Math.max(0, expandedSlugs.length - baseSlugs.length);
  console.log(
    `[sprites] Formas adicionais detectadas: ${added}${failed > 0 ? ` (paginas com falha: ${failed})` : ''}`
  );

  return expandedSlugs;
}

function variantFileName(slug, variant) {
  if (variant === 'shiny') {
    return `${slug}_shiny.png`;
  }
  return `${slug}.png`;
}

function candidateUrlsFor(slug, variant) {
  const templates = variant === 'shiny' ? SHINY_CANDIDATES : NORMAL_CANDIDATES;
  return templates.map((template) => template.replace('{slug}', slug));
}

async function downloadVariant(slug, variant, outputDir, options) {
  const fileName = variantFileName(slug, variant);
  const destination = path.join(outputDir, fileName);

  if (!options.force && fileLooksValid(destination)) {
    return { status: 'skipped', destination };
  }

  const urls = candidateUrlsFor(slug, variant);
  let lastError = null;
  let lastStatusCode = null;

  for (const url of urls) {
    let response;
    try {
      response = await requestWithRetry(url, RETRY_LIMIT);
    } catch (error) {
      lastError = error;
      continue;
    }

    lastStatusCode = response.statusCode;
    if (response.statusCode !== 200) {
      continue;
    }

    if (!isImageResponse(response.headers)) {
      lastError = new Error(`Resposta nao e imagem para ${url}`);
      continue;
    }

    if (!response.body || response.body.length === 0) {
      lastError = new Error(`Resposta vazia para ${url}`);
      continue;
    }

    fs.writeFileSync(destination, response.body);
    return {
      status: 'downloaded',
      destination,
      sourceUrl: url,
    };
  }

  return {
    status: 'missing',
    destination,
    statusCode: lastStatusCode,
    error: lastError ? lastError.message : null,
  };
}

function parseLocalSpriteFileName(fileName) {
  const parsed = path.parse(fileName).name;
  if (parsed.endsWith('_shiny')) {
    return { id: parsed.slice(0, -6), variant: 'shiny' };
  }
  if (parsed.endsWith('-shiny')) {
    return { id: parsed.slice(0, -6), variant: 'shiny' };
  }
  return { id: parsed, variant: 'normal' };
}

function writeManifest(outputDir, sourceUrl) {
  const files = fs
    .readdirSync(outputDir)
    .filter((name) => /\.(png|jpg|jpeg|webp)$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  const entries = {};
  for (const fileName of files) {
    const { id, variant } = parseLocalSpriteFileName(fileName);
    if (!id) {
      continue;
    }
    if (!entries[id]) {
      entries[id] = { normal: null, shiny: null };
    }
    entries[id][variant] = fileName;
  }

  let withNormal = 0;
  let withShiny = 0;
  for (const entry of Object.values(entries)) {
    if (entry.normal) {
      withNormal += 1;
    }
    if (entry.shiny) {
      withShiny += 1;
    }
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    source_archive_url: sourceUrl,
    preferred_style: 'home-gen8',
    totals: {
      entries: Object.keys(entries).length,
      with_normal: withNormal,
      with_shiny: withShiny,
      files: files.length,
    },
    sprites: entries,
  };

  const manifestPath = path.join(outputDir, MANIFEST_FILE_NAME);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return manifest;
}

async function runWithConcurrency(items, concurrency, worker) {
  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length || 1));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function consume() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) {
        return;
      }
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: safeConcurrency }, () => consume()));
  return results;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputDir = options.outputDir
    ? path.resolve(options.outputDir)
    : getDefaultOutputDir();

  ensureDirectory(outputDir);
  console.log(`[sprites] Diretorio local: ${outputDir}`);

  if (useInsecureTls) {
    console.warn('[warn] TLS inseguro habilitado (POKEDEX_INSECURE_TLS=1). Use apenas quando necessario.');
  }

  console.log('[sprites] Lendo lista de slugs em PokemonDB...');
  const archiveHtml = await fetchHtmlPage(SOURCE_ARCHIVE_URL);
  let slugs = extractSpriteSlugs(archiveHtml);
  if (slugs.length === 0) {
    throw new Error('Nenhum slug de sprite encontrado na pagina de origem.');
  }

  if (options.limit) {
    slugs = slugs.slice(0, options.limit);
  }

  const baseSlugCount = slugs.length;
  if (options.formScan) {
    console.log('[sprites] Expandindo slugs com formas embutidas nas paginas individuais...');
    slugs = await expandSlugsWithEmbeddedForms(slugs, options);
  }

  console.log(`[sprites] Slugs totais para processamento: ${slugs.length} (base: ${baseSlugCount})`);
  if (options.dryRun) {
    console.log('[sprites] Dry-run ativo. Nenhum arquivo foi baixado.');
    return;
  }

  const counters = {
    normalDownloaded: 0,
    normalSkipped: 0,
    normalMissing: 0,
    shinyDownloaded: 0,
    shinySkipped: 0,
    shinyMissing: 0,
  };

  let completed = 0;
  await runWithConcurrency(slugs, options.concurrency, async (slug) => {
    const normalResult = await downloadVariant(slug, 'normal', outputDir, options);
    const shinyResult = await downloadVariant(slug, 'shiny', outputDir, options);

    if (normalResult.status === 'downloaded') counters.normalDownloaded += 1;
    if (normalResult.status === 'skipped') counters.normalSkipped += 1;
    if (normalResult.status === 'missing') counters.normalMissing += 1;

    if (shinyResult.status === 'downloaded') counters.shinyDownloaded += 1;
    if (shinyResult.status === 'skipped') counters.shinySkipped += 1;
    if (shinyResult.status === 'missing') counters.shinyMissing += 1;

    completed += 1;
    if (completed % 50 === 0 || completed === slugs.length) {
      console.log(`[sprites] Progresso: ${completed}/${slugs.length}`);
    }
  });

  const manifest = writeManifest(outputDir, SOURCE_ARCHIVE_URL);

  console.log('[sprites] Sincronizacao finalizada.');
  console.log(
    `[sprites] Normal  -> baixados: ${counters.normalDownloaded}, reaproveitados: ${counters.normalSkipped}, faltando: ${counters.normalMissing}`
  );
  console.log(
    `[sprites] Shiny   -> baixados: ${counters.shinyDownloaded}, reaproveitados: ${counters.shinySkipped}, faltando: ${counters.shinyMissing}`
  );
  console.log(
    `[sprites] Manifesto: ${manifest.totals.entries} entradas (${manifest.totals.with_normal} com normal, ${manifest.totals.with_shiny} com shiny)`
  );

  if (manifest.totals.with_normal === 0) {
    throw new Error('Nenhuma sprite normal foi sincronizada. Verifique conectividade com PokemonDB.');
  }
}

main().catch((error) => {
  console.error(`[sprites] Erro: ${error.message}`);
  process.exit(1);
});