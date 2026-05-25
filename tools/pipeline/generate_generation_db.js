'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const { openDb } = require('./sqlite_writer');

const useInsecureTls = process.env.POKEDEX_INSECURE_TLS === '1';

function sanitizeAtom(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function toTitleCase(value) {
  return String(value)
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function statAlias(name) {
  const map = {
    hp: 'hp', attack: 'attack', defense: 'defense',
    'special-attack': 'special_attack', 'special-defense': 'special_defense', speed: 'speed',
  };
  return map[name] || sanitizeAtom(name);
}

function mapLabel(map, key, fallback = 'desconhecido') {
  if (!key) return fallback;
  const normalizedKey = String(key).replace(/-/g, '_');
  return map[normalizedKey] || map[key] || key;
}

const VERSION_PRIORITY_BY_GENERATION = {
  1: ['yellow', 'red', 'blue'],
  2: ['crystal', 'gold', 'silver'],
  3: ['emerald', 'ruby', 'sapphire', 'firered', 'leafgreen'],
  4: ['platinum', 'diamond', 'pearl', 'heartgold', 'soulsilver'],
  5: ['black', 'white', 'black-2', 'white-2'],
  6: ['x', 'y', 'omega-ruby', 'alpha-sapphire'],
  7: ['ultra-sun', 'ultra-moon', 'sun', 'moon'],
  8: ['sword', 'shield', 'legends-arceus', 'brilliant-diamond', 'shining-pearl'],
  9: ['scarlet', 'violet'],
};

function cleanFlavorText(text) {
  return String(text || '').replace(/[\n\f\r]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractIdFromUrl(url) {
  const match = String(url || '').match(/\/(\d+)\/?$/);
  return match ? Number(match[1]) : 0;
}

function evolutionConditionAtom(detail) {
  if (!detail || typeof detail !== 'object') return null;
  const parts = [];
  if (detail.item?.name) parts.push(`item_${detail.item.name}`);
  if (detail.held_item?.name) parts.push(`held_${detail.held_item.name}`);
  if (detail.known_move?.name) parts.push(`move_${detail.known_move.name}`);
  if (detail.known_move_type?.name) parts.push(`move_type_${detail.known_move_type.name}`);
  if (detail.location?.name) parts.push(`location_${detail.location.name}`);
  if (detail.time_of_day) parts.push(`time_${detail.time_of_day}`);
  if (detail.trade_species?.name) parts.push(`trade_with_${detail.trade_species.name}`);
  if (Number.isInteger(detail.min_happiness)) parts.push(`happiness_${detail.min_happiness}`);
  if (Number.isInteger(detail.min_affection)) parts.push(`affection_${detail.min_affection}`);
  if (Number.isInteger(detail.min_beauty)) parts.push(`beauty_${detail.min_beauty}`);
  if (detail.needs_overworld_rain) parts.push('needs_rain');
  if (detail.turn_upside_down) parts.push('turn_upside_down');
  if (parts.length === 0) return null;
  return sanitizeAtom(parts.join('_and_'));
}

function collectEvolutionFacts(chainNode, factsOut) {
  if (!chainNode || !chainNode.species) return;
  const fromId = extractIdFromUrl(chainNode.species.url);
  const evolvesTo = Array.isArray(chainNode.evolves_to) ? chainNode.evolves_to : [];
  for (const evo of evolvesTo) {
    const toId = extractIdFromUrl(evo?.species?.url);
    const details = Array.isArray(evo?.evolution_details) && evo.evolution_details.length > 0
      ? evo.evolution_details : [{}];
    for (const detail of details) {
      const trigger = sanitizeAtom(detail?.trigger?.name || 'unknown');
      const minLevel = Number.isInteger(detail?.min_level) ? detail.min_level : null;
      const condition = evolutionConditionAtom(detail || {});
      if (fromId > 0 && toId > 0) {
        factsOut.push({ fromId, toId, trigger, minLevel, condition });
      }
    }
    collectEvolutionFacts(evo, factsOut);
  }
}

function stripDiacritics(text) {
  return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function pickFlavorText(speciesData, generation, languageName) {
  const entries = (speciesData.flavor_text_entries || []).filter(
    (entry) => entry?.language?.name === languageName && entry?.flavor_text
  );
  if (entries.length === 0) return null;
  const priorities = VERSION_PRIORITY_BY_GENERATION[generation] || [];
  for (const versionName of priorities) {
    const match = entries.find((entry) => entry.version?.name === versionName);
    if (match) return cleanFlavorText(match.flavor_text);
  }
  return cleanFlavorText(entries[0].flavor_text);
}

function buildLoreText(pokemon, speciesData, generation) {
  const englishFlavor = pickFlavorText(speciesData, generation, 'en');
  if (englishFlavor) return cleanFlavorText(englishFlavor);

  const habitatMap = { cave: 'caves', forest: 'forests', grassland: 'open grasslands', mountain: 'mountainous regions', rare: 'rare and hard-to-reach places', rough_terrain: 'rough terrain', sea: 'seas and oceans', urban: 'urban areas', waters_edge: 'riverbanks and lake shores' };
  const colorMap = { black: 'dark', blue: 'bluish', brown: 'brownish', gray: 'grayish', green: 'greenish', pink: 'pinkish', purple: 'purple-toned', red: 'reddish', white: 'light-colored', yellow: 'yellowish' };
  const shapeMap = { ball: 'a rounded body', squiggle: 'a serpentine body', fish: 'a fish-like body', arms: 'a shape with prominent arms', blob: 'an amorphous shape', upright: 'an upright posture', legs: 'a bipedal posture', quadruped: 'a quadrupedal posture', wings: 'a winged body', tentacles: 'a tentacled form', heads: 'a structure with multiple heads', humanoid: 'a humanoid appearance', bug_wings: 'an insect-like body with wings', armor: 'an armor-like body' };
  const typeMapPt = { normal: 'Normal', fire: 'Fire', water: 'Water', electric: 'Electric', grass: 'Grass', ice: 'Ice', fighting: 'Fighting', poison: 'Poison', ground: 'Ground', flying: 'Flying', psychic: 'Psychic', bug: 'Bug', rock: 'Rock', ghost: 'Ghost', dragon: 'Dragon', dark: 'Dark', steel: 'Steel', fairy: 'Fairy' };

  const types = [...pokemon.types].sort((a, b) => a.slot - b.slot).map((t) => sanitizeAtom(t.type.name)).map((t) => typeMapPt[t] || toTitleCase(t.replace(/_/g, ' ')));
  const typeText = types.join('/');
  const nameText = toTitleCase(sanitizeAtom(pokemon.name).replace(/_/g, ' '));
  const habitat = mapLabel(habitatMap, speciesData.habitat?.name, 'poorly documented habitats');
  const color = mapLabel(colorMap, speciesData.color?.name, 'varied coloration');
  const shape = mapLabel(shapeMap, speciesData.shape?.name, 'a unique body structure');

  let rarityText = 'It is considered a species commonly seen in its region.';
  if (speciesData.is_mythical) rarityText = 'It is classified as a Mythical Pokémon, surrounded by rare and mysterious reports.';
  else if (speciesData.is_legendary) rarityText = 'It is classified as a Legendary Pokémon and appears in very few reliable records.';
  else if (speciesData.is_baby) rarityText = 'It is a baby form, usually needing more care and showing more delicate behavior.';

  const evoText = speciesData.evolves_from_species
    ? `Its evolutionary line starts from ${toTitleCase(String(speciesData.evolves_from_species.name).replace(/-/g, ' '))}.`
    : 'Its evolutionary line begins in this form.';

  return `${nameText} is a ${typeText}-type Pokémon. It is often found in ${habitat}, with a ${color} appearance and ${shape}. ${rarityText} ${evoText}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', rejectUnauthorized: !useInsecureTls, headers: { 'User-Agent': 'local-prolog-pokedex-generator', Accept: 'application/json' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(requestJson(res.headers.location));
        return;
      }
      if (res.statusCode !== 200) { reject(new Error(`Erro HTTP ${res.statusCode} em ${url}`)); return; }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (error) { reject(new Error(`JSON invalido em ${url}: ${error.message}`)); }
      });
    });
    req.on('error', (error) => reject(error));
    req.end();
  });
}

async function getJson(url, maxRetries = 4) {
  let attempt = 0;
  while (true) {
    try { return await requestJson(url); }
    catch (error) {
      attempt += 1;
      if (attempt > maxRetries) throw new Error(`Falha ao buscar ${url}: ${error.message}`);
      await sleep(1000 * attempt);
    }
  }
}

function detectSpecialFormKind(name) {
  if (/-mega(?:-|$)/.test(name)) return 'mega';
  if (/-alola$/.test(name)) return 'alola';
  if (/-galar$/.test(name)) return 'galar';
  if (/-hisui$/.test(name)) return 'hisui';
  if (/-paldea$/.test(name)) return 'paldea';
  return null;
}

function specialFormLabel(kind) {
  const labels = { mega: 'Mega', alola: 'Alolan', galar: 'Galarian', hisui: 'Hisuian', paldea: 'Paldean' };
  return labels[kind] || 'Special';
}

// ---------------------------------------------------------------------------
// SQLite write helpers
// ---------------------------------------------------------------------------

function writeGenerationToDb(db, { generation, pokemonRows, typeIds, statIds, pokemonTypeRows, pokemonAbilityRows, pokemonStatRows, loreRows, evolutionRows }) {
  const stmtType = db.prepare('INSERT OR IGNORE INTO types (id, pt_label) VALUES (?, NULL)');
  const stmtStat = db.prepare('INSERT OR IGNORE INTO stats (id, pt_label) VALUES (?, NULL)');
  const stmtPkm = db.prepare('INSERT OR REPLACE INTO pokemon (id, identifier, height_dm, weight_hg, source_generation) VALUES (@id, @identifier, @height_dm, @weight_hg, @source_generation)');
  const stmtTypes = db.prepare('INSERT OR REPLACE INTO pokemon_types (pokemon_id, slot, type_id) VALUES (@pokemon_id, @slot, @type_id)');
  const stmtAbilities = db.prepare('INSERT OR REPLACE INTO pokemon_abilities (pokemon_id, slot, ability_id) VALUES (@pokemon_id, @slot, @ability_id)');
  const stmtStats = db.prepare('INSERT OR REPLACE INTO pokemon_stats (pokemon_id, stat_id, value) VALUES (@pokemon_id, @stat_id, @value)');
  const stmtLore = db.prepare('INSERT OR REPLACE INTO pokemon_lore (pokemon_id, slot, entry) VALUES (@pokemon_id, @slot, @entry)');
  const stmtEvo = db.prepare('INSERT OR IGNORE INTO pokemon_evolution (from_id, to_id, trigger, min_level, condition) VALUES (@from_id, @to_id, @trigger, @min_level, @condition)');

  db.transaction(() => {
    for (const typeId of typeIds) stmtType.run(typeId);
    for (const statId of statIds) stmtStat.run(statId);
    for (const row of pokemonRows) stmtPkm.run(row);
    for (const row of pokemonTypeRows) stmtTypes.run(row);
    for (const row of pokemonAbilityRows) stmtAbilities.run(row);
    for (const row of pokemonStatRows) stmtStats.run(row);
    for (const row of loreRows) stmtLore.run(row);
    for (const row of evolutionRows) stmtEvo.run(row);
  })();
}

// ---------------------------------------------------------------------------
// Main generators
// ---------------------------------------------------------------------------

async function generateOneGeneration(generation, db) {
  console.log(`Gerando geracao ${generation}...`);

  const generationData = await getJson(`https://pokeapi.co/api/v2/generation/${generation}`);
  const species = generationData.pokemon_species
    .map((s) => ({ name: s.name, id: Number(s.url.match(/\/(\d+)\/?$/)?.[1] || 0) }))
    .filter((s) => s.id > 0)
    .sort((a, b) => a.id - b.id);

  const pokemonRows = [];
  const pokemonTypeRows = [];
  const pokemonAbilityRows = [];
  const pokemonStatRows = [];
  const loreRows = [];
  const evolutionRows = [];
  const typeIds = new Set();
  const statIds = new Set();
  const evolutionCache = new Map();
  const evolutionKeys = new Set();

  for (const s of species) {
    const pokemon = await getJson(`https://pokeapi.co/api/v2/pokemon/${s.id}`);
    const speciesData = await getJson(`https://pokeapi.co/api/v2/pokemon-species/${s.id}`);

    const id = pokemon.id;
    const identifier = sanitizeAtom(pokemon.name);

    pokemonRows.push({ id, identifier, height_dm: pokemon.height, weight_hg: pokemon.weight, source_generation: generation });

    const sortedTypes = [...pokemon.types].sort((a, b) => a.slot - b.slot);
    for (const t of sortedTypes) {
      const typeId = sanitizeAtom(t.type.name);
      typeIds.add(typeId);
      pokemonTypeRows.push({ pokemon_id: id, slot: t.slot, type_id: typeId });
    }

    const sortedAbilities = [...pokemon.abilities].sort((a, b) => a.slot - b.slot);
    for (const a of sortedAbilities) {
      pokemonAbilityRows.push({ pokemon_id: id, slot: a.slot, ability_id: sanitizeAtom(a.ability.name) });
    }

    for (const s of pokemon.stats) {
      const statId = statAlias(s.stat.name);
      statIds.add(statId);
      pokemonStatRows.push({ pokemon_id: id, stat_id: statId, value: s.base_stat });
    }

    loreRows.push({ pokemon_id: id, slot: 1, entry: buildLoreText(pokemon, speciesData, generation) });

    const evolutionChainUrl = speciesData?.evolution_chain?.url;
    if (evolutionChainUrl) {
      if (!evolutionCache.has(evolutionChainUrl)) {
        const chainData = await getJson(evolutionChainUrl);
        const facts = [];
        collectEvolutionFacts(chainData?.chain, facts);
        evolutionCache.set(evolutionChainUrl, facts);
      }
      for (const evo of evolutionCache.get(evolutionChainUrl)) {
        const key = `${evo.fromId}-${evo.toId}-${evo.trigger}-${evo.minLevel}-${evo.condition}`;
        if (!evolutionKeys.has(key)) {
          evolutionKeys.add(key);
          evolutionRows.push({ from_id: evo.fromId, to_id: evo.toId, trigger: evo.trigger, min_level: evo.minLevel, condition: evo.condition });
        }
      }
    }
  }

  writeGenerationToDb(db, { generation, pokemonRows, typeIds, statIds, pokemonTypeRows, pokemonAbilityRows, pokemonStatRows, loreRows, evolutionRows });

  console.log(`Geracao ${generation}: ${pokemonRows.length} pokemon, ${loreRows.length} lore, ${evolutionRows.length} evolucoes escritas.`);
}

async function generateSpecialForms(db) {
  console.log('Gerando formas especiais (Mega e regionais)...');

  const pokemonIndex = await getJson('https://pokeapi.co/api/v2/pokemon?limit=20000');
  const specialEntries = (pokemonIndex.results || []).filter((entry) => Boolean(detectSpecialFormKind(entry.name)));

  const stmtType = db.prepare('INSERT OR IGNORE INTO types (id, pt_label) VALUES (?, NULL)');
  const stmtStat = db.prepare('INSERT OR IGNORE INTO stats (id, pt_label) VALUES (?, NULL)');
  const stmtPkm = db.prepare('INSERT OR REPLACE INTO pokemon (id, identifier, height_dm, weight_hg, source_generation) VALUES (@id, @identifier, @height_dm, @weight_hg, @source_generation)');
  const stmtPkmTypes = db.prepare('INSERT OR REPLACE INTO pokemon_types (pokemon_id, slot, type_id) VALUES (@pokemon_id, @slot, @type_id)');
  const stmtPkmAbilities = db.prepare('INSERT OR REPLACE INTO pokemon_abilities (pokemon_id, slot, ability_id) VALUES (@pokemon_id, @slot, @ability_id)');
  const stmtPkmStats = db.prepare('INSERT OR REPLACE INTO pokemon_stats (pokemon_id, stat_id, value) VALUES (@pokemon_id, @stat_id, @value)');
  const stmtLore = db.prepare('INSERT OR REPLACE INTO pokemon_lore (pokemon_id, slot, entry) VALUES (@pokemon_id, @slot, @entry)');
  const stmtForm = db.prepare('INSERT OR REPLACE INTO pokemon_forms (form_id, base_id, form_type) VALUES (@form_id, @base_id, @form_type)');

  let formCount = 0;

  for (const entry of specialEntries) {
    const kind = detectSpecialFormKind(entry.name);
    if (!kind) continue;

    const pokemonData = await getJson(entry.url);
    const speciesData = await getJson(pokemonData.species.url);
    const baseSpeciesId = speciesData.id;
    const id = pokemonData.id;
    const identifier = sanitizeAtom(pokemonData.name);
    const loreBaseName = String(speciesData.name || '').replace(/-/g, ' ');
    const loreText = `${toTitleCase(loreBaseName)} ${specialFormLabel(kind)} form.`;

    db.transaction(() => {
      const sortedTypes = [...pokemonData.types].sort((a, b) => a.slot - b.slot);
      for (const t of sortedTypes) {
        stmtType.run(sanitizeAtom(t.type.name));
      }
      for (const s of pokemonData.stats) {
        stmtStat.run(statAlias(s.stat.name));
      }
      stmtPkm.run({ id, identifier, height_dm: pokemonData.height, weight_hg: pokemonData.weight, source_generation: null });
      for (const t of sortedTypes) {
        stmtPkmTypes.run({ pokemon_id: id, slot: t.slot, type_id: sanitizeAtom(t.type.name) });
      }
      const sortedAbilities = [...pokemonData.abilities].sort((a, b) => a.slot - b.slot);
      for (const a of sortedAbilities) {
        stmtPkmAbilities.run({ pokemon_id: id, slot: a.slot, ability_id: sanitizeAtom(a.ability.name) });
      }
      for (const s of pokemonData.stats) {
        stmtPkmStats.run({ pokemon_id: id, stat_id: statAlias(s.stat.name), value: s.base_stat });
      }
      stmtLore.run({ pokemon_id: id, slot: 1, entry: loreText });
      stmtForm.run({ form_id: id, base_id: baseSpeciesId, form_type: kind });
    })();

    formCount += 1;
  }

  console.log(`Formas especiais: ${formCount} formas escritas.`);
}

function parseGenerationsArg(arg) {
  if (!arg || arg === 'all' || arg === 'todas') return [1, 2, 3, 4, 5, 6, 7, 8, 9];
  if (arg.includes(',')) {
    const values = arg.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= 9);
    if (values.length === 0) throw new Error('Uso: node tools/generate_generation_db.js <1..9|all|1,2,3>');
    return [...new Set(values)].sort((a, b) => a - b);
  }
  const generation = Number(arg);
  if (!Number.isInteger(generation) || generation < 1 || generation > 9) {
    throw new Error('Uso: node tools/generate_generation_db.js <1..9|all|1,2,3>');
  }
  return [generation];
}

async function main() {
  if (useInsecureTls) {
    console.warn('[warn] TLS inseguro habilitado (POKEDEX_INSECURE_TLS=1). Use apenas em rede corporativa com inspecao SSL.');
  }

  const db = openDb();

  const arg = process.argv[2] || 'all';
  if (arg === 'mega' || arg === 'formas' || arg === 'special') {
    await generateSpecialForms(db);
  } else {
    const generations = parseGenerationsArg(arg);
    for (const generation of generations) {
      await generateOneGeneration(generation, db);
    }
    await generateSpecialForms(db);
  }

  db.close();
  console.log('Geracao(oes) finalizada(s) com sucesso.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
