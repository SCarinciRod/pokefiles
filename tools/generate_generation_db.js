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
  return map[key] || key;
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

  output = output.replace(/\s+/g, ' ').trim();
  if (output.length === 0) return output;
  return output[0].toUpperCase() + output.slice(1);
}

function buildLoreText(pokemon, speciesData, generation) {
  const spanishFlavor = pickFlavorText(speciesData, generation, 'es');
  if (spanishFlavor) {
    return translateSpanishFlavorToPortuguese(spanishFlavor);
  }

  const englishFlavor = pickFlavorText(speciesData, generation, 'en');
  if (englishFlavor) {
    return englishFlavor;
  }

  const habitatMap = {
    cave: 'cavernas',
    forest: 'florestas',
    grassland: 'campos abertos',
    mountain: 'regioes montanhosas',
    rare: 'locais raros e pouco acessiveis',
    rough_terrain: 'terrenos acidentados',
    sea: 'mares e oceanos',
    urban: 'areas urbanas',
    waters_edge: 'margens de rios e lagos',
  };

  const colorMap = {
    black: 'escura',
    blue: 'azulada',
    brown: 'amarronzada',
    gray: 'acinzentada',
    green: 'esverdeada',
    pink: 'rosada',
    purple: 'arroxeada',
    red: 'avermelhada',
    white: 'clara',
    yellow: 'amarelada',
  };

  const shapeMap = {
    ball: 'corpo arredondado',
    squiggle: 'corpo serpentino',
    fish: 'corpo de peixe',
    arms: 'forma com bracos marcantes',
    blob: 'forma amorfa',
    upright: 'postura ereta',
    legs: 'postura bípede',
    quadruped: 'postura quadrupede',
    wings: 'corpo com asas',
    tentacles: 'forma com tentaculos',
    heads: 'estrutura com multiplas cabecas',
    humanoid: 'aparencia humanoide',
    bug_wings: 'estrutura de inseto com asas',
    armor: 'corpo com aspecto de armadura',
  };

  const types = [...pokemon.types]
    .sort((a, b) => a.slot - b.slot)
    .map((t) => sanitizeAtom(t.type.name));

  const typeText = types.join('/');
  const nameText = toTitleCase(sanitizeAtom(pokemon.name).replace(/_/g, ' '));
  const habitat = mapLabel(habitatMap, speciesData.habitat?.name, 'habitat pouco documentado');
  const color = mapLabel(colorMap, speciesData.color?.name, 'coloracao variada');
  const shape = mapLabel(shapeMap, speciesData.shape?.name, 'estrutura corporal singular');

  let rarityText = 'E considerado uma especie comum de se observar na sua regiao.';
  if (speciesData.is_mythical) {
    rarityText = 'E classificado como Pokemon mitico, cercado por relatos raros e misteriosos.';
  } else if (speciesData.is_legendary) {
    rarityText = 'E classificado como Pokemon lendario e aparece em poucos registros confiaveis.';
  } else if (speciesData.is_baby) {
    rarityText = 'E uma forma infantil, geralmente dependente de cuidados e com comportamento mais delicado.';
  }

  const evoText = speciesData.evolves_from_species
    ? `Sua linhagem evolutiva parte de ${toTitleCase(String(speciesData.evolves_from_species.name).replace(/-/g, ' '))}.`
    : 'Sua linhagem evolutiva comeca nesta forma.';

  return `${nameText} e um Pokemon do tipo ${typeText}. Vive com frequencia em ${habitat}, com aparencia ${color} e ${shape}. ${rarityText} ${evoText}`;
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
  lines.push(`% Base local da geracao ${generation}`);
  lines.push(`% Formato: pokemon(ID, Nome, Altura, Peso, Tipos, Habilidades, Stats).`);
  lines.push(':- multifile pokemon/7.');

  const loreLines = [];
  loreLines.push(`% Lore local da geracao ${generation}`);
  loreLines.push(`% Formato: pokemon_lore(ID, Texto).`);
  loreLines.push(':- multifile pokemon_lore/2.');

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
  }

  const dbDir = path.resolve(__dirname, '..', 'db');
  fs.mkdirSync(dbDir, { recursive: true });
  const filePath = path.join(dbDir, `generation_${generation}.pl`);
  const loreFilePath = path.join(dbDir, `lore_generation_${generation}.pl`);
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
  fs.writeFileSync(loreFilePath, loreLines.join('\n') + '\n', 'utf8');

  console.log(`Arquivo gerado: ${filePath}`);
  console.log(`Arquivo gerado: ${loreFilePath}`);
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
    alola: 'Regional de Alola',
    galar: 'Regional de Galar',
    hisui: 'Regional de Hisui',
    paldea: 'Regional de Paldea',
  };
  return labels[kind] || 'Especial';
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
      loreText: `Forma ${specialFormLabel(kind)} de ${toTitleCase(loreBaseName)}.`,
    });
  }

  const specialList = [...specialMap.values()].sort((a, b) => a.id - b.id);

  const formLines = [];
  formLines.push('% Formas especiais locais (Mega e regionais)');
  formLines.push('% Formato: pokemon(ID, Nome, Altura, Peso, Tipos, Habilidades, Stats).');
  formLines.push('% Mapeamento: pokemon_form_base(FormID, BaseSpeciesID).');
  formLines.push('% Tipo da forma: pokemon_form_kind(FormID, Kind).');
  formLines.push(':- multifile pokemon/7.');
  formLines.push(':- multifile pokemon_form_base/2.');
  formLines.push(':- multifile pokemon_form_kind/2.');

  const formLoreLines = [];
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
