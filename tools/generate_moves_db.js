const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const DB_DIR = path.join(ROOT, 'db');

const MOVE_OUTPUT = path.join(DB_DIR, 'moves_catalog.pl');
const MOVESET_OUTPUT = path.join(DB_DIR, 'pokemon_movelists.pl');

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

function readFileUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'pokefiles-move-generator/1.0',
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

function parsePokemonNamesFromContent(content) {
  const names = [];
  const regex = /pokemon\(\s*\d+\s*,\s*([a-zA-Z0-9_]+)\s*,/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    names.push(sanitizeAtom(match[1]));
  }
  return names;
}

function collectAllPokemonNames() {
  const sources = [
    path.join(ROOT, 'pokemon_db.pl'),
    path.join(DB_DIR, 'special_forms.pl'),
    path.join(DB_DIR, 'mega_forms.pl'),
  ];

  for (let generation = 1; generation <= 9; generation += 1) {
    sources.push(path.join(DB_DIR, `generation_${generation}.pl`));
  }

  const names = new Set();
  for (const source of sources) {
    if (!fs.existsSync(source)) continue;
    const content = readFileUtf8(source);
    for (const name of parsePokemonNamesFromContent(content)) {
      names.add(name);
    }
  }

  return [...names].sort();
}

function normalizePokemonApiName(localName) {
  // As formas especiais locais seguem padrão *_mega, *_mega_x, *_mega_y etc.
  // A PokeAPI usa -mega, -mega-x, -mega-y.
  return localName.replace(/_/g, '-');
}

function inferBaseSpeciesName(localName) {
  // fallback agressivo para formas locais customizadas que não existem na PokeAPI
  if (localName.includes('_mega')) {
    return localName.replace(/_mega(?:_[a-z0-9]+)?$/, '');
  }
  return localName;
}

function buildFallbackPokemonApiCandidates(localName) {
  const base = normalizePokemonApiName(inferBaseSpeciesName(localName));
  const candidates = [
    base,
    `${base}-male`,
    `${base}-female`,
    `${base}-normal`,
    `${base}-50`,
    `${base}-50-power-construct`,
    `${base}-incarnate`,
    `${base}-ordinary`,
  ];
  return [...new Set(candidates.filter(Boolean))];
}

function mapDamageClass(moveData) {
  const kind = sanitizeAtom(moveData?.damage_class?.name || 'status');
  if (kind === 'special' || kind === 'physical' || kind === 'status') return kind;
  return 'status';
}

function mapMoveType(moveData) {
  return sanitizeAtom(moveData?.type?.name || 'normal');
}

function mapMovePower(moveData) {
  return Number.isInteger(moveData?.power) ? moveData.power : 0;
}

function mapMoveAccuracy(moveData) {
  return Number.isInteger(moveData?.accuracy) ? moveData.accuracy : 0;
}

function mapMovePp(moveData) {
  return Number.isInteger(moveData?.pp) ? moveData.pp : 0;
}

function mapMoveEffectChance(moveData) {
  return Number.isInteger(moveData?.effect_chance) ? moveData.effect_chance : null;
}

function mapMoveAilment(moveData) {
  return sanitizeAtom(moveData?.meta?.ailment?.name || 'none');
}

function mapMoveEffectCategory(moveData) {
  return sanitizeAtom(moveData?.meta?.category?.name || 'unknown');
}

function mapMoveTags(moveData) {
  const tags = [];
  const className = sanitizeAtom(moveData?.damage_class?.name || 'status');
  if (className === 'physical') tags.push('physical');
  if (className === 'special') tags.push('special');
  if (className === 'status') tags.push('status');

  const ailment = sanitizeAtom(moveData?.meta?.ailment?.name || 'none');
  if (ailment && ailment !== 'none' && ailment !== 'unknown') tags.push(`ailment_${ailment}`);

  if (Number.isInteger(moveData?.priority) && moveData.priority !== 0) {
    tags.push(`priority_${moveData.priority}`);
  }

  if (Number.isInteger(moveData?.meta?.flinch_chance) && moveData.meta.flinch_chance > 0) {
    tags.push('flinch_chance');
  }

  if (Number.isInteger(moveData?.meta?.crit_rate) && moveData.meta.crit_rate > 1) {
    tags.push('high_crit');
  }

  return tags.length > 0 ? tags : ['none'];
}

function pickMoveDescription(moveData) {
  const entries = Array.isArray(moveData?.effect_entries) ? moveData.effect_entries : [];
  const en = entries.find((entry) => entry?.language?.name === 'en' && entry?.short_effect);
  if (!en) return 'Sem descrição curta disponível.';
  let text = String(en.short_effect).replace(/\n+/g, ' ').trim();
  const chance = mapMoveEffectChance(moveData);
  if (Number.isInteger(chance)) {
    text = text.replace(/\$effect_chance/g, String(chance));
  }
  return text;
}

function renderMovesCatalog(moveRows) {
  const header = [
    ':- encoding(utf8).',
    '',
    '% Arquivo gerado automaticamente por tools/generate_moves_db.js',
    '% move_entry(MoveId, Type, Category, BasePower, Accuracy, PP, Tags, EffectChance, Ailment, EffectCategory, Description).',
    '',
  ].join('\n');

  const lines = moveRows.map((row) => {
    const tags = `[${row.tags.join(', ')}]`;
    const effectChance = row.effectChance === null ? 'null' : row.effectChance;
    return `move_entry(${row.id}, ${row.type}, ${row.category}, ${row.power}, ${row.accuracy}, ${row.pp}, ${tags}, ${effectChance}, ${row.ailment}, ${row.effectCategory}, ${prologQuotedText(row.description)}).`;
  });

  return `${header}${lines.join('\n')}\n`;
}

function renderPokemonMovelists(movelists) {
  const header = [
    ':- encoding(utf8).',
    '',
    '% Arquivo gerado automaticamente por tools/generate_moves_db.js',
    '% pokemon_move_list(PokemonName, [Move1, Move2, ...]).',
    '',
  ].join('\n');

  const rows = movelists.map(({ name, moves }) => {
    const body = `[${moves.join(', ')}]`;
    return `pokemon_move_list(${name}, ${body}).`;
  });

  return `${header}${rows.join('\n')}\n`;
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

async function fetchPokemonMoves(localName) {
  const primaryName = normalizePokemonApiName(localName);
  const fallbackCandidates = buildFallbackPokemonApiCandidates(localName);

  let data;
  let source = 'primary';

  try {
    data = await fetchJson(`https://pokeapi.co/api/v2/pokemon/${primaryName}`);
  } catch (errPrimary) {
    let recovered = false;
    for (const candidate of fallbackCandidates) {
      if (candidate === primaryName) continue;
      try {
        data = await fetchJson(`https://pokeapi.co/api/v2/pokemon/${candidate}`);
        source = 'fallback';
        recovered = true;
        break;
      } catch (_errFallback) {
        // segue para próximo candidato
      }
    }
    if (!recovered) {
      throw new Error(
        `Falha para ${localName} (endpoint principal ${primaryName} e fallbacks sem sucesso).`
      );
    }
  }

  const rawMovesPrimary = Array.isArray(data?.moves) ? data.moves : [];
  let moves = [...new Set(rawMovesPrimary.map((m) => sanitizeAtom(m?.move?.name)).filter(Boolean))].sort();

  if (moves.length === 0) {
    for (const candidate of fallbackCandidates) {
      if (candidate === primaryName) continue;
      try {
        const fallbackData = await fetchJson(`https://pokeapi.co/api/v2/pokemon/${candidate}`);
        const rawMovesFallback = Array.isArray(fallbackData?.moves) ? fallbackData.moves : [];
        const fallbackMoves = [
          ...new Set(rawMovesFallback.map((m) => sanitizeAtom(m?.move?.name)).filter(Boolean)),
        ].sort();

        if (fallbackMoves.length > 0) {
          moves = fallbackMoves;
          source = 'fallback_empty_primary';
          break;
        }
      } catch (_errFallbackOnEmpty) {
        // tenta próximo candidato
      }
    }
  }

  return {
    localName,
    source,
    moves,
  };
}

async function fetchAllMoveIdsFromApi() {
  const data = await fetchJson('https://pokeapi.co/api/v2/move?limit=5000');
  const results = Array.isArray(data?.results) ? data.results : [];
  return results
    .map((row) => {
      const apiName = String(row?.name || '').trim();
      if (!apiName) return null;
      return {
        apiName,
        id: sanitizeAtom(apiName),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function main() {
  const pokemonNames = collectAllPokemonNames();
  if (pokemonNames.length === 0) {
    throw new Error('Nenhum Pokémon encontrado para gerar movelists.');
  }

  console.log(`[moves] Pokémon detectados: ${pokemonNames.length}`);

  const movelistResults = await poolMap(
    pokemonNames,
    async (name, index) => {
      if ((index + 1) % 50 === 0 || index === 0) {
        console.log(`[moves] processando ${index + 1}/${pokemonNames.length}...`);
      }
      return fetchPokemonMoves(name);
    },
    PARALLEL
  );

  const movelists = movelistResults
    .map((entry) => ({
      name: entry.localName,
      moves: entry.moves,
      source: entry.source,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const rosterMoves = [...new Set(movelists.flatMap((entry) => entry.moves))].sort();
  console.log(`[moves] Moves únicos encontrados nos movelists: ${rosterMoves.length}`);

  const allMoves = await fetchAllMoveIdsFromApi();
  console.log(`[moves] Moves globais encontrados na API: ${allMoves.length}`);

  const moveRowsRaw = await poolMap(
    allMoves,
    async (moveEntry, index) => {
      if ((index + 1) % 100 === 0 || index === 0) {
        console.log(`[moves] baixando detalhes dos moves ${index + 1}/${allMoves.length}...`);
      }
      const moveData = await fetchJson(`https://pokeapi.co/api/v2/move/${moveEntry.apiName}`);
      return {
        id: moveEntry.id,
        type: mapMoveType(moveData),
        category: mapDamageClass(moveData),
        power: mapMovePower(moveData),
        accuracy: mapMoveAccuracy(moveData),
        pp: mapMovePp(moveData),
        tags: mapMoveTags(moveData),
        effectChance: mapMoveEffectChance(moveData),
        ailment: mapMoveAilment(moveData),
        effectCategory: mapMoveEffectCategory(moveData),
        description: pickMoveDescription(moveData),
      };
    },
    PARALLEL
  );

  const moveRows = moveRowsRaw.sort((a, b) => a.id.localeCompare(b.id));

  fs.writeFileSync(MOVE_OUTPUT, renderMovesCatalog(moveRows), 'utf8');
  fs.writeFileSync(MOVESET_OUTPUT, renderPokemonMovelists(movelists), 'utf8');

  const fallbackCount = movelists.filter((m) => m.source === 'fallback').length;
  console.log(`[moves] Arquivo de moves salvo em: ${MOVE_OUTPUT}`);
  console.log(`[moves] Arquivo de movelists salvo em: ${MOVESET_OUTPUT}`);
  console.log(`[moves] Movelists com fallback para forma base: ${fallbackCount}`);
  console.log('[moves] Geração concluída.');
}

main().catch((err) => {
  console.error(`[moves] erro: ${err.message}`);
  process.exitCode = 1;
});
