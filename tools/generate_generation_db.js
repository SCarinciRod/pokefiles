const fs = require('fs');
const path = require('path');
const https = require('https');
const useInsecureTls = process.env.POKEDEX_INSECURE_TLS === '1';

function sanitizeAtom(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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

function prologQuotedText(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function formatTypes(types) {
  const sorted = [...types].sort((a, b) => a.slot - b.slot);
  return `[${sorted.map((t) => sanitizeAtom(t.type.name)).join(', ')}]`;
}

function formatAbilities(abilities) {
  const sorted = [...abilities].sort((a, b) => a.slot - b.slot);
  return `[${sorted.map((a) => sanitizeAtom(a.ability.name)).join(', ')}]`;
}

function statAlias(name) {
  const map = {
    hp: 'hp',
    attack: 'attack',
    defense: 'defense',
    'special-attack': 'special_attack',
    'special-defense': 'special_defense',
    speed: 'speed',
  };
  return map[name] || sanitizeAtom(name);
}

function formatStats(stats) {
  const sorted = [...stats].sort((a, b) => a.stat.name.localeCompare(b.stat.name));
  return `[${sorted
    .map((s) => `${statAlias(s.stat.name)}-${s.base_stat}`)
    .join(', ')}]`;
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
  return String(text || '')
    .replace(/[\n\f\r]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractIdFromUrl(url) {
  const match = String(url || '').match(/\/(\d+)\/?$/);
  return match ? Number(match[1]) : 0;
}

function evolutionConditionAtom(detail) {
  if (!detail || typeof detail !== 'object') return 'none';
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
  if (typeof detail.needs_overworld_rain === 'boolean' && detail.needs_overworld_rain) {
    parts.push('needs_rain');
  }
  if (typeof detail.turn_upside_down === 'boolean' && detail.turn_upside_down) {
    parts.push('turn_upside_down');
  }
  if (parts.length === 0) return 'none';
  return sanitizeAtom(parts.join('_and_'));
}

function collectEvolutionFacts(chainNode, factsOut) {
  if (!chainNode || !chainNode.species) return;
  const fromId = extractIdFromUrl(chainNode.species.url);
  const evolvesTo = Array.isArray(chainNode.evolves_to) ? chainNode.evolves_to : [];

  for (const evo of evolvesTo) {
    const toId = extractIdFromUrl(evo?.species?.url);
    const details = Array.isArray(evo?.evolution_details) && evo.evolution_details.length > 0
      ? evo.evolution_details
      : [{}];

    for (const detail of details) {
      const trigger = sanitizeAtom(detail?.trigger?.name || 'unknown');
      const minLevel = Number.isInteger(detail?.min_level) ? detail.min_level : 'none';
      const condition = evolutionConditionAtom(detail || {});
      if (fromId > 0 && toId > 0) {
        factsOut.push({ fromId, toId, trigger, minLevel, condition });
      }
    }

    collectEvolutionFacts(evo, factsOut);
  }
}

function stripDiacritics(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
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

function translateSpanishFlavorToPortuguese(text) {
  const replacements = [
    [/\bpara acabar con\b/g, 'para acabar com'],
    [/\ben momentos de apuro\b/g, 'em momentos de aperto'],
    [/\bse esconde en\b/g, 'se esconde em'],
    [/\bse protege con\b/g, 'se protege com'],
    [/\bpara protegerse\b/g, 'para se proteger'],
    [/\bsuele usar\b/g, 'costuma usar'],
    [/\bsuele habitar\b/g, 'costuma habitar'],
    [/\bsuelen pinchar\b/g, 'costumam perfurar'],
    [/\bsi es golpeado\b/g, 'se for atingido'],
    [/\baun asi\b/g, 'ainda assim'],
    [/\ba presion\b/g, 'sob pressão'],
    [/\bse dice que\b/g, 'diz-se que'],
    [/\bdicen que\b/g, 'dizem que'],
    [/\bde su\b/g, 'de seu'],
    [/\bde sus\b/g, 'de seus'],
    [/\bcon\b/g, 'com'],
    [/\ben\b/g, 'em'],
    [/\by\b/g, 'e'],
    [/\bpero\b/g, 'mas'],
    [/\bdel\b/g, 'do'],
    [/\bal\b/g, 'ao'],
    [/\bpokemon\b/g, 'pokemon'],
    [/\bcuando\b/g, 'quando'],
    [/\buna\b/g, 'uma'],
    [/\bun\b/g, 'um'],
    [/\bla\b/g, 'a'],
    [/\bel\b/g, 'o'],
    [/\blas\b/g, 'as'],
    [/\blos\b/g, 'os'],
    [/\blanza\b/g, 'lanca'],
    [/\blanzan\b/g, 'lancam'],
    [/\bdescarga\b/g, 'descarga'],
    [/\bdescargas\b/g, 'descargas'],
    [/\bsupercaliente\b/g, 'superquente'],
    [/\broja\b/g, 'vermelha'],
    [/\brojo\b/g, 'vermelho'],
    [/\bbrilla\b/g, 'brilha'],
    [/\bbrillan\b/g, 'brilham'],
    [/\bmas\b/g, 'mais'],
    [/\besta\b/g, 'esta'],
    [/\beste\b/g, 'este'],
    [/\bestos\b/g, 'estes'],
    [/\bestas\b/g, 'estas'],
    [/\bde su\b/g, 'da sua'],
    [/\bde sus\b/g, 'de suas'],
    [/\bsu\b/g, 'seu'],
    [/\bsus\b/g, 'seus'],
    [/\bseu\b/g, 'seu'],
    [/\bcola\b/g, 'cauda'],
    [/\bllama\b/g, 'chama'],
    [/\bfuego\b/g, 'fogo'],
    [/\bagua\b/g, 'agua'],
    [/\bhierba\b/g, 'grama'],
    [/\broca\b/g, 'pedra'],
    [/\btrueno\b/g, 'trovao'],
    [/\brayo\b/g, 'raio'],
    [/\bvuela\b/g, 'voa'],
    [/\bvolar\b/g, 'voar'],
    [/\bcuerpo\b/g, 'corpo'],
    [/\bataque\b/g, 'ataque'],
    [/\bdefensa\b/g, 'defesa'],
    [/\benergia\b/g, 'energia'],
    [/\bsiempre\b/g, 'sempre'],
    [/\bpuede\b/g, 'pode'],
    [/\bpueden\b/g, 'podem'],
    [/\bhabita\b/g, 'habita'],
    [/\bvive\b/g, 'vive'],
    [/\bregion\b/g, 'regiao'],
    [/\benemigo\b/g, 'inimigo'],
    [/\bcaparazon\b/g, 'casco'],
    [/\bpeso\b/g, 'peso'],
    [/\baplasta\b/g, 'esmaga'],
    [/\btiene\b/g, 'tem'],
    [/\besta\b/g, 'está'],
    [/\besta\b/g, 'esta'],
    [/\bestan\b/g, 'estão'],
    [/\bsera\b/g, 'será'],
    [/\bestos\b/g, 'estes'],
    [/\besta\b/g, 'esta'],
    [/\bestas\b/g, 'estas'],
    [/\blo\b/g, 'o'],
    [/\bmontanas\b/g, 'montanhas'],
    [/\bbosques\b/g, 'florestas'],
    [/\bcueva\b/g, 'caverna'],
    [/\bmar\b/g, 'mar'],
    [/\blago\b/g, 'lago'],
    [/\bse dice que\b/g, 'diz-se que'],
    [/\bdicen que\b/g, 'dizem que'],
  ];

  let output = stripDiacritics(cleanFlavorText(text).toLowerCase());
  for (const [pattern, replacement] of replacements) {
    output = output.replace(pattern, replacement);
  }

  output = output
    .replace(/\s+,/g, ',')
    .replace(/\s+\./g, '.')
    .replace(/\s+/g, ' ')
    .trim();

  if (output.length === 0) return output;
  return output[0].toUpperCase() + output.slice(1);
}

function buildLoreText(pokemon, speciesData, generation) {
  const englishFlavor = pickFlavorText(speciesData, generation, 'en');
  if (englishFlavor) {
    return cleanFlavorText(englishFlavor);
  }

  const habitatMap = {
    cave: 'caves',
    forest: 'forests',
    grassland: 'open grasslands',
    mountain: 'mountainous regions',
    rare: 'rare and hard-to-reach places',
    rough_terrain: 'rough terrain',
    sea: 'seas and oceans',
    urban: 'urban areas',
    waters_edge: 'riverbanks and lake shores',
  };

  const colorMap = {
    black: 'dark',
    blue: 'bluish',
    brown: 'brownish',
    gray: 'grayish',
    green: 'greenish',
    pink: 'pinkish',
    purple: 'purple-toned',
    red: 'reddish',
    white: 'light-colored',
    yellow: 'yellowish',
  };

  const shapeMap = {
    ball: 'a rounded body',
    squiggle: 'a serpentine body',
    fish: 'a fish-like body',
    arms: 'a shape with prominent arms',
    blob: 'an amorphous shape',
    upright: 'an upright posture',
    legs: 'a bipedal posture',
    quadruped: 'a quadrupedal posture',
    wings: 'a winged body',
    tentacles: 'a tentacled form',
    heads: 'a structure with multiple heads',
    humanoid: 'a humanoid appearance',
    bug_wings: 'an insect-like body with wings',
    armor: 'an armor-like body',
  };

  const typeMapPt = {
    normal: 'Normal',
    fire: 'Fire',
    water: 'Water',
    electric: 'Electric',
    grass: 'Grass',
    ice: 'Ice',
    fighting: 'Fighting',
    poison: 'Poison',
    ground: 'Ground',
    flying: 'Flying',
    psychic: 'Psychic',
    bug: 'Bug',
    rock: 'Rock',
    ghost: 'Ghost',
    dragon: 'Dragon',
    dark: 'Dark',
    steel: 'Steel',
    fairy: 'Fairy',
  };

  const types = [...pokemon.types]
    .sort((a, b) => a.slot - b.slot)
    .map((t) => sanitizeAtom(t.type.name))
    .map((t) => typeMapPt[t] || toTitleCase(t.replace(/_/g, ' ')));

  const typeText = types.join('/');
  const nameText = toTitleCase(sanitizeAtom(pokemon.name).replace(/_/g, ' '));
  const habitat = mapLabel(habitatMap, speciesData.habitat?.name, 'poorly documented habitats');
  const color = mapLabel(colorMap, speciesData.color?.name, 'varied coloration');
  const shape = mapLabel(shapeMap, speciesData.shape?.name, 'a unique body structure');

  let rarityText = 'It is considered a species commonly seen in its region.';
  if (speciesData.is_mythical) {
    rarityText = 'It is classified as a Mythical Pokémon, surrounded by rare and mysterious reports.';
  } else if (speciesData.is_legendary) {
    rarityText = 'It is classified as a Legendary Pokémon and appears in very few reliable records.';
  } else if (speciesData.is_baby) {
    rarityText = 'It is a baby form, usually needing more care and showing more delicate behavior.';
  }

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
    const req = https.request(
      url,
      {
        method: 'GET',
        rejectUnauthorized: !useInsecureTls,
        headers: {
          'User-Agent': 'local-prolog-pokedex-generator',
          Accept: 'application/json',
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(requestJson(res.headers.location));
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`Erro HTTP ${res.statusCode} em ${url}`));
          return;
        }

        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`JSON invalido em ${url}: ${error.message}`));
          }
        });
      }
    );

    req.on('error', (error) => reject(error));
    req.end();
  });
}

async function getJson(url, maxRetries = 4) {
  let attempt = 0;
  while (true) {
    try {
      return await requestJson(url);
    } catch (error) {
      attempt += 1;
      if (attempt > maxRetries) {
        throw new Error(`Falha ao buscar ${url}: ${error.message}`);
      }
      await sleep(1000 * attempt);
    }
  }
}

async function generateOneGeneration(generation) {
  console.log(`Gerando geracao ${generation}...`);

  const generationUrl = `https://pokeapi.co/api/v2/generation/${generation}`;
  const generationData = await getJson(generationUrl);

  const species = generationData.pokemon_species
    .map((s) => ({ name: s.name, id: Number(s.url.match(/\/(\d+)\/?$/)?.[1] || 0) }))
    .filter((s) => s.id > 0)
    .sort((a, b) => a.id - b.id);

  const lines = [];
  lines.push(':- encoding(utf8).');
  lines.push(`% Base local da geracao ${generation}`);
  lines.push(`% Formato: pokemon(ID, Nome, Altura, Peso, Tipos, Habilidades, Stats).`);
  lines.push(':- multifile pokemon/7.');

  const loreLines = [];
  loreLines.push(':- encoding(utf8).');
  loreLines.push(`% Lore local da geracao ${generation}`);
  loreLines.push(`% Formato: pokemon_lore(ID, Texto).`);
  loreLines.push(':- multifile pokemon_lore/2.');

  const evolutionLines = [];
  evolutionLines.push(':- encoding(utf8).');
  evolutionLines.push(`% Evolucoes locais da geracao ${generation}`);
  evolutionLines.push(`% Formato: pokemon_evolution(FromID, ToID, Trigger, MinLevel, Condition).`);
  evolutionLines.push(':- multifile pokemon_evolution/5.');

  const evolutionCache = new Map();
  const evolutionKeys = new Set();

  for (const s of species) {
    const pokemon = await getJson(`https://pokeapi.co/api/v2/pokemon/${s.id}`);
    const speciesData = await getJson(`https://pokeapi.co/api/v2/pokemon-species/${s.id}`);
    const id = pokemon.id;
    const name = sanitizeAtom(pokemon.name);
    const height = pokemon.height;
    const weight = pokemon.weight;
    const types = formatTypes(pokemon.types);
    const abilities = formatAbilities(pokemon.abilities);
    const stats = formatStats(pokemon.stats);
    const loreText = buildLoreText(pokemon, speciesData, generation);

    lines.push(`pokemon(${id}, ${name}, ${height}, ${weight}, ${types}, ${abilities}, ${stats}).`);
    loreLines.push(`pokemon_lore(${id}, ${prologQuotedText(loreText)}).`);

    const evolutionChainUrl = speciesData?.evolution_chain?.url;
    if (evolutionChainUrl) {
      let evolutionFacts = evolutionCache.get(evolutionChainUrl);
      if (!evolutionFacts) {
        const chainData = await getJson(evolutionChainUrl);
        evolutionFacts = [];
        collectEvolutionFacts(chainData?.chain, evolutionFacts);
        evolutionCache.set(evolutionChainUrl, evolutionFacts);
      }

      for (const evo of evolutionFacts) {
        const key = `${evo.fromId}-${evo.toId}-${evo.trigger}-${evo.minLevel}-${evo.condition}`;
        if (evolutionKeys.has(key)) continue;
        evolutionKeys.add(key);
        evolutionLines.push(
          `pokemon_evolution(${evo.fromId}, ${evo.toId}, ${evo.trigger}, ${evo.minLevel}, ${evo.condition}).`
        );
      }
    }
  }

  const dbDir = path.resolve(__dirname, '..', 'db');
  fs.mkdirSync(dbDir, { recursive: true });
  const filePath = path.join(dbDir, `generation_${generation}.pl`);
  const loreFilePath = path.join(dbDir, `lore_generation_${generation}.pl`);
  const evolutionFilePath = path.join(dbDir, `evolution_generation_${generation}.pl`);
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
  fs.writeFileSync(loreFilePath, loreLines.join('\n') + '\n', 'utf8');
  fs.writeFileSync(evolutionFilePath, evolutionLines.join('\n') + '\n', 'utf8');

  console.log(`Arquivo gerado: ${filePath}`);
  console.log(`Arquivo gerado: ${loreFilePath}`);
  console.log(`Arquivo gerado: ${evolutionFilePath}`);
  console.log(`Total de pokemons: ${species.length}`);
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
  const labels = {
    mega: 'Mega',
    alola: 'Alolan',
    galar: 'Galarian',
    hisui: 'Hisuian',
    paldea: 'Paldean',
  };
  return labels[kind] || 'Special';
}

async function generateSpecialForms() {
  console.log('Gerando formas especiais (Mega e regionais)...');

  const pokemonIndex = await getJson('https://pokeapi.co/api/v2/pokemon?limit=20000');
  const specialEntries = (pokemonIndex.results || []).filter((entry) =>
    Boolean(detectSpecialFormKind(entry.name))
  );

  const specialMap = new Map();

  for (const entry of specialEntries) {
    const kind = detectSpecialFormKind(entry.name);
    if (!kind) continue;

    const pokemonData = await getJson(entry.url);
    const speciesData = await getJson(pokemonData.species.url);
    const baseSpeciesId = speciesData.id;
    const loreBaseName = String(speciesData.name || '').replace(/-/g, ' ');

    specialMap.set(pokemonData.id, {
      id: pokemonData.id,
      name: sanitizeAtom(pokemonData.name),
      height: pokemonData.height,
      weight: pokemonData.weight,
      types: formatTypes(pokemonData.types),
      abilities: formatAbilities(pokemonData.abilities),
      stats: formatStats(pokemonData.stats),
      baseSpeciesId,
      kind,
      loreText: `${toTitleCase(loreBaseName)} ${specialFormLabel(kind)} form.`,
    });
  }

  const specialList = [...specialMap.values()].sort((a, b) => a.id - b.id);

  const formLines = [];
  formLines.push(':- encoding(utf8).');
  formLines.push('% Formas especiais locais (Mega e regionais)');
  formLines.push('% Formato: pokemon(ID, Nome, Altura, Peso, Tipos, Habilidades, Stats).');
  formLines.push('% Mapeamento: pokemon_form_base(FormID, BaseSpeciesID).');
  formLines.push('% Tipo da forma: pokemon_form_kind(FormID, Kind).');
  formLines.push(':- multifile pokemon/7.');
  formLines.push(':- multifile pokemon_form_base/2.');
  formLines.push(':- multifile pokemon_form_kind/2.');

  const formLoreLines = [];
  formLoreLines.push(':- encoding(utf8).');
  formLoreLines.push('% Lore local para formas especiais');
  formLoreLines.push('% Formato: pokemon_lore(ID, Texto).');
  formLoreLines.push(':- multifile pokemon_lore/2.');

  for (const form of specialList) {
    formLines.push(
      `pokemon(${form.id}, ${form.name}, ${form.height}, ${form.weight}, ${form.types}, ${form.abilities}, ${form.stats}).`
    );
    formLines.push(`pokemon_form_base(${form.id}, ${form.baseSpeciesId}).`);
    formLines.push(`pokemon_form_kind(${form.id}, ${form.kind}).`);
    formLoreLines.push(`pokemon_lore(${form.id}, ${prologQuotedText(form.loreText)}).`);
  }

  const dbDir = path.resolve(__dirname, '..', 'db');
  fs.mkdirSync(dbDir, { recursive: true });
  const formsFilePath = path.join(dbDir, 'special_forms.pl');
  const formsLoreFilePath = path.join(dbDir, 'lore_special_forms.pl');
  fs.writeFileSync(formsFilePath, formLines.join('\n') + '\n', 'utf8');
  fs.writeFileSync(formsLoreFilePath, formLoreLines.join('\n') + '\n', 'utf8');

  console.log(`Arquivo gerado: ${formsFilePath}`);
  console.log(`Arquivo gerado: ${formsLoreFilePath}`);
  console.log(`Total de formas especiais: ${specialList.length}`);
}

function parseGenerationsArg(arg) {
  if (!arg || arg === 'all' || arg === 'todas') {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9];
  }

  if (arg.includes(',')) {
    const values = arg
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 9);
    if (values.length === 0) {
      throw new Error('Uso: node tools/generate_generation_db.js <1..9|all|1,2,3>');
    }
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
  const arg = process.argv[2] || 'all';
  if (arg === 'mega' || arg === 'formas' || arg === 'special') {
    await generateSpecialForms();
    console.log('Geracao de formas especiais finalizada com sucesso.');
    return;
  }
  const generations = parseGenerationsArg(arg);
  for (const generation of generations) {
    await generateOneGeneration(generation);
  }
  await generateSpecialForms();
  console.log('Geracao(oes) finalizada(s) com sucesso.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
