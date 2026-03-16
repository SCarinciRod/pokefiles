const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const DB_DIR = path.join(ROOT, 'db');

const ABILITIES_OUTPUT = path.join(DB_DIR, 'abilities_catalog.pl');
const ITEMS_OUTPUT = path.join(DB_DIR, 'items_catalog.pl');

const useInsecureTls = process.env.POKEDEX_INSECURE_TLS === '1';
const PARALLEL = Number(process.env.POKEDEX_FETCH_PARALLEL || 10);

function sanitizeAtom(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function prologQuotedText(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'pokefiles-ability-item-generator/1.0',
          Accept: 'application/json',
        },
        rejectUnauthorized: !useInsecureTls,
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          res.resume();
          return;
        }

        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error(`Invalid JSON from ${url}: ${err.message}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error(`Timeout fetching ${url}`));
    });
  });
}

async function poolMap(items, mapper, parallel = 8) {
  const out = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      out[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.max(1, parallel) }, () => worker());
  await Promise.all(workers);
  return out;
}

function pickEnglishShortEffect(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const match = list.find((row) => row?.language?.name === 'en' && row?.short_effect);
  return match ? String(match.short_effect).replace(/\s+/g, ' ').trim() : '';
}

function pickEnglishEffect(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const match = list.find((row) => row?.language?.name === 'en' && row?.effect);
  return match ? String(match.effect).replace(/\s+/g, ' ').trim() : '';
}

async function fetchAllAbilityNames() {
  const data = await fetchJson('https://pokeapi.co/api/v2/ability?limit=5000');
  const rows = Array.isArray(data?.results) ? data.results : [];
  return rows
    .map((row) => ({
      name: String(row?.name || '').trim(),
      url: String(row?.url || '').trim(),
    }))
    .filter((row) => row.name && row.url)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchAllItemNames() {
  const data = await fetchJson('https://pokeapi.co/api/v2/item?limit=5000');
  const rows = Array.isArray(data?.results) ? data.results : [];
  return rows
    .map((row) => ({
      name: String(row?.name || '').trim(),
      url: String(row?.url || '').trim(),
    }))
    .filter((row) => row.name && row.url)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeAbilityRow(data) {
  const id = sanitizeAtom(data?.name || 'unknown_ability');
  const generation = sanitizeAtom(data?.generation?.name || 'unknown_generation');
  const isMainSeries = data?.is_main_series ? true : false;
  const shortEffect = pickEnglishShortEffect(data?.effect_entries);
  const effect = pickEnglishEffect(data?.effect_entries);

  return {
    id,
    generation,
    isMainSeries,
    shortEffect: shortEffect || 'Sem descrição curta disponível.',
    effect: effect || 'Sem descrição detalhada disponível.',
  };
}

function normalizeItemRow(data) {
  const id = sanitizeAtom(data?.name || 'unknown_item');
  const category = sanitizeAtom(data?.category?.name || 'unknown_category');
  const cost = Number.isInteger(data?.cost) ? data.cost : 0;
  const flingPower = Number.isInteger(data?.fling_power) ? data.fling_power : 0;
  const flingEffect = sanitizeAtom(data?.fling_effect?.name || 'none');

  const shortEffect = pickEnglishShortEffect(data?.effect_entries);
  const effect = pickEnglishEffect(data?.effect_entries);
  const description = shortEffect || effect || 'Sem descrição disponível.';

  return {
    id,
    category,
    cost,
    flingPower,
    flingEffect,
    description,
  };
}

function renderAbilities(rows) {
  const header = [
    ':- encoding(utf8).',
    '',
    '% Arquivo gerado automaticamente por tools/generate_abilities_items_db.js',
    '% ability_entry(Ability, Generation, IsMainSeries, ShortEffect, Effect).',
    '',
  ].join('\n');

  const body = rows
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(
      (row) =>
        `ability_entry(${row.id}, ${row.generation}, ${row.isMainSeries}, ${prologQuotedText(row.shortEffect)}, ${prologQuotedText(row.effect)}).`
    )
    .join('\n');

  return `${header}${body}\n`;
}

function renderItems(rows) {
  const header = [
    ':- encoding(utf8).',
    '',
    '% Arquivo gerado automaticamente por tools/generate_abilities_items_db.js',
    '% item_entry(Item, Category, Cost, FlingPower, FlingEffect, Description).',
    '',
  ].join('\n');

  const body = rows
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(
      (row) =>
        `item_entry(${row.id}, ${row.category}, ${row.cost}, ${row.flingPower}, ${row.flingEffect}, ${prologQuotedText(row.description)}).`
    )
    .join('\n');

  return `${header}${body}\n`;
}

async function main() {
  const [abilityRefs, itemRefs] = await Promise.all([fetchAllAbilityNames(), fetchAllItemNames()]);

  console.log(`[meta] abilities encontradas: ${abilityRefs.length}`);
  console.log(`[meta] items encontrados: ${itemRefs.length}`);

  const abilities = await poolMap(
    abilityRefs,
    async (ref, index) => {
      if ((index + 1) % 50 === 0 || index === 0) {
        console.log(`[meta] abilities ${index + 1}/${abilityRefs.length}...`);
      }
      const data = await fetchJson(ref.url);
      return normalizeAbilityRow(data);
    },
    PARALLEL
  );

  const items = await poolMap(
    itemRefs,
    async (ref, index) => {
      if ((index + 1) % 100 === 0 || index === 0) {
        console.log(`[meta] items ${index + 1}/${itemRefs.length}...`);
      }
      const data = await fetchJson(ref.url);
      return normalizeItemRow(data);
    },
    PARALLEL
  );

  fs.writeFileSync(ABILITIES_OUTPUT, renderAbilities(abilities), 'utf8');
  fs.writeFileSync(ITEMS_OUTPUT, renderItems(items), 'utf8');

  console.log(`[meta] abilities salvas em: ${ABILITIES_OUTPUT}`);
  console.log(`[meta] items salvos em: ${ITEMS_OUTPUT}`);
  console.log('[meta] geração concluída.');
}

main().catch((err) => {
  console.error(`[meta] erro: ${err.message}`);
  process.exitCode = 1;
});
