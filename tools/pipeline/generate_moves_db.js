'use strict';
const https = require('https');
const path = require('path');

const { openDb } = require('./sqlite_writer');

const useInsecureTls = process.env.POKEDEX_INSECURE_TLS === '1';
const PARALLEL = Number(process.env.POKEDEX_FETCH_PARALLEL || 10);

function sanitizeAtom(value) {
  const atom = String(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!atom) return 'unknown_atom';
  return /^[0-9]/.test(atom) ? `m_${atom}` : atom;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: { 'User-Agent': 'pokefiles-move-generator/1.0', Accept: 'application/json' },
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
          try { resolve(JSON.parse(data)); }
          catch (err) { reject(new Error(`Invalid JSON from ${url}: ${err.message}`)); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error(`Timeout fetching ${url}`)));
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
  await Promise.all(Array.from({ length: Math.max(1, parallel) }, () => worker()));
  return out;
}

function normalizePokemonApiName(localName) {
  return localName.replace(/_/g, '-');
}

function inferBaseSpeciesName(localName) {
  if (localName.includes('_mega')) return localName.replace(/_mega(?:_[a-z0-9]+)?$/, '');
  return localName;
}

function buildFallbackPokemonApiCandidates(localName) {
  const base = normalizePokemonApiName(inferBaseSpeciesName(localName));
  return [...new Set([
    base, `${base}-male`, `${base}-female`, `${base}-normal`, `${base}-50`,
    `${base}-50-power-construct`, `${base}-incarnate`, `${base}-ordinary`,
  ].filter(Boolean))];
}

function mapDamageClass(moveData) {
  const kind = sanitizeAtom(moveData?.damage_class?.name || 'status');
  return (kind === 'special' || kind === 'physical' || kind === 'status') ? kind : 'status';
}

function mapMoveType(moveData) { return sanitizeAtom(moveData?.type?.name || 'normal'); }
function mapMovePower(moveData) { return Number.isInteger(moveData?.power) ? moveData.power : 0; }
function mapMoveAccuracy(moveData) { return Number.isInteger(moveData?.accuracy) ? moveData.accuracy : 0; }
function mapMovePp(moveData) { return Number.isInteger(moveData?.pp) ? moveData.pp : 0; }
function mapMoveEffectChance(moveData) { return Number.isInteger(moveData?.effect_chance) ? moveData.effect_chance : null; }
function mapMoveAilment(moveData) { return sanitizeAtom(moveData?.meta?.ailment?.name || 'none'); }
function mapMoveEffectCategory(moveData) { return sanitizeAtom(moveData?.meta?.category?.name || 'unknown'); }

function mapMoveTags(moveData) {
  const tags = [];
  const className = sanitizeAtom(moveData?.damage_class?.name || 'status');
  if (className === 'physical') tags.push('physical');
  if (className === 'special') tags.push('special');
  if (className === 'status') tags.push('status');
  const ailment = sanitizeAtom(moveData?.meta?.ailment?.name || 'none');
  if (ailment && ailment !== 'none' && ailment !== 'unknown') tags.push(`ailment_${ailment}`);
  if (Number.isInteger(moveData?.priority) && moveData.priority !== 0) tags.push(`priority_${moveData.priority}`);
  if (Number.isInteger(moveData?.meta?.flinch_chance) && moveData.meta.flinch_chance > 0) tags.push('flinch_chance');
  if (Number.isInteger(moveData?.meta?.crit_rate) && moveData.meta.crit_rate > 1) tags.push('high_crit');
  return tags.length > 0 ? tags : ['none'];
}

function pickMoveDescription(moveData) {
  const entries = Array.isArray(moveData?.effect_entries) ? moveData.effect_entries : [];
  const en = entries.find((entry) => entry?.language?.name === 'en' && entry?.short_effect);
  if (!en) return 'Sem descrição curta disponível.';
  let text = String(en.short_effect).replace(/\n+/g, ' ').trim();
  const chance = mapMoveEffectChance(moveData);
  if (Number.isInteger(chance)) text = text.replace(/\$effect_chance/g, String(chance));
  return text;
}

async function fetchPokemonMoves(localName) {
  const primaryName = normalizePokemonApiName(localName);
  const fallbackCandidates = buildFallbackPokemonApiCandidates(localName);
  let data;
  let source = 'primary';
  try {
    data = await fetchJson(`https://pokeapi.co/api/v2/pokemon/${primaryName}`);
  } catch (_errPrimary) {
    let recovered = false;
    for (const candidate of fallbackCandidates) {
      if (candidate === primaryName) continue;
      try {
        data = await fetchJson(`https://pokeapi.co/api/v2/pokemon/${candidate}`);
        source = 'fallback';
        recovered = true;
        break;
      } catch (_e) { /* try next */ }
    }
    if (!recovered) throw new Error(`Falha para ${localName} (sem candidatos válidos na API).`);
  }
  const rawMoves = Array.isArray(data?.moves) ? data.moves : [];
  let moves = [...new Set(rawMoves.map((m) => sanitizeAtom(m?.move?.name)).filter(Boolean))].sort();
  if (moves.length === 0) {
    for (const candidate of fallbackCandidates) {
      if (candidate === primaryName) continue;
      try {
        const fd = await fetchJson(`https://pokeapi.co/api/v2/pokemon/${candidate}`);
        const fm = [...new Set((Array.isArray(fd?.moves) ? fd.moves : []).map((m) => sanitizeAtom(m?.move?.name)).filter(Boolean))].sort();
        if (fm.length > 0) { moves = fm; source = 'fallback_empty_primary'; break; }
      } catch (_e) { /* try next */ }
    }
  }
  return { localName, source, moves };
}

async function fetchAllMoveIdsFromApi() {
  const data = await fetchJson('https://pokeapi.co/api/v2/move?limit=5000');
  return (Array.isArray(data?.results) ? data.results : [])
    .map((row) => { const apiName = String(row?.name || '').trim(); return apiName ? { apiName, id: sanitizeAtom(apiName) } : null; })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function main() {
  const db = openDb();

  // Read pokemon list from SQLite (populated by generate_generation_db.js)
  const pokemonRows = db.prepare('SELECT id, identifier FROM pokemon ORDER BY id').all();
  if (pokemonRows.length === 0) throw new Error('Nenhum Pokémon na tabela pokemon — execute generate_generation_db.js primeiro.');
  const pokemonIdByIdentifier = new Map(pokemonRows.map((r) => [r.identifier, r.id]));
  const pokemonNames = pokemonRows.map((r) => r.identifier);

  console.log(`[moves] Pokémon detectados: ${pokemonNames.length}`);

  const movelistResults = await poolMap(
    pokemonNames,
    async (name, index) => {
      if ((index + 1) % 50 === 0 || index === 0) console.log(`[moves] processando ${index + 1}/${pokemonNames.length}...`);
      return fetchPokemonMoves(name);
    },
    PARALLEL
  );

  const movelists = movelistResults
    .map((entry) => ({ name: entry.localName, moves: entry.moves, source: entry.source }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const allMoves = await fetchAllMoveIdsFromApi();
  console.log(`[moves] Moves globais encontrados na API: ${allMoves.length}`);

  const moveRowsRaw = await poolMap(
    allMoves,
    async (moveEntry, index) => {
      if ((index + 1) % 100 === 0 || index === 0) console.log(`[moves] baixando detalhes ${index + 1}/${allMoves.length}...`);
      const moveData = await fetchJson(`https://pokeapi.co/api/v2/move/${moveEntry.apiName}`);
      return {
        id: moveEntry.id,
        type_id: mapMoveType(moveData),
        category: mapDamageClass(moveData),
        base_power: mapMovePower(moveData),
        accuracy: mapMoveAccuracy(moveData),
        pp: mapMovePp(moveData),
        tags: mapMoveTags(moveData),
        effect_chance: mapMoveEffectChance(moveData),
        ailment: mapMoveAilment(moveData),
        effect_category: mapMoveEffectCategory(moveData),
        description: pickMoveDescription(moveData),
      };
    },
    PARALLEL
  );
  const moveRows = moveRowsRaw.sort((a, b) => a.id.localeCompare(b.id));

  const stmtType = db.prepare('INSERT OR IGNORE INTO types (id, pt_label) VALUES (?, NULL)');
  const stmtMove = db.prepare(
    'INSERT OR REPLACE INTO moves (id, type_id, category, base_power, accuracy, pp, effect_chance, ailment, effect_category, description) VALUES (@id, @type_id, @category, @base_power, @accuracy, @pp, @effect_chance, @ailment, @effect_category, @description)'
  );
  const stmtTag = db.prepare('INSERT OR IGNORE INTO move_tags (move_id, tag) VALUES (?, ?)');

  db.transaction(() => {
    for (const row of moveRows) {
      stmtType.run(row.type_id);
      stmtMove.run(row);
      for (const tag of row.tags) stmtTag.run(row.id, tag);
    }
  })();

  const stmtMoveset = db.prepare('INSERT OR IGNORE INTO pokemon_moves (pokemon_identifier, pokemon_id, move_id) VALUES (?, ?, ?)');
  db.transaction(() => {
    for (const { name, moves } of movelists) {
      const pokemonId = pokemonIdByIdentifier.get(name) ?? null;
      for (const moveId of moves) stmtMoveset.run(name, pokemonId, moveId);
    }
  })();

  db.close();

  const fallbackCount = movelists.filter((m) => m.source === 'fallback').length;
  console.log(`[moves] Movelists gerados: ${movelists.length}`);
  console.log(`[moves] Movelists com fallback: ${fallbackCount}`);
  console.log('[moves] Geração concluída.');
}

main().catch((err) => {
  console.error(`[moves] erro: ${err.message}`);
  process.exitCode = 1;
});
