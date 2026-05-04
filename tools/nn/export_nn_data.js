const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, '.local_cache', 'nn_export');
const SCHEMA_PATH = path.join(REPO_ROOT, 'tools', 'nn', 'sqlite_schema.sql');
const SCHEMA_VERSION = 'v1';

function parseArgs(argv) {
  const options = {
    outputDir: DEFAULT_OUTPUT_DIR,
    force: false,
    dbPath: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg.startsWith('--output-dir=')) {
      options.outputDir = arg.slice('--output-dir='.length);
      continue;
    }
    if (arg === '--output-dir' && argv[i + 1]) {
      options.outputDir = argv[i + 1];
      i += 1;
    }
    if (arg.startsWith('--db-path=')) {
      options.dbPath = arg.slice('--db-path='.length);
      continue;
    }
    if (arg === '--db-path' && argv[i + 1]) {
      options.dbPath = argv[i + 1];
      i += 1;
    }
  }

  options.outputDir = path.resolve(options.outputDir);
  if (!options.dbPath) {
    options.dbPath = path.join(options.outputDir, 'pokefiles_nn.sqlite3');
  }
  options.dbPath = path.resolve(options.dbPath);
  return options;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

function toRelative(filePath) {
  return normalizePath(path.relative(REPO_ROOT, filePath));
}

function listGenerationFiles() {
  const dir = path.join(REPO_ROOT, 'db', 'generations', 'core');
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir)
    .filter((name) => /^generation_\d+\.pl$/i.test(name))
    .map((name) => path.join(dir, name));
}

function collectInputFiles() {
  const files = [];

  files.push(...listGenerationFiles());
  files.push(path.join(REPO_ROOT, 'db', 'catalogs', 'pokemon_movelists.pl'));
  files.push(path.join(REPO_ROOT, 'db', 'catalogs', 'moves_catalog.pl'));
  files.push(path.join(REPO_ROOT, 'db', 'catalogs', 'move_tactical_catalog.pl'));
  files.push(path.join(REPO_ROOT, 'db', 'generated', 'move_data_auto.pl'));
  files.push(path.join(REPO_ROOT, 'db', 'generated', 'move_markers.pl'));
  files.push(path.join(REPO_ROOT, 'db', 'catalogs', 'abilities_catalog.pl'));
  files.push(path.join(REPO_ROOT, 'db', 'generated', 'ability_data_auto.pl'));
  files.push(path.join(REPO_ROOT, 'db', 'generated', 'ability_markers.pl'));
  files.push(path.join(REPO_ROOT, 'db', 'catalogs', 'items_catalog.pl'));
  files.push(path.join(REPO_ROOT, 'db', 'generated', 'item_markers.pl'));
  files.push(path.join(REPO_ROOT, 'db', 'generated', 'held_item_data_auto.pl'));
  files.push(path.join(REPO_ROOT, 'db', 'runtime', 'bot_type_data.pl'));

  if (fs.existsSync(SCHEMA_PATH)) {
    files.push(SCHEMA_PATH);
  }

  return files.filter((filePath) => fs.existsSync(filePath));
}

function hashFile(filePath) {
  const data = fs.readFileSync(filePath);
  const sha256 = crypto.createHash('sha256').update(data).digest('hex');
  return {
    path: toRelative(filePath),
    sha256,
    bytes: data.length
  };
}

function readManifest(outputDir) {
  const manifestPath = path.join(outputDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function isUpToDate(outputDir, schemaVersion, inputs, dbPath) {
  const manifest = readManifest(outputDir);
  if (!manifest) {
    return false;
  }
  if (manifest.schema_version !== schemaVersion) {
    return false;
  }
  if (!Array.isArray(manifest.inputs)) {
    return false;
  }
  if (dbPath && !fs.existsSync(dbPath)) {
    return false;
  }

  const current = new Map(inputs.map((entry) => [entry.path, entry.sha256]));
  const previous = new Map(manifest.inputs.map((entry) => [entry.path, entry.sha256]));

  if (current.size !== previous.size) {
    return false;
  }

  for (const [pathKey, hash] of current.entries()) {
    if (previous.get(pathKey) !== hash) {
      return false;
    }
  }

  return true;
}

function parsePrologFile(content) {
  const lines = content.split(/\r?\n/);
  const facts = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('%')) continue;
    if (line.startsWith(':-')) continue;

    const match = line.match(/^([a-zA-Z0-9_]+)\s*\((.*)\)\s*\.\s*$/);
    if (!match) continue;

    facts.push({
      pred: match[1],
      args: splitTopLevel(match[2])
    });
  }

  return facts;
}

function splitTopLevel(text) {
  const out = [];
  let buf = '';
  let depth = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      buf += ch;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      buf += ch;
      continue;
    }

    if (!inSingle && !inDouble) {
      if (ch === '(' || ch === '[' || ch === '{') {
        depth += 1;
        buf += ch;
        continue;
      }
      if (ch === ')' || ch === ']' || ch === '}') {
        depth -= 1;
        buf += ch;
        continue;
      }
    }

    if (!inSingle && !inDouble && ch === ',' && depth === 0) {
      out.push(buf.trim());
      buf = '';
      continue;
    }

    buf += ch;
  }

  if (buf.trim()) {
    out.push(buf.trim());
  }

  return out;
}

function parseArg(input) {
  if (input === undefined || input === null) {
    return null;
  }

  const s = String(input).trim();
  if (!s) return '';

  if (s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);

  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevel(inner).map((part) => parseArg(part));
  }

  const single = s.match(/^'(.*)'$/s);
  if (single) {
    return single[1].replace(/''/g, "'");
  }

  const double = s.match(/^"(.*)"$/s);
  if (double) {
    return double[1];
  }

  return s;
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function parseStatToken(token) {
  if (typeof token !== 'string') return null;
  const idx = token.lastIndexOf('-');
  if (idx <= 0) return null;
  const stat = token.slice(0, idx);
  const value = toNumber(token.slice(idx + 1));
  if (!stat || value === null) return null;
  return { stat, value };
}

function normalizeModelList(list) {
  if (!Array.isArray(list)) return [];
  return list.map((token) => {
    if (typeof token !== 'string') return token;
    const idx = token.indexOf('-');
    if (idx <= 0) return token;
    const key = token.slice(0, idx);
    const rawValue = token.slice(idx + 1);
    const value = parseArg(rawValue);
    return { key, value };
  });
}

function normalizeMarkerValue(value) {
  if (value === null || value === undefined) {
    return {
      value_type: 'null',
      value_text: 'null',
      value_number: null,
      value_bool: null
    };
  }

  if (typeof value === 'boolean') {
    return {
      value_type: 'bool',
      value_text: value ? 'true' : 'false',
      value_number: null,
      value_bool: value ? 1 : 0
    };
  }

  if (typeof value === 'number') {
    return {
      value_type: 'number',
      value_text: String(value),
      value_number: value,
      value_bool: null
    };
  }

  return {
    value_type: 'text',
    value_text: String(value),
    value_number: null,
    value_bool: null
  };
}

function addRowUnique(arr, set, key, row) {
  if (set.has(key)) return;
  set.add(key);
  arr.push(row);
}

function writeJsonLines(filePath, rows) {
  const lines = rows.map((row) => JSON.stringify(row));
  const payload = lines.length ? `${lines.join('\n')}\n` : '';
  fs.writeFileSync(filePath, payload, 'utf8');
}

function parseGenerationFromPath(filePath) {
  const match = /generation_(\d+)\.pl$/i.exec(filePath);
  if (!match) return null;
  return Number(match[1]);
}

function sortRows(data) {
  data.pokemon.sort((a, b) => a.id - b.id);
  data.pokemonTypes.sort((a, b) => a.pokemon_id - b.pokemon_id || a.slot - b.slot);
  data.pokemonAbilities.sort((a, b) => a.pokemon_id - b.pokemon_id || a.slot - b.slot);
  data.pokemonStats.sort((a, b) => a.pokemon_id - b.pokemon_id || a.stat_id.localeCompare(b.stat_id));
  data.pokemonMoves.sort((a, b) => a.pokemon_identifier.localeCompare(b.pokemon_identifier) || a.move_id.localeCompare(b.move_id));

  data.types.sort((a, b) => a.id.localeCompare(b.id));
  data.typeChart.sort((a, b) => a.attack_type.localeCompare(b.attack_type) || a.defense_type.localeCompare(b.defense_type));
  data.stats.sort((a, b) => a.id.localeCompare(b.id));

  data.moves.sort((a, b) => a.id.localeCompare(b.id));
  data.moveTags.sort((a, b) => a.move_id.localeCompare(b.move_id) || a.tag.localeCompare(b.tag));
  data.moveEffects.sort((a, b) => a.move_id.localeCompare(b.move_id) || a.category.localeCompare(b.category) || a.trigger.localeCompare(b.trigger));
  data.moveMarkers.sort((a, b) => a.move_id.localeCompare(b.move_id) || a.marker.localeCompare(b.marker) || a.value_text.localeCompare(b.value_text));
  data.moveTacticalRoleSeed.sort((a, b) => a.move_id.localeCompare(b.move_id) || a.role.localeCompare(b.role));
  data.moveTacticalRoleExpand.sort((a, b) => a.role.localeCompare(b.role) || a.expanded_role.localeCompare(b.expanded_role));

  data.abilities.sort((a, b) => a.id.localeCompare(b.id));
  data.abilityEffects.sort((a, b) => a.ability_id.localeCompare(b.ability_id) || a.category.localeCompare(b.category) || a.trigger.localeCompare(b.trigger));
  data.abilityMarkers.sort((a, b) => a.ability_id.localeCompare(b.ability_id) || a.marker.localeCompare(b.marker) || a.value_text.localeCompare(b.value_text));

  data.items.sort((a, b) => a.id.localeCompare(b.id));
  data.itemMarkers.sort((a, b) => a.item_id.localeCompare(b.item_id) || a.marker.localeCompare(b.marker) || a.value_text.localeCompare(b.value_text));
  data.heldItemEffects.sort((a, b) => a.item_id.localeCompare(b.item_id) || a.category.localeCompare(b.category) || a.trigger.localeCompare(b.trigger));
}

function writeOutputs(outputDir, data) {
  const dataDir = path.join(outputDir, 'data');
  ensureDir(dataDir);

  writeJsonLines(path.join(dataDir, 'pokemon.jsonl'), data.pokemon);
  writeJsonLines(path.join(dataDir, 'pokemon_types.jsonl'), data.pokemonTypes);
  writeJsonLines(path.join(dataDir, 'pokemon_abilities.jsonl'), data.pokemonAbilities);
  writeJsonLines(path.join(dataDir, 'pokemon_stats.jsonl'), data.pokemonStats);
  writeJsonLines(path.join(dataDir, 'pokemon_moves.jsonl'), data.pokemonMoves);

  writeJsonLines(path.join(dataDir, 'types.jsonl'), data.types);
  writeJsonLines(path.join(dataDir, 'type_chart.jsonl'), data.typeChart);
  writeJsonLines(path.join(dataDir, 'stats.jsonl'), data.stats);

  writeJsonLines(path.join(dataDir, 'moves.jsonl'), data.moves);
  writeJsonLines(path.join(dataDir, 'move_tags.jsonl'), data.moveTags);
  writeJsonLines(path.join(dataDir, 'move_effects.jsonl'), data.moveEffects);
  writeJsonLines(path.join(dataDir, 'move_markers.jsonl'), data.moveMarkers);
  writeJsonLines(path.join(dataDir, 'move_tactical_role_seed.jsonl'), data.moveTacticalRoleSeed);
  writeJsonLines(path.join(dataDir, 'move_tactical_role_expand.jsonl'), data.moveTacticalRoleExpand);

  writeJsonLines(path.join(dataDir, 'abilities.jsonl'), data.abilities);
  writeJsonLines(path.join(dataDir, 'ability_effects.jsonl'), data.abilityEffects);
  writeJsonLines(path.join(dataDir, 'ability_markers.jsonl'), data.abilityMarkers);

  writeJsonLines(path.join(dataDir, 'items.jsonl'), data.items);
  writeJsonLines(path.join(dataDir, 'item_markers.jsonl'), data.itemMarkers);
  writeJsonLines(path.join(dataDir, 'held_item_effects.jsonl'), data.heldItemEffects);
}

function writeSqlite(dbPath, data, generatedAt) {
  const dbDir = path.dirname(dbPath);
  ensureDir(dbDir);

  const tmpPath = `${dbPath}.tmp`;
  if (fs.existsSync(tmpPath)) {
    fs.unlinkSync(tmpPath);
  }
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }

  const schemaText = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const db = new Database(tmpPath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.exec(schemaText);

  const insertMeta = db.prepare(
    'INSERT OR REPLACE INTO meta (key, value_text, value_number) VALUES (@key, @value_text, @value_number)'
  );
  const insertTypes = db.prepare('INSERT INTO types (id, pt_label) VALUES (@id, @pt_label)');
  const insertTypeChart = db.prepare(
    'INSERT INTO type_chart (attack_type, defense_type, multiplier) VALUES (@attack_type, @defense_type, @multiplier)'
  );
  const insertStats = db.prepare('INSERT INTO stats (id, pt_label) VALUES (@id, @pt_label)');
  const insertPokemon = db.prepare(
    'INSERT INTO pokemon (id, identifier, height_dm, weight_hg, source_generation) VALUES (@id, @identifier, @height_dm, @weight_hg, @source_generation)'
  );
  const insertPokemonTypes = db.prepare(
    'INSERT INTO pokemon_types (pokemon_id, slot, type_id) VALUES (@pokemon_id, @slot, @type_id)'
  );
  const insertPokemonAbilities = db.prepare(
    'INSERT INTO pokemon_abilities (pokemon_id, slot, ability_id) VALUES (@pokemon_id, @slot, @ability_id)'
  );
  const insertPokemonStats = db.prepare(
    'INSERT INTO pokemon_stats (pokemon_id, stat_id, value) VALUES (@pokemon_id, @stat_id, @value)'
  );
  const insertPokemonMoves = db.prepare(
    'INSERT INTO pokemon_moves (pokemon_identifier, pokemon_id, move_id) VALUES (@pokemon_identifier, @pokemon_id, @move_id)'
  );
  const insertMoves = db.prepare(
    'INSERT INTO moves (id, type_id, category, base_power, accuracy, pp, effect_chance, ailment, effect_category, description) VALUES (@id, @type_id, @category, @base_power, @accuracy, @pp, @effect_chance, @ailment, @effect_category, @description)'
  );
  const insertMoveTags = db.prepare('INSERT INTO move_tags (move_id, tag) VALUES (@move_id, @tag)');
  const insertMoveEffects = db.prepare(
    'INSERT INTO move_effects (move_id, category, trigger, model_json, description, confidence) VALUES (@move_id, @category, @trigger, @model_json, @description, @confidence)'
  );
  const insertMoveMarkers = db.prepare(
    'INSERT INTO move_markers (move_id, marker, value_type, value_text, value_number, value_bool) VALUES (@move_id, @marker, @value_type, @value_text, @value_number, @value_bool)'
  );
  const insertMoveTacticalSeed = db.prepare(
    'INSERT INTO move_tactical_role_seed (move_id, role) VALUES (@move_id, @role)'
  );
  const insertMoveTacticalExpand = db.prepare(
    'INSERT INTO move_tactical_role_expand (role, expanded_role) VALUES (@role, @expanded_role)'
  );
  const insertAbilities = db.prepare(
    'INSERT INTO abilities (id, generation, is_main_series, short_effect, effect) VALUES (@id, @generation, @is_main_series, @short_effect, @effect)'
  );
  const insertAbilityEffects = db.prepare(
    'INSERT INTO ability_effects (ability_id, category, trigger, model_json, description) VALUES (@ability_id, @category, @trigger, @model_json, @description)'
  );
  const insertAbilityMarkers = db.prepare(
    'INSERT INTO ability_markers (ability_id, marker, value_type, value_text, value_number, value_bool) VALUES (@ability_id, @marker, @value_type, @value_text, @value_number, @value_bool)'
  );
  const insertItems = db.prepare(
    'INSERT INTO items (id, category, cost, fling_power, fling_effect, description) VALUES (@id, @category, @cost, @fling_power, @fling_effect, @description)'
  );
  const insertItemMarkers = db.prepare(
    'INSERT INTO item_markers (item_id, marker, value_type, value_text, value_number, value_bool) VALUES (@item_id, @marker, @value_type, @value_text, @value_number, @value_bool)'
  );
  const insertHeldItemEffects = db.prepare(
    'INSERT INTO held_item_effects (item_id, category, trigger, model_json, description, confidence) VALUES (@item_id, @category, @trigger, @model_json, @description, @confidence)'
  );

  const insertAll = db.transaction(() => {
    insertMeta.run({ key: 'schema_version', value_text: SCHEMA_VERSION, value_number: null });
    insertMeta.run({ key: 'generated_at', value_text: generatedAt, value_number: null });

    // insert parent tables before dependent tables (FK order)
    for (const row of data.types) insertTypes.run(row);
    for (const row of data.typeChart) insertTypeChart.run(row);
    for (const row of data.stats) insertStats.run(row);
    for (const row of data.pokemon) insertPokemon.run(row);
    for (const row of data.pokemonTypes) insertPokemonTypes.run(row);
    for (const row of data.pokemonStats) insertPokemonStats.run(row);
    for (const row of data.moves) insertMoves.run(row);
    for (const row of data.moveTags) insertMoveTags.run(row);
    for (const row of data.moveEffects) insertMoveEffects.run(row);
    for (const row of data.moveMarkers) insertMoveMarkers.run(row);
    for (const row of data.moveTacticalRoleSeed) insertMoveTacticalSeed.run(row);
    for (const row of data.moveTacticalRoleExpand) insertMoveTacticalExpand.run(row);
    for (const row of data.abilities) insertAbilities.run(row);
    for (const row of data.abilityEffects) insertAbilityEffects.run(row);
    for (const row of data.abilityMarkers) insertAbilityMarkers.run(row);
    for (const row of data.pokemonAbilities) insertPokemonAbilities.run(row);
    for (const row of data.pokemonMoves) insertPokemonMoves.run(row);
    for (const row of data.items) insertItems.run(row);
    for (const row of data.itemMarkers) insertItemMarkers.run(row);
    for (const row of data.heldItemEffects) insertHeldItemEffects.run(row);
  });

  insertAll();
  db.close();

  fs.renameSync(tmpPath, dbPath);
}

function buildManifest(outputDir, inputs, data, generatedAt, dbPath) {
  let dbMeta = null;
  if (dbPath && fs.existsSync(dbPath)) {
    const stats = fs.statSync(dbPath);
    dbMeta = {
      path: toRelative(dbPath),
      bytes: stats.size
    };
  }

  const manifest = {
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt,
    inputs: inputs.map((entry) => ({
      path: entry.path,
      sha256: entry.sha256,
      bytes: entry.bytes
    })),
    counts: {
      pokemon: data.pokemon.length,
      pokemon_types: data.pokemonTypes.length,
      pokemon_abilities: data.pokemonAbilities.length,
      pokemon_stats: data.pokemonStats.length,
      pokemon_moves: data.pokemonMoves.length,
      types: data.types.length,
      type_chart: data.typeChart.length,
      stats: data.stats.length,
      moves: data.moves.length,
      move_tags: data.moveTags.length,
      move_effects: data.moveEffects.length,
      move_markers: data.moveMarkers.length,
      move_tactical_role_seed: data.moveTacticalRoleSeed.length,
      move_tactical_role_expand: data.moveTacticalRoleExpand.length,
      abilities: data.abilities.length,
      ability_effects: data.abilityEffects.length,
      ability_markers: data.abilityMarkers.length,
      items: data.items.length,
      item_markers: data.itemMarkers.length,
      held_item_effects: data.heldItemEffects.length
    }
  };

  if (dbMeta) {
    manifest.artifacts = {
      sqlite: dbMeta
    };
  }

  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputFiles = collectInputFiles();
  const inputMeta = inputFiles.map(hashFile).sort((a, b) => a.path.localeCompare(b.path));

  if (!options.force && isUpToDate(options.outputDir, SCHEMA_VERSION, inputMeta, options.dbPath)) {
    console.log('NN export already up to date. Use --force to rebuild.');
    return;
  }

  const data = {
    pokemon: [],
    pokemonTypes: [],
    pokemonAbilities: [],
    pokemonStats: [],
    pokemonMoves: [],
    types: [],
    typeChart: [],
    stats: [],
    moves: [],
    moveTags: [],
    moveEffects: [],
    moveMarkers: [],
    moveTacticalRoleSeed: [],
    moveTacticalRoleExpand: [],
    abilities: [],
    abilityEffects: [],
    abilityMarkers: [],
    items: [],
    itemMarkers: [],
    heldItemEffects: []
  };

  const pokemonById = new Map();
  const pokemonByIdentifier = new Map();
  const movesById = new Map();
  const abilitiesById = new Map();
  const itemsById = new Map();

  const typesSet = new Set();
  const statsSet = new Set();
  const typePt = new Map();
  const statPt = new Map();

  const pokemonTypeSet = new Set();
  const pokemonAbilitySet = new Set();
  const pokemonStatSet = new Set();
  const pokemonMoveSet = new Set();
  const moveTagSet = new Set();
  const moveEffectSet = new Set();
  const moveMarkerSet = new Set();
  const moveTacticalSeedSet = new Set();
  const moveTacticalExpandSet = new Set();
  const abilityEffectSet = new Set();
  const abilityMarkerSet = new Set();
  const itemMarkerSet = new Set();
  const heldItemEffectSet = new Set();
  const typeChartSet = new Set();

  for (const filePath of inputFiles) {
    if (!filePath.endsWith('.pl')) {
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const facts = parsePrologFile(content);
    const generation = parseGenerationFromPath(filePath);

    for (const fact of facts) {
      const args = fact.args.map((arg) => parseArg(arg));

      switch (fact.pred) {
        case 'pokemon': {
          const id = toNumber(args[0]);
          const identifier = toText(args[1]);
          const height = toNumber(args[2]);
          const weight = toNumber(args[3]);
          const types = Array.isArray(args[4]) ? args[4] : [];
          const abilities = Array.isArray(args[5]) ? args[5] : [];
          const stats = Array.isArray(args[6]) ? args[6] : [];

          if (!Number.isFinite(id) || !identifier) {
            break;
          }

          if (!pokemonById.has(id)) {
            const row = {
              id,
              identifier,
              height_dm: Number.isFinite(height) ? height : 0,
              weight_hg: Number.isFinite(weight) ? weight : 0,
              source_generation: Number.isFinite(generation) ? generation : null
            };
            pokemonById.set(id, row);
            pokemonByIdentifier.set(identifier, row);
            data.pokemon.push(row);
          }

          types.forEach((typeId, index) => {
            if (!typeId) return;
            typesSet.add(String(typeId));
            const key = `${id}|${index}`;
            addRowUnique(data.pokemonTypes, pokemonTypeSet, key, {
              pokemon_id: id,
              slot: index + 1,
              type_id: String(typeId)
            });
          });

          abilities.forEach((abilityId, index) => {
            if (!abilityId) return;
            const key = `${id}|${index}`;
            addRowUnique(data.pokemonAbilities, pokemonAbilitySet, key, {
              pokemon_id: id,
              slot: index + 1,
              ability_id: String(abilityId)
            });
          });

          stats.forEach((entry) => {
            const parsed = parseStatToken(entry);
            if (!parsed) return;
            statsSet.add(parsed.stat);
            const key = `${id}|${parsed.stat}`;
            addRowUnique(data.pokemonStats, pokemonStatSet, key, {
              pokemon_id: id,
              stat_id: parsed.stat,
              value: parsed.value
            });
          });
          break;
        }
        case 'pokemon_move_list': {
          const identifier = toText(args[0]);
          const moves = Array.isArray(args[1]) ? args[1] : [];
          const pokemon = pokemonByIdentifier.get(identifier);
          const pokemonId = pokemon ? pokemon.id : null;

          moves.forEach((moveId) => {
            if (!moveId) return;
            const key = `${identifier}|${moveId}`;
            addRowUnique(data.pokemonMoves, pokemonMoveSet, key, {
              pokemon_identifier: identifier,
              pokemon_id: pokemonId,
              move_id: String(moveId)
            });
          });
          break;
        }
        case 'move_data_auto': {
          const moveId = toText(args[0]);
          if (!moveId) break;
          const row = {
            id: moveId,
            type_id: toText(args[1]),
            category: toText(args[2]),
            base_power: toNumber(args[3]) ?? 0,
            accuracy: toNumber(args[4]) ?? 0,
            pp: toNumber(args[5]) ?? 0,
            effect_chance: toNumber(args[7]),
            ailment: args[8] === null ? null : toText(args[8]),
            effect_category: args[9] === null ? null : toText(args[9]),
            description: toText(args[10])
          };

          if (!movesById.has(moveId)) {
            movesById.set(moveId, row);
            data.moves.push(row);
          }

          typesSet.add(row.type_id);

          const tags = Array.isArray(args[6]) ? args[6] : [];
          tags.forEach((tag) => {
            if (!tag) return;
            const key = `${moveId}|${tag}`;
            addRowUnique(data.moveTags, moveTagSet, key, {
              move_id: moveId,
              tag: String(tag)
            });
          });
          break;
        }
        case 'move_entry': {
          const moveId = toText(args[0]);
          if (!moveId || movesById.has(moveId)) {
            break;
          }

          const row = {
            id: moveId,
            type_id: toText(args[1]),
            category: toText(args[2]),
            base_power: toNumber(args[3]) ?? 0,
            accuracy: toNumber(args[4]) ?? 0,
            pp: toNumber(args[5]) ?? 0,
            effect_chance: toNumber(args[7]),
            ailment: args[8] === null ? null : toText(args[8]),
            effect_category: args[9] === null ? null : toText(args[9]),
            description: toText(args[10])
          };

          movesById.set(moveId, row);
          data.moves.push(row);
          typesSet.add(row.type_id);

          const tags = Array.isArray(args[6]) ? args[6] : [];
          tags.forEach((tag) => {
            if (!tag) return;
            const key = `${moveId}|${tag}`;
            addRowUnique(data.moveTags, moveTagSet, key, {
              move_id: moveId,
              tag: String(tag)
            });
          });
          break;
        }
        case 'move_effect': {
          const moveId = toText(args[0]);
          if (!moveId) break;
          const category = toText(args[1]);
          const trigger = toText(args[2]);
          const model = normalizeModelList(args[3]);
          const description = toText(args[4]);
          const confidence = toNumber(args[5]);

          const key = `${moveId}|${category}|${trigger}`;
          addRowUnique(data.moveEffects, moveEffectSet, key, {
            move_id: moveId,
            category,
            trigger,
            model_json: JSON.stringify(model),
            description,
            confidence
          });
          break;
        }
        case 'move_marker': {
          const moveId = toText(args[0]);
          const marker = toText(args[1]);
          if (!moveId || !marker) break;
          const normalized = normalizeMarkerValue(args[2]);
          const key = `${moveId}|${marker}|${normalized.value_type}|${normalized.value_text}`;
          addRowUnique(data.moveMarkers, moveMarkerSet, key, {
            move_id: moveId,
            marker,
            ...normalized
          });
          break;
        }
        case 'move_tactical_role_seed': {
          const moveId = toText(args[0]);
          const role = toText(args[1]);
          if (!moveId || !role) break;
          const key = `${moveId}|${role}`;
          addRowUnique(data.moveTacticalRoleSeed, moveTacticalSeedSet, key, {
            move_id: moveId,
            role
          });
          break;
        }
        case 'move_tactical_role_expand': {
          const role = toText(args[0]);
          const expanded = toText(args[1]);
          if (!role || !expanded) break;
          const key = `${role}|${expanded}`;
          addRowUnique(data.moveTacticalRoleExpand, moveTacticalExpandSet, key, {
            role,
            expanded_role: expanded
          });
          break;
        }
        case 'ability_entry': {
          const abilityId = toText(args[0]);
          if (!abilityId || abilitiesById.has(abilityId)) break;
          const row = {
            id: abilityId,
            generation: toText(args[1]),
            is_main_series: args[2] ? 1 : 0,
            short_effect: args[3] === null ? null : toText(args[3]),
            effect: args[4] === null ? null : toText(args[4])
          };
          abilitiesById.set(abilityId, row);
          data.abilities.push(row);
          break;
        }
        case 'ability_effect': {
          const abilityId = toText(args[0]);
          if (!abilityId) break;
          const category = toText(args[1]);
          const trigger = toText(args[2]);
          const model = normalizeModelList(args[3]);
          const description = toText(args[4]);
          const key = `${abilityId}|${category}|${trigger}`;

          addRowUnique(data.abilityEffects, abilityEffectSet, key, {
            ability_id: abilityId,
            category,
            trigger,
            model_json: JSON.stringify(model),
            description
          });
          break;
        }
        case 'ability_marker': {
          const abilityId = toText(args[0]);
          const marker = toText(args[1]);
          if (!abilityId || !marker) break;
          const normalized = normalizeMarkerValue(args[2]);
          const key = `${abilityId}|${marker}|${normalized.value_type}|${normalized.value_text}`;
          addRowUnique(data.abilityMarkers, abilityMarkerSet, key, {
            ability_id: abilityId,
            marker,
            ...normalized
          });
          break;
        }
        case 'item_entry': {
          const itemId = toText(args[0]);
          if (!itemId || itemsById.has(itemId)) break;
          const row = {
            id: itemId,
            category: toText(args[1]),
            cost: toNumber(args[2]) ?? 0,
            fling_power: toNumber(args[3]) ?? 0,
            fling_effect: args[4] === null ? null : toText(args[4]),
            description: args[5] === null ? null : toText(args[5])
          };
          itemsById.set(itemId, row);
          data.items.push(row);
          break;
        }
        case 'item_marker': {
          const itemId = toText(args[0]);
          const marker = toText(args[1]);
          if (!itemId || !marker) break;
          const normalized = normalizeMarkerValue(args[2]);
          const key = `${itemId}|${marker}|${normalized.value_type}|${normalized.value_text}`;
          addRowUnique(data.itemMarkers, itemMarkerSet, key, {
            item_id: itemId,
            marker,
            ...normalized
          });
          break;
        }
        case 'held_item_effect': {
          const itemId = toText(args[0]);
          if (!itemId) break;
          const category = toText(args[1]);
          const trigger = toText(args[2]);
          const model = normalizeModelList(args[3]);
          const description = toText(args[4]);
          const confidence = toNumber(args[5]);
          const key = `${itemId}|${category}|${trigger}`;

          addRowUnique(data.heldItemEffects, heldItemEffectSet, key, {
            item_id: itemId,
            category,
            trigger,
            model_json: JSON.stringify(model),
            description,
            confidence
          });
          break;
        }
        case 'type_pt': {
          const typeId = toText(args[0]);
          const label = args[1] === null ? null : toText(args[1]);
          if (!typeId) break;
          typesSet.add(typeId);
          if (label !== null) {
            typePt.set(typeId, label);
          }
          break;
        }
        case 'stat_pt': {
          const statId = toText(args[0]);
          const label = args[1] === null ? null : toText(args[1]);
          if (!statId) break;
          statsSet.add(statId);
          if (label !== null) {
            statPt.set(statId, label);
          }
          break;
        }
        case 'type_chart': {
          const attackType = toText(args[0]);
          const defenseType = toText(args[1]);
          const mult = toNumber(args[2]);
          if (!attackType || !defenseType || mult === null) break;
          typesSet.add(attackType);
          typesSet.add(defenseType);
          const key = `${attackType}|${defenseType}`;
          addRowUnique(data.typeChart, typeChartSet, key, {
            attack_type: attackType,
            defense_type: defenseType,
            multiplier: mult
          });
          break;
        }
        case 'all_types': {
          const list = Array.isArray(args[0]) ? args[0] : [];
          list.forEach((typeId) => {
            if (!typeId) return;
            typesSet.add(String(typeId));
          });
          break;
        }
        default:
          break;
      }
    }
  }

  for (const typeId of Array.from(typesSet)) {
    data.types.push({
      id: typeId,
      pt_label: typePt.get(typeId) || null
    });
  }

  for (const statId of Array.from(statsSet)) {
    data.stats.push({
      id: statId,
      pt_label: statPt.get(statId) || null
    });
  }

  sortRows(data);

  // Drop dangling FK refs: abilities/moves in pokemon data not present in catalogs
  const knownAbilityIds = new Set(data.abilities.map((r) => r.id));
  const knownMoveIds = new Set(data.moves.map((r) => r.id));
  const knownItemIds = new Set(data.items.map((r) => r.id));
  const knownPokemonIdentifiers = new Set(data.pokemon.map((r) => r.identifier));
  const beforeAbilities = data.pokemonAbilities.length;
  const beforeMoves = data.pokemonMoves.length;
  data.pokemonAbilities = data.pokemonAbilities.filter((r) => knownAbilityIds.has(r.ability_id));
  data.pokemonMoves = data.pokemonMoves.filter(
    (r) => knownMoveIds.has(r.move_id) && knownPokemonIdentifiers.has(r.pokemon_identifier)
  );
  data.moveEffects = data.moveEffects.filter((r) => knownMoveIds.has(r.move_id));
  data.moveTags = data.moveTags.filter((r) => knownMoveIds.has(r.move_id));
  data.moveMarkers = data.moveMarkers.filter((r) => knownMoveIds.has(r.move_id));
  data.abilityEffects = data.abilityEffects.filter((r) => knownAbilityIds.has(r.ability_id));
  data.abilityMarkers = data.abilityMarkers.filter((r) => knownAbilityIds.has(r.ability_id));
  data.heldItemEffects = data.heldItemEffects.filter((r) => knownItemIds.has(r.item_id));
  data.itemMarkers = data.itemMarkers.filter((r) => knownItemIds.has(r.item_id));
  const droppedAbilities = beforeAbilities - data.pokemonAbilities.length;
  const droppedMoves = beforeMoves - data.pokemonMoves.length;
  if (droppedAbilities > 0) console.warn(`[warn] dropped ${droppedAbilities} pokemon_abilities with unknown ability_id`);
  if (droppedMoves > 0) console.warn(`[warn] dropped ${droppedMoves} pokemon_moves with unknown move_id`);

  ensureDir(options.outputDir);
  const generatedAt = new Date().toISOString();
  writeOutputs(options.outputDir, data);
  writeSqlite(options.dbPath, data, generatedAt);
  buildManifest(options.outputDir, inputMeta, data, generatedAt, options.dbPath);

  console.log('NN export completed.');
  console.log(`Output: ${options.outputDir}`);
  console.log(`SQLite: ${options.dbPath}`);
}

main();
