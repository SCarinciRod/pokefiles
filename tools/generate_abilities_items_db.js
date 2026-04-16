const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const DB_DIR = path.join(ROOT, 'db');
const DB_CATALOGS_DIR = path.join(DB_DIR, 'catalogs');
const DB_RUNTIME_DIR = path.join(DB_DIR, 'runtime');

const ABILITIES_OUTPUT = path.join(DB_CATALOGS_DIR, 'abilities_catalog.pl');
const ITEMS_OUTPUT = path.join(DB_CATALOGS_DIR, 'items_catalog.pl');
const ABILITY_LEXICON_OUTPUT = path.join(DB_RUNTIME_DIR, 'bot_static_lexicon_expanded_abilities.pl');

const MISSING_SHORT_EFFECT_TEXT = 'Sem descrição curta disponível.';
const MISSING_EFFECT_TEXT = 'Sem descrição detalhada disponível.';

const ABILITY_DESCRIPTION_OVERRIDES = {
  as_one_glastrier:
    "This Ability combines the effects of both Calyrex's Unnerve Ability and Glastrier's Chilling Neigh Ability.",
  as_one_spectrier:
    "This Ability combines the effects of both Calyrex's Unnerve Ability and Spectrier's Grim Neigh Ability.",
};

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
    shortEffect: shortEffect || MISSING_SHORT_EFFECT_TEXT,
    effect: effect || MISSING_EFFECT_TEXT,
  };
}

function hasMissingAbilityDescriptions(row) {
  return row.shortEffect === MISSING_SHORT_EFFECT_TEXT && row.effect === MISSING_EFFECT_TEXT;
}

function applyAbilityCuration(row) {
  const curated = { ...row };
  const overrideText = ABILITY_DESCRIPTION_OVERRIDES[curated.id];
  if (overrideText) {
    curated.shortEffect = overrideText;
    curated.effect = overrideText;
  }
  return curated;
}

function shouldKeepAbility(row) {
  // Keep only main-series abilities in this project catalog.
  if (!row.isMainSeries) {
    return false;
  }

  // Also guard against main-series rows that still have placeholder text.
  if (hasMissingAbilityDescriptions(row)) {
    return false;
  }

  return true;
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

function renderAbilityLexicon(rows) {
  const abilities = rows
    .map((row) => row.id)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const header = [
    ':- encoding(utf8).',
    '',
    '% Auto-generated lexical expansion from abilities_catalog.pl',
    '% Adds canonical ability names and multiword ability phrases.',
    ':- multifile ability_keyword/1.',
    ':- multifile ability_keyword_phrase/1.',
    '',
  ].join('\n');

  const keywords = abilities.map((ability) => `ability_keyword("${ability}").`).join('\n');

  const phrases = abilities
    .map((ability) => ability.split('_').filter(Boolean))
    .filter((tokens) => tokens.length > 1)
    .map((tokens) => {
      const phrase = tokens.map((token) => `"${token}"`).join(', ');
      return `ability_keyword_phrase([${phrase}]).`;
    })
    .join('\n');

  return `${header}${keywords}\n\n${phrases}\n`;
}

async function main() {
  const [abilityRefs, itemRefs] = await Promise.all([fetchAllAbilityNames(), fetchAllItemNames()]);

  console.log(`[meta] abilities encontradas: ${abilityRefs.length}`);
  console.log(`[meta] items encontrados: ${itemRefs.length}`);

  const fetchedAbilities = await poolMap(
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

  const curatedAbilities = fetchedAbilities
    .map((row) => applyAbilityCuration(row))
    .filter((row) => shouldKeepAbility(row));

  const droppedNonMainSeries = fetchedAbilities.filter((row) => !row.isMainSeries).length;
  const droppedMissingDescription = fetchedAbilities.filter(
    (row) => row.isMainSeries && hasMissingAbilityDescriptions(applyAbilityCuration(row))
  ).length;

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

  fs.writeFileSync(ABILITIES_OUTPUT, renderAbilities(curatedAbilities), 'utf8');
  fs.writeFileSync(ABILITY_LEXICON_OUTPUT, renderAbilityLexicon(curatedAbilities), 'utf8');
  fs.writeFileSync(ITEMS_OUTPUT, renderItems(items), 'utf8');

  console.log(`[meta] abilities apos curadoria: ${curatedAbilities.length}`);
  console.log(`[meta] abilities removidas (non-main-series): ${droppedNonMainSeries}`);
  console.log(`[meta] abilities removidas (descricao ausente): ${droppedMissingDescription}`);
  console.log(`[meta] abilities salvas em: ${ABILITIES_OUTPUT}`);
  console.log(`[meta] lexico de abilities salvo em: ${ABILITY_LEXICON_OUTPUT}`);
  console.log(`[meta] items salvos em: ${ITEMS_OUTPUT}`);
  console.log('[meta] geração concluída.');
}

main().catch((err) => {
  console.error(`[meta] erro: ${err.message}`);
  process.exitCode = 1;
});
