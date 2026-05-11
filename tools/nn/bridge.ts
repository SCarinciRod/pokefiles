/**
 * bridge.ts — Node.js stdin/stdout bridge replacing gui/prolog_bridge.pl
 *
 * Protocol (identical to prolog_bridge.pl):
 *   stdin  line  → process → stdout wrapped in markers
 *
 * Markers:
 *   [[BOT_RESPONSE_BEGIN]]
 *   <response text>
 *   [[BOT_RESPONSE_END]]
 *
 * Commands:
 *   __PING__                       → "pong"
 *   __RESET__                      → reset state + confirm message
 *   __POKEDEX_LIST_JSON__           → {"ok":true,"pokemon":[...]}
 *   __POKEDEX_DETAIL_JSON__:<id>    → {"ok":true,"detail":{...}}
 *   <plain text>                    → NLU → intent handler → "Bot: ..."
 */
import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import { DeterministicEngine, PokemonContext } from './engine';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k, v ?? 'true'];
    })
);

const DEFAULT_DB = path.resolve(__dirname, '../../.local_cache/nn_export/pokefiles_nn.sqlite3');
const DB_PATH = process.env['BRIDGE_DB'] ?? args['db'] ?? DEFAULT_DB;

// ---------------------------------------------------------------------------
// Protocol helpers
// ---------------------------------------------------------------------------
function writeResponse(text: string): void {
  process.stdout.write('[[BOT_RESPONSE_BEGIN]]\n');
  process.stdout.write(text + '\n');
  process.stdout.write('[[BOT_RESPONSE_END]]\n');
}

// ---------------------------------------------------------------------------
// Type labels (EN id → PT label)
// ---------------------------------------------------------------------------
const TYPE_LABELS: Record<string, string> = {
  normal: 'Normal', fire: 'Fogo', water: 'Água', electric: 'Elétrico',
  grass: 'Planta', ice: 'Gelo', fighting: 'Lutador', poison: 'Veneno',
  ground: 'Terra', flying: 'Voador', psychic: 'Psíquico', bug: 'Inseto',
  rock: 'Pedra', ghost: 'Fantasma', dragon: 'Dragão', dark: 'Sombrio',
  steel: 'Aço', fairy: 'Fada',
};

// ---------------------------------------------------------------------------
// Competitive stat calculation — Level 50, 31 IVs, standard EV spreads
// ---------------------------------------------------------------------------
// stat = floor((floor((2*base + IV + floor(EV/4)) * level/100) + 5) * nature)
// hp   = floor( floor((2*base + IV + floor(EV/4)) * level/100)  + level + 10)
function compStat(base: number, isHp: boolean, evs: number, boosted: boolean): number {
  const IV = 31, level = 50;
  if (isHp) return Math.floor(Math.floor((2 * base + IV + Math.floor(evs / 4)) * level / 100) + level + 10);
  return Math.floor((Math.floor((2 * base + IV + Math.floor(evs / 4)) * level / 100) + 5) * (boosted ? 1.1 : 1.0));
}
// Max competitive speed (252 EVs, +Speed nature)
function compSpeed(base: number): number { return compStat(base, false, 252, true); }
// Max competitive offense (252 EVs, +Atk/SpAtk nature)
function compOffense(base: number): number { return compStat(base, false, 252, true); }
// Defensive EVs without nature boost
function compDef(base: number, evs = 252): number { return compStat(base, false, evs, false); }
// HP at 252 EVs
function compHP(base: number): number { return compStat(base, true, 252, false); }

// SQL fragment — exclude NFE (pokémon that still have an evolution stage ahead)
const FULLY_EVOLVED_SQL = 'AND p.id NOT IN (SELECT DISTINCT from_id FROM pokemon_evolution)';

// PT/EN name → EN id map for type extraction (keys are NFD-normalized)
const TYPE_PT_TO_ID: Record<string, string> = {
  normal: 'normal', fogo: 'fire', agua: 'water', eletrico: 'electric',
  planta: 'grass', gelo: 'ice', lutador: 'fighting', veneno: 'poison',
  terra: 'ground', voador: 'flying', psiquico: 'psychic', inseto: 'bug',
  pedra: 'rock', fantasma: 'ghost', dragao: 'dragon', sombrio: 'dark',
  aco: 'steel', fada: 'fairy',
  fire: 'fire', water: 'water', electric: 'electric', grass: 'grass',
  ice: 'ice', fighting: 'fighting', poison: 'poison', ground: 'ground',
  flying: 'flying', psychic: 'psychic', bug: 'bug', rock: 'rock',
  ghost: 'ghost', dragon: 'dragon', dark: 'dark', steel: 'steel', fairy: 'fairy',
};
const TYPE_PT_ENTRIES = Object.entries(TYPE_PT_TO_ID).sort((a, b) => b[0].length - a[0].length);

function typeLabel(t: string | null): string { return t ? (TYPE_LABELS[t] ?? t) : ''; }
function displayName(identifier: string): string {
  return identifier.split('_').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

// ---------------------------------------------------------------------------
// Legendary / mythical identifier set
// ---------------------------------------------------------------------------
const LEGENDARY_BASES = new Set([
  'articuno','zapdos','moltres','mewtwo','mew',
  'raikou','entei','suicune','lugia','ho_oh','celebi',
  'regirock','regice','registeel','latias','latios','kyogre','groudon',
  'rayquaza','jirachi','deoxys',
  'uxie','mesprit','azelf','dialga','palkia','heatran','regigigas',
  'giratina','cresselia','phione','manaphy','darkrai','shaymin','arceus',
  'victini','cobalion','terrakion','virizion','tornadus','thundurus',
  'reshiram','zekrom','landorus','kyurem','keldeo','meloetta','genesect',
  'xerneas','yveltal','zygarde','diancie','hoopa','volcanion',
  'type_null','silvally','tapu_koko','tapu_lele','tapu_bulu','tapu_fini',
  'cosmog','cosmoem','solgaleo','lunala','nihilego','buzzwole','pheromosa',
  'xurkitree','celesteela','kartana','guzzlord','necrozma','magearna',
  'marshadow','poipole','naganadel','stakataka','blacephalon','zeraora',
  'zacian','zamazenta','eternatus','kubfu','urshifu','zarude','regieleki',
  'regidrago','glastrier','spectrier','calyrex','enamorus',
  'wo_chien','chien_pao','ting_lu','chi_yu','koraidon','miraidon',
  'walking_wake','iron_leaves','okidogi','munkidori','fezandipiti',
  'ogerpon','terapagos','pecharunt',
]);

function isLegendary(identifier: string): boolean {
  if (LEGENDARY_BASES.has(identifier)) return true;
  const base = identifier.replace(/_mega.*|_gmax.*|_totem.*|_origin|_altered|_sky|_land|_attack|_defense|_speed|_normal|_black|_white|_therian|_incarnate|_primal|_ultra|_dusk.*|_dawn.*|_midday|_midnight|_complete$|_10.*|_50.*|_single.*|_rapid.*|_crowned$|_eternamax$|_unbound$|_pirouette$|_zen$|_stellar$/, '');
  return LEGENDARY_BASES.has(base);
}

// ---------------------------------------------------------------------------
// NFE (Not Fully Evolved) identifier set — supplements SQL filter for
// regional forms whose evolution edges may be missing from the DB
// (e.g. sneasel_hisui → sneasler not always present in export)
// ---------------------------------------------------------------------------
const nfeIds = new Set<string>();

function buildNfeSet(engine: DeterministicEngine): void {
  nfeIds.clear();
  for (const { identifier } of engine.queryAll<{ identifier: string }>(
    'SELECT p.identifier FROM pokemon p WHERE p.id IN (SELECT DISTINCT from_id FROM pokemon_evolution)'
  )) {
    nfeIds.add(identifier);
  }
}

function isNfe(identifier: string): boolean {
  if (nfeIds.has(identifier)) return true;
  const base = identifier.replace(/_(?:hisui|galar|alola|paldea|hisuian)$/, '');
  return base !== identifier && nfeIds.has(base);
}

// ---------------------------------------------------------------------------
// NLU name index (pokemon names → identifier)
// ---------------------------------------------------------------------------
const nameIndex = new Map<string, string>();

function buildNameIndex(allPokemon: PokemonContext[]): void {
  nameIndex.clear();
  for (const p of allPokemon) {
    const id = p.identifier;
    nameIndex.set(id.toLowerCase(), id);
    nameIndex.set(id.toLowerCase().replace(/_/g, ' '), id);
    const baseParts = id.split('_');
    if (baseParts.length > 1 && !nameIndex.has(baseParts[0])) {
      nameIndex.set(baseParts[0], id);
    }
  }
  // Re-pass to prefer base forms
  for (const p of allPokemon) {
    const id = p.identifier;
    if (!id.includes('_mega') && !id.includes('_gmax') && !id.includes('_alola') &&
        !id.includes('_galar') && !id.includes('_hisui') && !id.includes('_paldea')) {
      nameIndex.set(id.toLowerCase(), id);
      nameIndex.set(id.toLowerCase().replace(/_/g, ' '), id);
    }
  }
}

function extractPokemonName(text: string): string | null {
  const t = text.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const sortedKeys = [...nameIndex.keys()].sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (t.includes(key)) return nameIndex.get(key)!;
  }
  return null;
}

function extractTwoPokemon(t: string): [string, string] | null {
  const sortedKeys = [...nameIndex.keys()].sort((a, b) => b.length - a.length);
  const found: string[] = [];
  let remaining = t.replace(/[^\w\s]/g, ' ');
  for (const key of sortedKeys) {
    if (remaining.includes(key)) {
      const id = nameIndex.get(key)!;
      if (!found.includes(id)) {
        found.push(id);
        remaining = remaining.replace(key, '  ');
        if (found.length === 2) return [found[0], found[1]];
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ability / move indexes (built at startup)
// ---------------------------------------------------------------------------
const abilityIndex = new Map<string, string>();
const moveIndex = new Map<string, string>();

function buildAbilityIndex(engine: DeterministicEngine): void {
  abilityIndex.clear();
  for (const { id } of engine.queryAll<{ id: string }>('SELECT id FROM abilities')) {
    abilityIndex.set(id, id);
    abilityIndex.set(id.replace(/_/g, ''), id);
    abilityIndex.set(id.replace(/_/g, ' '), id);
  }
}

function buildMoveIndex(engine: DeterministicEngine): void {
  moveIndex.clear();
  for (const { id } of engine.queryAll<{ id: string }>('SELECT id FROM moves')) {
    moveIndex.set(id, id);
    moveIndex.set(id.replace(/_/g, ''), id);
    moveIndex.set(id.replace(/_/g, ' '), id);
  }
}

function extractAbilityName(t: string): string | null {
  const sorted = [...abilityIndex.keys()].sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    if (t.includes(key)) return abilityIndex.get(key)!;
  }
  return null;
}

function extractMoveName(t: string): string | null {
  const sorted = [...moveIndex.keys()].sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    if (t.includes(key)) return moveIndex.get(key)!;
  }
  return null;
}

// ---------------------------------------------------------------------------
// NLU helpers
// ---------------------------------------------------------------------------
function extractTypeName(t: string): string | null {
  for (const [pt, en] of TYPE_PT_ENTRIES) {
    if (t.includes(pt)) return en;
  }
  return null;
}

function hasTypeToken(t: string): boolean { return extractTypeName(t) !== null; }

function extractGenerationNumber(t: string): number | null {
  const m = t.match(/ger[ae]?[cç][aã]o?\s*(\d)|gen\s*(\d)|(\d)\s*[ao°]?\s*ger/);
  if (m) {
    const n = parseInt(m[1] || m[2] || m[3], 10);
    if (n >= 1 && n <= 9) return n;
  }
  const words: Record<string, number> = { um:1,dois:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9 };
  for (const [word, num] of Object.entries(words)) {
    if (t.includes(word) && /ger[ae]?|gen/.test(t)) return num;
  }
  return null;
}

function extractStatNameFromText(t: string): string {
  if (/\bhp\b|pontos.*vida|mais.*vida/.test(t)) return 'hp';
  if (/ataque.*esp|spatk|sp.*atk|especial.*ataque/.test(t)) return 'special_attack';
  if (/defesa.*esp|spdef|sp.*def|especial.*defesa/.test(t)) return 'special_defense';
  if (/\bataque\b|attack\b/.test(t)) return 'attack';
  if (/\bdefesa\b|defense\b/.test(t)) return 'defense';
  if (/\bbst\b|total.*base|poder.*base/.test(t)) return 'bst';
  return 'speed';
}

function detectExcludeLegendary(t: string): boolean {
  return /sem.*lend[aá]|exclu.*lend|n[aã]o.*lend|apenas.*base|s[oó].*base|sem.*m[ií]ti|exclu.*m[ií]ti|sem.*mythic/.test(t);
}

// ---------------------------------------------------------------------------
// Pokédex JSON builders
// ---------------------------------------------------------------------------
function buildListEntry(p: PokemonContext) {
  return {
    id: p.id,
    identifier: p.identifier,
    display_name: displayName(p.identifier),
    types: p.types,
    type_labels: p.types.map(typeLabel),
  };
}

function buildDetailEntry(p: PokemonContext, typeChart: Map<string, Map<string, number>>) {
  const stats = p.baseStats;
  const statEntries = [
    { key: 'hp',              label: 'HP',           value: stats.hp },
    { key: 'attack',          label: 'Ataque',        value: stats.attack },
    { key: 'defense',         label: 'Defesa',        value: stats.defense },
    { key: 'special_attack',  label: 'Ataque Esp.',   value: stats.special_attack },
    { key: 'special_defense', label: 'Defesa Esp.',   value: stats.special_defense },
    { key: 'speed',           label: 'Velocidade',    value: stats.speed },
  ];
  const maxStat = Math.max(...statEntries.map((s) => s.value));
  const ALL_ATTACK_TYPES = Object.keys(TYPE_LABELS);
  const weaknesses: { type: string; type_label: string; multiplier: string; multiplier_value: number }[] = [];
  const resistances: typeof weaknesses = [];
  const immunities: { type: string; type_label: string }[] = [];
  for (const atkType of ALL_ATTACK_TYPES) {
    const byAtk = typeChart.get(atkType);
    let mult = 1.0;
    for (const defType of p.types) {
      const v = byAtk?.get(defType);
      if (v !== undefined) mult *= v;
    }
    if (mult > 1.0) weaknesses.push({ type: atkType, type_label: typeLabel(atkType), multiplier: `×${mult}`, multiplier_value: mult });
    else if (mult === 0.0) immunities.push({ type: atkType, type_label: typeLabel(atkType) });
    else if (mult < 1.0) resistances.push({ type: atkType, type_label: typeLabel(atkType), multiplier: `×${mult}`, multiplier_value: mult });
  }
  return {
    id: p.id, identifier: p.identifier, display_name: displayName(p.identifier),
    height_dm: p.height_dm, height_m: p.height_dm / 10,
    weight_hg: p.weight_hg, weight_kg: p.weight_hg / 10,
    types: p.types, type_labels: p.types.map(typeLabel),
    abilities: p.abilities.map(displayName), ability_identifiers: p.abilities,
    selected_ability: p.abilities[0] ?? '', source_generation: p.source_generation,
    stats: statEntries, max_stat: maxStat,
    type_relations: { weaknesses, resistances, immunities },
  };
}

// ---------------------------------------------------------------------------
// Competitive profile classifier
// ---------------------------------------------------------------------------
function classifyRole(stats: PokemonContext['baseStats'], types: string[]): string {
  const { hp, attack, defense, special_attack: spAtk, special_defense: spDef, speed } = stats;
  const mainOff = Math.max(attack, spAtk);
  const offBias = attack > spAtk + 25 ? 'físico' : spAtk > attack + 25 ? 'especial' : 'misto';
  const bulkScore = hp * ((defense + spDef) / 2);
  if (speed >= 110 && mainOff >= 115) return `Sweeper ${offBias} extremo`;
  if (speed >= 90 && mainOff >= 95) return `Sweeper ${offBias}`;
  if (speed >= 100 && mainOff < 75 && (hp + defense + spDef) >= 220) return 'Speed Control / Pivot';
  if (speed >= 100 && mainOff < 75) return 'Pivot / Disruptor';
  if (speed <= 45 && hp >= 80) return 'Trick Room Abuser';
  if (bulkScore >= 20000 && speed <= 65) return `Tanque ${offBias}`;
  if (hp >= 80 && mainOff >= 90 && speed >= 70) return `Attacker Bulky ${offBias}`;
  if (types.includes('fairy') || types.includes('psychic')) {
    if (spAtk >= 90) return `Sweeper ${offBias} / Suporte`;
  }
  return `Utility / Suporte ${offBias}`;
}

function speedTierLabel(baseSpeed: number): string {
  const cs = compSpeed(baseSpeed);
  if (cs >= 200) return 'S — Elite';
  if (cs >= 178) return 'A — Muito rápido';
  if (cs >= 156) return 'B — Rápido';
  if (cs >= 134) return 'C — Médio';
  if (cs >= 112) return 'D — Lento';
  return 'E — Muito lento (Trick Room)';
}

// ---------------------------------------------------------------------------
// Intent handlers
// ---------------------------------------------------------------------------

function handleCompetitiveProfile(identifier: string, engine: DeterministicEngine): string {
  const p = engine.getPokemonContext(identifier);
  if (!p) return `Bot: Pokémon "${displayName(identifier)}" não encontrado na base de dados.`;
  const s = p.baseStats;
  const { hp, attack, defense, special_attack: spAtk, special_defense: spDef, speed } = s;
  const bst = hp + attack + defense + spAtk + spDef + speed;
  const role = classifyRole(s, p.types);
  const tier = speedTierLabel(speed);
  const types = p.types.map(typeLabel).join('/');
  const abilityList = p.abilities.length > 0 ? p.abilities.slice(0, 3).map(displayName).join(', ') : 'desconhecidas';
  const typeChart = engine.getTypeChart();
  const weaknesses: string[] = [];
  for (const [atkType, byAtk] of typeChart) {
    let mult = 1.0;
    for (const defType of p.types) { const v = byAtk.get(defType); if (v !== undefined) mult *= v; }
    if (mult >= 2.0) weaknesses.push(`${typeLabel(atkType)}${mult >= 4 ? '×4' : ''}`);
  }
  const csHP = compHP(hp);
  const csAtk = compOffense(attack);
  const csSpAtk = compOffense(spAtk);
  const csDef = compDef(defense);
  const csSpDef = compDef(spDef);
  const csSpd = compSpeed(speed);
  const lines = [
    `Bot: ── Perfil Competitivo: ${displayName(identifier)} ──`,
    `Tipos: ${types} | Papel: ${role}`,
    `Habilidades: ${abilityList}`,
    ``,
    `Stats base:  HP ${hp} / Atk ${attack} / Def ${defense} / SpAtk ${spAtk} / SpDef ${spDef} / Vel ${speed}  (BST ${bst})`,
    `Stats comp:  HP ${csHP} / Atk ${csAtk} / Def ${csDef} / SpAtk ${csSpAtk} / SpDef ${csSpDef} / Vel ${csSpd}  (Lvl50, 31IV, 252EV, +nat)`,
    `Velocidade: Tier ${tier} — vel. competitiva ${csSpd} (base ${speed})`,
    weaknesses.length > 0 ? `Fraquezas: ${weaknesses.join(', ')}` : 'Sem fraquezas de tipo comuns',
  ];
  if (speed <= 45) lines.push('Dica: velocidade muito baixa — parceiro de Trick Room ideal.');
  if (csSpd >= 178) lines.push('Dica: tier de velocidade elite — pode controlar o ritmo de batalha.');
  if (Math.max(attack, spAtk) < 70 && (hp + defense + spDef) >= 260) lines.push('Dica: perfil bulk — ideal como Defensor ou suporte.');
  return lines.join('\n');
}

function handleSpeedRanking(excludeLegendary: boolean, limit: number, engine: DeterministicEngine): string {
  return handleStatRanking('speed', excludeLegendary, limit, engine);
}

function handleStatRanking(statId: string, excludeLegendary: boolean, limit: number, engine: DeterministicEngine): string {
  let rows: { identifier: string; value: number }[];
  if (statId === 'bst') {
    rows = engine.queryAll<{ identifier: string; value: number }>(
      `SELECT p.identifier, SUM(ps.value) AS value
       FROM pokemon p JOIN pokemon_stats ps ON p.id = ps.pokemon_id
       GROUP BY p.id ORDER BY value DESC`
    );
  } else {
    rows = engine.queryAll<{ identifier: string; value: number }>(
      `SELECT p.identifier, ps.value AS value
       FROM pokemon p JOIN pokemon_stats ps ON p.id = ps.pokemon_id
       WHERE ps.stat_id = ? ORDER BY ps.value DESC`,
      [statId]
    );
  }
  let filtered = rows.filter((r) => !/_mega|_gmax/.test(r.identifier));
  if (excludeLegendary) filtered = filtered.filter((r) => !isLegendary(r.identifier));
  const top = filtered.slice(0, limit);
  const statLabels: Record<string, string> = {
    hp: 'HP', attack: 'Ataque', defense: 'Defesa',
    special_attack: 'Atq. Especial', special_defense: 'Def. Especial',
    speed: 'Velocidade', bst: 'BST Total',
  };
  const label = statLabels[statId] ?? statId;
  const header = excludeLegendary ? `Top ${limit} em ${label} (sem lendários/míticos):` : `Top ${limit} em ${label}:`;
  const lines = top.map((r, i) => `${String(i + 1).padStart(2, ' ')}. ${displayName(r.identifier).padEnd(22)} ${r.value}`);
  return `Bot: ${header}\n${lines.join('\n')}`;
}

function handleTypeQuery(typeId: string, genFilter: number | null, excludeLegendary: boolean, engine: DeterministicEngine): string {
  let sql = `SELECT p.identifier, p.source_generation,
       GROUP_CONCAT(pt.type_id, '/') AS types
     FROM pokemon p JOIN pokemon_types pt ON p.id = pt.pokemon_id
     WHERE p.id IN (SELECT pokemon_id FROM pokemon_types WHERE type_id = ?)`;
  const params: unknown[] = [typeId];
  if (genFilter !== null) { sql += ' AND p.source_generation = ?'; params.push(genFilter); }
  sql += ' GROUP BY p.id ORDER BY p.id';
  let rows = engine.queryAll<{ identifier: string; source_generation: number; types: string }>(sql, params);
  rows = rows.filter((r) => !/_mega|_gmax/.test(r.identifier));
  if (excludeLegendary) rows = rows.filter((r) => !isLegendary(r.identifier));
  const total = rows.length;
  const sample = rows.slice(0, 15);
  const typeName = typeLabel(typeId);
  const genPart = genFilter ? ` (Geração ${genFilter})` : '';
  const legendPart = excludeLegendary ? ', sem lendários' : '';
  const lines = sample.map((r) => `  • ${displayName(r.identifier)} (${r.types.split('/').map(typeLabel).join('/')})`);
  const more = total > 15 ? `  ... e mais ${total - 15}` : '';
  return `Bot: Pokémon do tipo ${typeName}${genPart}${legendPart} — ${total} total:\n${lines.join('\n')}${more ? '\n' + more : ''}`;
}

function handleGenerationQuery(generation: number, typeFilter: string | null, engine: DeterministicEngine): string {
  let sql = `SELECT p.identifier, p.source_generation,
       GROUP_CONCAT(pt.type_id, '/') AS types
     FROM pokemon p JOIN pokemon_types pt ON p.id = pt.pokemon_id
     WHERE p.source_generation = ?`;
  const params: unknown[] = [generation];
  if (typeFilter) { sql += ' AND p.id IN (SELECT pokemon_id FROM pokemon_types WHERE type_id = ?)'; params.push(typeFilter); }
  sql += ' GROUP BY p.id ORDER BY p.id';
  let rows = engine.queryAll<{ identifier: string; types: string }>(sql, params);
  rows = rows.filter((r) => !/_mega|_gmax/.test(r.identifier));
  const total = rows.length;
  const legendary = rows.filter((r) => isLegendary(r.identifier)).length;
  const typePart = typeFilter ? ` do tipo ${typeLabel(typeFilter)}` : '';
  const sample = rows.slice(0, 12);
  const lines = sample.map((r) => `  • ${displayName(r.identifier)} (${r.types.split('/').map(typeLabel).join('/')})`);
  const more = total > 12 ? `  ... e mais ${total - 12}` : '';
  return [
    `Bot: Pokémon da Geração ${generation}${typePart}:`,
    `Total: ${total} (${total - legendary} regulares, ${legendary} lendários/míticos)`,
    ...lines,
    more,
  ].filter(Boolean).join('\n');
}

function handleLegendaryQuery(genFilter: number | null, typeFilter: string | null, engine: DeterministicEngine): string {
  let sql = `SELECT p.identifier, p.source_generation, GROUP_CONCAT(pt.type_id, '/') AS types
     FROM pokemon p JOIN pokemon_types pt ON p.id = pt.pokemon_id
     WHERE p.identifier NOT LIKE '%_mega%' AND p.identifier NOT LIKE '%_gmax%'`;
  const params: unknown[] = [];
  if (genFilter) { sql += ' AND p.source_generation = ?'; params.push(genFilter); }
  if (typeFilter) { sql += ' AND p.id IN (SELECT pokemon_id FROM pokemon_types WHERE type_id = ?)'; params.push(typeFilter); }
  sql += ' GROUP BY p.id ORDER BY p.source_generation, p.id';
  const rows = engine.queryAll<{ identifier: string; source_generation: number; types: string }>(sql, params);
  const legendaries = rows.filter((r) => isLegendary(r.identifier));
  if (!legendaries.length) return `Bot: Nenhum lendário/mítico encontrado${genFilter ? ` na Geração ${genFilter}` : ''}${typeFilter ? ` do tipo ${typeLabel(typeFilter)}` : ''}.`;
  const genPart = genFilter ? ` — Geração ${genFilter}` : '';
  const typePart = typeFilter ? ` — Tipo ${typeLabel(typeFilter)}` : '';
  const lines = [`Bot: Lendários/Míticos${genPart}${typePart} (${legendaries.length} total):`];
  if (genFilter || legendaries.length <= 20) {
    for (const r of legendaries) {
      lines.push(`  • ${displayName(r.identifier)} (${r.types.split('/').map(typeLabel).join('/')})`);
    }
  } else {
    const byGen = new Map<number, string[]>();
    for (const r of legendaries) {
      if (!byGen.has(r.source_generation)) byGen.set(r.source_generation, []);
      byGen.get(r.source_generation)!.push(displayName(r.identifier));
    }
    for (const [gen, names] of [...byGen.entries()].sort((a, b) => a[0] - b[0])) {
      lines.push(`  Gen ${gen}: ${names.join(', ')}`);
    }
  }
  return lines.join('\n');
}

function handleEvolutionChain(identifier: string, engine: DeterministicEngine): string {
  const baseRow = engine.queryAll<{ id: number }>('SELECT id FROM pokemon WHERE identifier = ?', [identifier]);
  if (!baseRow.length) return `Bot: Pokémon "${displayName(identifier)}" não encontrado.`;
  const startId = baseRow[0].id;

  type EvoRow = { from_id: number; to_id: number; trigger: string; min_level: number | null; condition: string | null };
  const allEvo = engine.queryAll<EvoRow>('SELECT from_id, to_id, trigger, min_level, condition FROM pokemon_evolution');
  const allPokemon = engine.queryAll<{ id: number; identifier: string }>('SELECT id, identifier FROM pokemon');
  const idToName = new Map(allPokemon.map((p) => [p.id, p.identifier]));

  const childrenMap = new Map<number, EvoRow[]>();
  const parentOf = new Map<number, number>(); // to_id → from_id (first parent only)
  for (const e of allEvo) {
    if (!childrenMap.has(e.from_id)) childrenMap.set(e.from_id, []);
    childrenMap.get(e.from_id)!.push(e);
    if (!parentOf.has(e.to_id)) parentOf.set(e.to_id, e.from_id);
  }

  let rootId = startId;
  const visited = new Set<number>();
  while (parentOf.has(rootId) && !visited.has(rootId)) {
    visited.add(rootId);
    rootId = parentOf.get(rootId)!;
  }

  const lines: string[] = [];
  const seen = new Set<number>();

  function renderNode(id: number, depth: number, from?: EvoRow): void {
    if (seen.has(id)) return;
    seen.add(id);
    const indent = '  '.repeat(depth);
    const name = displayName(idToName.get(id) ?? String(id));
    let evoInfo = '';
    if (from) {
      if (from.trigger === 'level_up' && from.min_level) evoInfo = ` [Nível ${from.min_level}]`;
      else if (from.trigger === 'trade') evoInfo = from.condition ? ` [Troca c/ ${displayName(from.condition)}]` : ' [Troca]';
      else if (from.trigger === 'use_item') evoInfo = from.condition ? ` [${displayName(from.condition)}]` : ' [Item]';
      else if (from.condition) evoInfo = ` [${displayName(from.condition)}]`;
      else if (from.trigger) evoInfo = ` [${from.trigger.replace(/_/g, ' ')}]`;
    }
    lines.push(`${indent}${depth > 0 ? '→ ' : ''}${name}${evoInfo}${id === startId ? ' ◄' : ''}`);
    for (const child of (childrenMap.get(id) ?? [])) renderNode(child.to_id, depth + 1, child);
  }

  renderNode(rootId, 0);
  if (lines.length === 1) lines.push('  (Não evolui)');
  return `Bot: Cadeia de evolução de ${displayName(identifier)}:\n${lines.join('\n')}`;
}

function handleCounterQuery(identifier: string, engine: DeterministicEngine): string {
  const p = engine.getPokemonContext(identifier);
  if (!p) return `Bot: Pokémon "${displayName(identifier)}" não encontrado.`;

  const typeChart = engine.getTypeChart();
  const effectiveTypes: Array<{ type: string; mult: number }> = [];
  for (const [atkType, byAtk] of typeChart) {
    let mult = 1.0;
    for (const defType of p.types) { const v = byAtk.get(defType); if (v !== undefined) mult *= v; }
    if (mult > 1.0) effectiveTypes.push({ type: atkType, mult });
  }
  effectiveTypes.sort((a, b) => b.mult - a.mult);

  if (!effectiveTypes.length) {
    return `Bot: ${displayName(identifier)} não tem fraquezas de tipo — difícil de contrariar pelo tipo.`;
  }

  const effectiveTypeIds = effectiveTypes.map((e) => e.type);
  const targetSpeed = p.baseStats.speed;
  const targetAtk = Math.max(p.baseStats.attack, p.baseStats.special_attack);

  type CandRow = { identifier: string; type1: string; type2: string | null; speed: number; spatk: number; atk: number };
  const inList = effectiveTypeIds.map(() => '?').join(',');
  const candidates = engine.queryAll<CandRow>(
    `SELECT DISTINCT p2.identifier,
            MAX(CASE WHEN pt.slot=1 THEN pt.type_id END) AS type1,
            MAX(CASE WHEN pt.slot=2 THEN pt.type_id END) AS type2,
            COALESCE((SELECT value FROM pokemon_stats WHERE pokemon_id=p2.id AND stat_id='speed'), 60) AS speed,
            COALESCE((SELECT value FROM pokemon_stats WHERE pokemon_id=p2.id AND stat_id='special_attack'), 60) AS spatk,
            COALESCE((SELECT value FROM pokemon_stats WHERE pokemon_id=p2.id AND stat_id='attack'), 60) AS atk
     FROM pokemon p2 JOIN pokemon_types pt ON p2.id = pt.pokemon_id
     WHERE pt.type_id IN (${inList})
       AND p2.identifier NOT LIKE '%_mega%'
       AND p2.identifier NOT LIKE '%_gmax%'
     GROUP BY p2.id`,
    effectiveTypeIds
  );

  const scored = candidates.map((c) => {
    const defTypes = [c.type1, c.type2].filter(Boolean) as string[];
    let stabMult = 0;
    for (const et of effectiveTypes) {
      if (defTypes.includes(et.type)) stabMult = Math.max(stabMult, et.mult);
    }
    const speedAdv = c.speed > targetSpeed ? 20 : c.speed === targetSpeed ? 5 : 0;
    const offPow = Math.max(c.atk, c.spatk);
    let resistScore = 0;
    for (const targetType of p.types) {
      const byAtk = typeChart.get(targetType);
      let mult = 1.0;
      for (const dt of defTypes) { const v = byAtk?.get(dt); if (v !== undefined) mult *= v; }
      if (mult <= 0.5) resistScore += 10;
      if (mult === 0) resistScore += 20;
    }
    return { ...c, score: stabMult * 40 + speedAdv + offPow * 0.1 + resistScore };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 8);
  const weakList = effectiveTypes.map((e) => `${typeLabel(e.type)}${e.mult >= 4 ? '×4' : ''}`).join(', ');
  const lines = top.map((c, i) => {
    const defTypes = [c.type1, c.type2].filter(Boolean).map(typeLabel).join('/');
    const speedNote = c.speed > targetSpeed ? '↑' : c.speed < targetSpeed - 10 ? '↓' : '~';
    return `  ${i + 1}. ${displayName(c.identifier).padEnd(20)} ${defTypes.padEnd(16)} Vel:${c.speed}${speedNote}`;
  });
  return [
    `Bot: Counters para ${displayName(identifier)} (${p.types.map(typeLabel).join('/')}) — Fraquezas: ${weakList}`,
    ...lines,
  ].join('\n');
}

function handleCompareQuery(idA: string, idB: string, engine: DeterministicEngine): string {
  const a = engine.getPokemonContext(idA);
  const b = engine.getPokemonContext(idB);
  if (!a) return `Bot: ${displayName(idA)} não encontrado.`;
  if (!b) return `Bot: ${displayName(idB)} não encontrado.`;

  const STAT_ORDER: Array<{ id: keyof PokemonContext['baseStats']; label: string }> = [
    { id: 'hp', label: 'HP' }, { id: 'attack', label: 'Ataque' },
    { id: 'defense', label: 'Defesa' }, { id: 'special_attack', label: 'Atq.Esp.' },
    { id: 'special_defense', label: 'Def.Esp.' }, { id: 'speed', label: 'Velocidade' },
  ];
  const bstA = Object.values(a.baseStats).reduce((s, v) => s + v, 0);
  const bstB = Object.values(b.baseStats).reduce((s, v) => s + v, 0);

  const nameA = displayName(idA), nameB = displayName(idB);
  let aWins = 0, bWins = 0;
  const statLines = STAT_ORDER.map(({ id, label }) => {
    const va = a.baseStats[id], vb = b.baseStats[id];
    const m = va > vb ? '◄' : vb > va ? '►' : '=';
    if (va > vb) aWins++; else if (vb > va) bWins++;
    return `${label.padEnd(12)} ${String(va).padStart(4)} ${m} ${String(vb).padStart(4)}`;
  });
  statLines.push(`${'BST'.padEnd(12)} ${String(bstA).padStart(4)} ${bstA > bstB ? '◄' : bstB > bstA ? '►' : '='} ${String(bstB).padStart(4)}`);

  const typeChart = engine.getTypeChart();
  let multAvsB = 1.0, multBvsA = 1.0;
  for (const atkType of a.types) {
    const byAtk = typeChart.get(atkType);
    for (const defType of b.types) { const v = byAtk?.get(defType); if (v !== undefined) multAvsB *= v; }
  }
  for (const atkType of b.types) {
    const byAtk = typeChart.get(atkType);
    for (const defType of a.types) { const v = byAtk?.get(defType); if (v !== undefined) multBvsA *= v; }
  }

  const lines = [
    `Bot: ── Comparação: ${nameA} vs ${nameB} ──`,
    `Tipos: ${a.types.map(typeLabel).join('/')} vs ${b.types.map(typeLabel).join('/')}`,
    `${'Stat'.padEnd(12)} ${'A'.padStart(4)}   ${'B'.padStart(4)}`,
    ...statLines,
    '',
  ];
  if (multAvsB !== 1.0) lines.push(`Tipo de ${nameA} contra ${nameB}: ×${multAvsB}`);
  if (multBvsA !== 1.0) lines.push(`Tipo de ${nameB} contra ${nameA}: ×${multBvsA}`);
  lines.push(`Vantagem de stats: ${aWins > bWins ? nameA : bWins > aWins ? nameB : 'Empate'} (${aWins}×${bWins})`);
  return lines.join('\n');
}

function handleAbilityInfo(abilityId: string, engine: DeterministicEngine): string {
  type AbRow = { id: string; short_effect: string; effect: string };
  const ab = engine.queryAll<AbRow>('SELECT id, short_effect, effect FROM abilities WHERE id = ?', [abilityId]);
  if (!ab.length) return `Bot: Habilidade "${displayName(abilityId)}" não encontrada.`;

  type EffRow = { category: string; trigger: string; description: string };
  const eff = engine.queryAll<EffRow>('SELECT category, trigger, description FROM ability_effects WHERE ability_id = ?', [abilityId]);
  const lines = [
    `Bot: ── Habilidade: ${displayName(abilityId)} ──`,
    ab[0].short_effect || ab[0].effect || '(sem descrição)',
  ];
  if (eff.length) {
    lines.push(`Categoria: ${eff[0].category} | Ativação: ${eff[0].trigger.replace(/_/g, ' ')}`);
  }
  type PokeRow = { identifier: string };
  const pokemon = engine.queryAll<PokeRow>(
    `SELECT p.identifier FROM pokemon p JOIN pokemon_abilities pa ON p.id = pa.pokemon_id
     WHERE pa.ability_id = ? AND p.identifier NOT LIKE '%_mega%' AND p.identifier NOT LIKE '%_gmax%'
     ORDER BY pa.slot, p.id LIMIT 5`,
    [abilityId]
  );
  if (pokemon.length) lines.push(`Possui: ${pokemon.map((p) => displayName(p.identifier)).join(', ')}`);
  return lines.join('\n');
}

function handleAbilityInfoForPokemon(identifier: string, engine: DeterministicEngine): string {
  const p = engine.getPokemonContext(identifier);
  if (!p) return `Bot: Pokémon "${displayName(identifier)}" não encontrado.`;
  const lines = [`Bot: Habilidades de ${displayName(identifier)}:`];
  for (const abilityId of p.abilities) {
    const ab = engine.queryAll<{ short_effect: string }>('SELECT short_effect FROM abilities WHERE id = ?', [abilityId]);
    const effect = ab.length ? (ab[0].short_effect || '') : '';
    lines.push(`  • ${displayName(abilityId)}: ${effect.slice(0, 100) || '(sem descrição)'}`);
  }
  return lines.join('\n');
}

function handleMoveInfo(moveId: string, engine: DeterministicEngine): string {
  type MRow = { id: string; type_id: string; category: string; base_power: number; accuracy: number; pp: number; description: string };
  const move = engine.queryAll<MRow>('SELECT id, type_id, category, base_power, accuracy, pp, description FROM moves WHERE id = ?', [moveId]);
  if (!move.length) return `Bot: Golpe "${displayName(moveId)}" não encontrado.`;
  const m = move[0];
  type EffRow = { description: string };
  const eff = engine.queryAll<EffRow>('SELECT description FROM move_effects WHERE move_id = ?', [moveId]);
  const catLabels: Record<string, string> = { physical: 'Físico', special: 'Especial', status: 'Status' };
  const desc = (eff.length ? eff[0].description : m.description) || '(sem descrição)';
  return [
    `Bot: ── Golpe: ${displayName(moveId)} ──`,
    `Tipo: ${typeLabel(m.type_id)} | Categoria: ${catLabels[m.category] ?? m.category}`,
    `Poder: ${m.base_power > 0 ? m.base_power : '—'} | Precisão: ${m.accuracy > 0 ? m.accuracy + '%' : '—'} | PP: ${m.pp}`,
    desc.slice(0, 150),
  ].join('\n');
}

function handleMovelist(identifier: string, engine: DeterministicEngine): string {
  const p = engine.getPokemonContext(identifier);
  if (!p) return `Bot: Pokémon "${displayName(identifier)}" não encontrado.`;
  type MRow = { move_id: string; type_id: string; category: string; base_power: number; role: string | null };
  const moves = engine.queryAll<MRow>(
    `SELECT DISTINCT pm.move_id, m.type_id, m.category, m.base_power, mtr.role
     FROM pokemon_moves pm JOIN moves m ON pm.move_id = m.id
     LEFT JOIN move_tactical_role_seed mtr ON pm.move_id = mtr.move_id
     WHERE pm.pokemon_identifier = ?
     ORDER BY CASE WHEN mtr.role IS NOT NULL THEN 0 ELSE 1 END, m.base_power DESC
     LIMIT 60`,
    [identifier]
  );
  if (!moves.length) return `Bot: Nenhum golpe encontrado para ${displayName(identifier)}.`;
  const grouped = new Map<string, typeof moves>();
  for (const m of moves) {
    const key = m.role ?? '_outros';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(m);
  }
  const roleLabels: Record<string, string> = {
    damage: 'Dano', setup_buff: 'Setup', pivot: 'Pivot', screen_control: 'Tela/Field',
    protection: 'Proteção', recovery: 'Cura', speed_control: 'Controle Vel.',
    control: 'Controle', weather: 'Clima',
  };
  const lines = [`Bot: Golpes competitivos de ${displayName(identifier)} (${p.types.map(typeLabel).join('/')}):`];
  for (const [role, roleMoves] of grouped) {
    if (role === '_outros') continue;
    const label = roleLabels[role] ?? role;
    const sample = roleMoves.slice(0, 4).map((m) => {
      const isStab = p.types.includes(m.type_id);
      return `${displayName(m.move_id)}${isStab ? '*' : ''}`;
    });
    lines.push(`  ${label}: ${sample.join(', ')}`);
  }
  const others = (grouped.get('_outros') ?? []).slice(0, 5);
  if (others.length) {
    lines.push(`  Outros: ${others.map((m) => `${displayName(m.move_id)}(${m.base_power > 0 ? m.base_power : '—'})`).join(', ')}`);
  }
  lines.push('(* = STAB)');
  return lines.join('\n');
}

function handleTypeCoverage(targetType: string, engine: DeterministicEngine): string {
  const typeChart = engine.getTypeChart();
  const superEffective: string[] = [], notVery: string[] = [], immune: string[] = [];
  for (const [atkType, byAtk] of typeChart) {
    const mult = byAtk.get(targetType);
    if (mult === undefined) continue;
    if (mult >= 2) superEffective.push(typeLabel(atkType));
    else if (mult <= 0 ) immune.push(typeLabel(atkType));
    else if (mult < 1) notVery.push(typeLabel(atkType));
  }
  const label = typeLabel(targetType);
  const lines = [`Bot: Cobertura contra o tipo ${label}:`];
  if (superEffective.length) lines.push(`✓ Super-efetivo (×2): ${superEffective.join(', ')}`);
  if (notVery.length) lines.push(`✗ Não muito efetivo (×0.5): ${notVery.join(', ')}`);
  if (immune.length) lines.push(`✗ Imune (×0): ${immune.join(', ')}`);
  return lines.join('\n');
}

function handleWeakToType(attackType: string, engine: DeterministicEngine): string {
  const typeChart = engine.getTypeChart();
  const byAtk = typeChart.get(attackType);
  if (!byAtk) return `Bot: Tipo "${typeLabel(attackType)}" não encontrado.`;

  type TypeRow = { identifier: string; type1: string; type2: string | null };
  const allPoke = engine.queryAll<TypeRow>(
    `SELECT p.identifier,
            MAX(CASE WHEN pt.slot=1 THEN pt.type_id END) AS type1,
            MAX(CASE WHEN pt.slot=2 THEN pt.type_id END) AS type2
     FROM pokemon p JOIN pokemon_types pt ON p.id = pt.pokemon_id
     WHERE p.identifier NOT LIKE '%_mega%' AND p.identifier NOT LIKE '%_gmax%'
     GROUP BY p.id`
  );

  const x4: string[] = [], x2: string[] = [];
  for (const poke of allPoke) {
    const defTypes = [poke.type1, poke.type2].filter(Boolean) as string[];
    let mult = 1.0;
    for (const dt of defTypes) { const v = byAtk.get(dt); if (v !== undefined) mult *= v; }
    if (mult >= 4) x4.push(displayName(poke.identifier));
    else if (mult >= 2) x2.push(displayName(poke.identifier));
  }

  // Type matchups
  const weakTypes: string[] = [], resistTypes: string[] = [], immuneTypes: string[] = [];
  for (const [defType, mult] of byAtk) {
    if (mult >= 2) weakTypes.push(typeLabel(defType));
    else if (mult === 0) immuneTypes.push(typeLabel(defType));
    else if (mult < 1) resistTypes.push(typeLabel(defType));
  }

  const label = typeLabel(attackType);
  const lines = [`Bot: Pokémon fracos contra ${label} (${x4.length + x2.length} total):`];
  if (x4.length) lines.push(`  Dupla fraqueza ×4 (${x4.length}): ${x4.slice(0, 8).join(', ')}${x4.length > 8 ? '...' : ''}`);
  lines.push(`  Fraqueza simples ×2 (${x2.length}): ${x2.slice(0, 8).join(', ')}${x2.length > 8 ? '...' : ''}`);
  lines.push('');
  if (weakTypes.length) lines.push(`Tipos com fraqueza a ${label}: ${weakTypes.join(', ')}`);
  if (resistTypes.length) lines.push(`Tipos que resistem ${label}: ${resistTypes.join(', ')}`);
  if (immuneTypes.length) lines.push(`Tipos imunes a ${label}: ${immuneTypes.join(', ')}`);
  return lines.join('\n');
}

function handleBSTThreshold(comparator: '>' | '<', threshold: number, engine: DeterministicEngine): string {
  const op = comparator === '>' ? '>=' : '<=';
  const rows = engine.queryAll<{ identifier: string; bst: number }>(
    `SELECT p.identifier, SUM(ps.value) AS bst
     FROM pokemon p JOIN pokemon_stats ps ON p.id = ps.pokemon_id
     WHERE p.identifier NOT LIKE '%_mega%' AND p.identifier NOT LIKE '%_gmax%'
     GROUP BY p.id HAVING bst ${op} ?
     ORDER BY bst ${comparator === '>' ? 'DESC' : 'ASC'} LIMIT 30`,
    [threshold]
  );
  const label = comparator === '>' ? 'acima de' : 'abaixo de';
  const lines = [
    `Bot: Pokémon com BST ${label} ${threshold} (${rows.length} encontrados):`,
    ...rows.slice(0, 20).map((r, i) => `  ${String(i + 1).padStart(2)}. ${displayName(r.identifier).padEnd(22)} BST: ${r.bst}`),
  ];
  if (rows.length > 20) lines.push(`  ... e mais ${rows.length - 20}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Competitive synergy constants
// ---------------------------------------------------------------------------
const SUPPORT_MOVE_LABELS: Record<string, string> = {
  follow_me:    'Follow Me → redireciona ataques adversários, protege o parceiro',
  rage_powder:  'Rage Powder → redireciona ataques adversários, protege o parceiro',
  helping_hand: 'Helping Hand → +50% no poder de ataque do parceiro nesse turno',
  tailwind:     'Tailwind → dobra velocidade da equipe por 4 turnos',
  trick_room:   'Trick Room → inverte ordem de velocidade por 5 turnos',
  wide_guard:   'Wide Guard → protege equipe de movimentos spread (EQ, Rock Slide)',
  quick_guard:  'Quick Guard → bloqueia movimentos prioritários do adversário',
  fake_out:     'Fake Out → flinch no 1° turno, cria turno livre para o parceiro agir',
  aurora_veil:  'Aurora Veil → reduz dano físico e especial da equipe',
  snarl:        'Snarl → reduz SpAtk dos dois inimigos em campo',
};

const WEATHER_SETTERS: Record<string, string> = {
  drought: 'Sol intenso', drizzle: 'Chuva pesada',
  sand_stream: 'Tempestade de areia', snow_warning: 'Neve',
};
const WEATHER_BENEFICIARIES: Record<string, string[]> = {
  drought:      ['chlorophyll', 'solar_power', 'harvest', 'flower_gift'],
  drizzle:      ['swift_swim', 'rain_dish', 'hydration'],
  sand_stream:  ['sand_rush', 'sand_force'],
  snow_warning: ['slush_rush', 'ice_body'],
};

// Ability → weather/condition it activates under, and what it does
const ABILITY_CONDITION_MAP: Record<string, {
  condition: string; label: string; speedMult?: number; atkMult?: number;
}> = {
  chlorophyll:  { condition: 'drought',      label: 'Sol',   speedMult: 2 },
  solar_power:  { condition: 'drought',      label: 'Sol',   atkMult: 1.5 },
  flower_gift:  { condition: 'drought',      label: 'Sol' },
  harvest:      { condition: 'drought',      label: 'Sol' },
  swift_swim:   { condition: 'drizzle',      label: 'Chuva', speedMult: 2 },
  rain_dish:    { condition: 'drizzle',      label: 'Chuva' },
  hydration:    { condition: 'drizzle',      label: 'Chuva' },
  dry_skin:     { condition: 'drizzle',      label: 'Chuva' },
  sand_rush:    { condition: 'sand_stream',  label: 'Areia', speedMult: 2 },
  sand_force:   { condition: 'sand_stream',  label: 'Areia' },
  slush_rush:   { condition: 'snow_warning', label: 'Neve',  speedMult: 2 },
  ice_body:     { condition: 'snow_warning', label: 'Neve' },
};

// Moves that gain significant benefit under a specific condition
const MOVE_CONDITION_MAP: Record<string, { condition: string; benefit: string }> = {
  solar_beam:   { condition: 'drought',      benefit: 'dispensa turno de carga' },
  solar_blade:  { condition: 'drought',      benefit: 'dispensa turno de carga' },
  synthesis:    { condition: 'drought',      benefit: 'recupera 2/3 HP (vs 1/2)' },
  morning_sun:  { condition: 'drought',      benefit: 'recupera 2/3 HP (vs 1/2)' },
  moonlight:    { condition: 'drought',      benefit: 'recupera 2/3 HP (vs 1/2)' },
  thunder:      { condition: 'drizzle',      benefit: '100% de precisão, 30% paralisia' },
  hurricane:    { condition: 'drizzle',      benefit: '100% de precisão, 30% confusão' },
  blizzard:     { condition: 'snow_warning', benefit: '100% de precisão' },
  gyro_ball:    { condition: 'trick_room',   benefit: 'dano maior com velocidade baixa' },
};

const CONDITION_LABELS: Record<string, string> = {
  drought:      'Sol intenso',
  drizzle:      'Chuva pesada',
  sand_stream:  'Tempestade de areia',
  snow_warning: 'Neve',
  trick_room:   'Trick Room',
};

// Setup (self-buff) moves and what they do after 1 use
const SETUP_MOVES: Record<string, string> = {
  dragon_dance:     'após setup: +1 Atk, +1 Vel (×1.5 cada)',
  swords_dance:     'após setup: +2 Atk (×2 Atk)',
  nasty_plot:       'após setup: +2 SpAtk (×2 SpAtk)',
  quiver_dance:     'após setup: +1 SpAtk, +1 SpDef, +1 Vel (×1.5 cada)',
  shell_smash:      'após setup: +2 Atk, +2 SpAtk, +2 Vel (ofensiva ×2, sacrifica bulk)',
  calm_mind:        'acumula: +1 SpAtk, +1 SpDef por uso',
  bulk_up:          'acumula: +1 Atk, +1 Def por uso',
  coil:             'acumula: +1 Atk, +1 Def, +1 Acc por uso',
  growth:           '+1 Atk, +1 SpAtk (+2/+2 com Sol) — sinergia crítica com clima',
  belly_drum:       'maximiza Atk instantaneamente — requer sobreviver com alta HP',
  geomancy:         'após 1 turno: +2 SpAtk, +2 SpDef, +2 Vel',
  shift_gear:       'após setup: +1 Atk, +2 Vel',
  clangorous_soul:  'após setup: +1 todos os stats (+1 Atk, Def, SpAtk, SpDef, Vel)',
};

// Abilities that require a trigger condition (status, stat drop, etc.)
const STATUS_ABILITY_MAP: Record<string, { trigger: string; effect: string }> = {
  guts:         { trigger: 'status (Flame Orb ou Toxic Orb)', effect: '+50% Atk, ignora redução por queimadura' },
  quick_feet:   { trigger: 'status (Flame Orb ou Toxic Orb)', effect: '+50% Vel' },
  marvel_scale: { trigger: 'status', effect: '+50% Def' },
  defiant:      { trigger: 'qualquer −stat do inimigo (inclui Intimidate)', effect: '+2 Atk — counter natural vs Intimidate' },
  competitive:  { trigger: 'qualquer −stat do inimigo (inclui Intimidate)', effect: '+2 SpAtk — counter natural vs Intimidate' },
  speed_boost:  { trigger: 'fim de cada turno', effect: '+1 Vel por turno — sobrevivência é prioridade' },
  anger_point:  { trigger: 'crítico recebido', effect: 'maximiza Atk (+6) instantaneamente' },
  contrary:     { trigger: 'qualquer move de −stat', effect: 'inverte para +stat (use Overheat, Leaf Storm, etc.)' },
};

interface NeedsProfile {
  primaryCondition: string | null;
  abilityInsights: string[];
  moveInsights: string[];
  speedUnderCondition: number | null;
  hasCriticalNeed: boolean;      // speed dead-zone without weather condition
  setupMoves: Array<{ move: string; desc: string }>;
  frailtyLevel: 'none' | 'moderate' | 'critical';
  statusAbilityInsights: string[];
}

function classifyCompRole(p: PokemonContext): string {
  const { attack, special_attack: spAtk, speed, hp, defense, special_defense: spDef } = p.baseStats;
  const mainOff = Math.max(attack, spAtk);
  const offBias = attack > spAtk + 25 ? 'físico' : spAtk > attack + 25 ? 'especial' : 'misto';
  if (mainOff >= 115 && speed >= 95) return `Sweeper ${offBias} extremo — win condition`;
  if (mainOff >= 90 && speed >= 80) return `Attacker ${offBias} — win condition`;
  if (speed <= 50 && mainOff >= 95) return `Trick Room Abuser ${offBias} — win condition`;
  if (speed >= 100 && mainOff < 80) return 'Speed Control / Pivot — enabler';
  if (hp >= 80 && (defense >= 80 || spDef >= 80) && mainOff < 85) return 'Suporte / Pivot — enabler';
  return `Attacker ${offBias}`;
}

function stabCoverage(types: string[], typeChart: Map<string, Map<string, number>>): Set<string> {
  const covered = new Set<string>();
  for (const atkType of types) {
    const byAtk = typeChart.get(atkType);
    if (!byAtk) continue;
    for (const [defType, mult] of byAtk) { if (mult >= 2) covered.add(defType); }
  }
  return covered;
}

function analyzeNeeds(p: PokemonContext, moveset: Set<string>): NeedsProfile {
  const condPriority = new Map<string, number>();
  const abilityInsights: string[] = [];
  const moveInsights: string[] = [];

  for (const abilityId of p.abilities) {
    const cond = ABILITY_CONDITION_MAP[abilityId];
    if (!cond) continue;
    const priority = cond.speedMult ? 3 : cond.atkMult ? 2 : 1;
    condPriority.set(cond.condition, Math.max(condPriority.get(cond.condition) ?? 0, priority));
    let note = `${displayName(abilityId)} ativa com ${cond.label}`;
    if (cond.speedMult) note += ` → Vel ${p.baseStats.speed} → ${p.baseStats.speed * cond.speedMult}`;
    else if (cond.atkMult) note += ` → +50% Atq.Esp.`;
    abilityInsights.push(note);
  }

  for (const moveId of moveset) {
    const mc = MOVE_CONDITION_MAP[moveId];
    if (!mc) continue;
    condPriority.set(mc.condition, Math.max(condPriority.get(mc.condition) ?? 0, 2));
    moveInsights.push(`${displayName(moveId)} — ${mc.benefit} (requer ${CONDITION_LABELS[mc.condition] ?? mc.condition})`);
  }

  let primaryCondition: string | null = null;
  let maxPriority = 0;
  for (const [cond, priority] of condPriority) {
    if (priority > maxPriority) { maxPriority = priority; primaryCondition = cond; }
  }

  let speedUnderCondition: number | null = null;
  if (primaryCondition) {
    for (const abilityId of p.abilities) {
      const cond = ABILITY_CONDITION_MAP[abilityId];
      if (cond?.condition === primaryCondition && cond.speedMult) {
        speedUnderCondition = p.baseStats.speed * cond.speedMult;
        break;
      }
    }
  }

  // Critical need: speed-doubling ability in the "dead zone" (55–95 base speed)
  // where the Pokémon is too slow for Tailwind teams and too fast for Trick Room
  const hasSpeedDoubler = p.abilities.some((ab) => (ABILITY_CONDITION_MAP[ab]?.speedMult ?? 0) >= 2);
  const inDeadZone = p.baseStats.speed >= 55 && p.baseStats.speed <= 95;
  const hasCriticalNeed = hasSpeedDoubler && inDeadZone && primaryCondition !== null;

  // Setup moves — each one requires a protected turn to activate
  const setupMoves: Array<{ move: string; desc: string }> = [];
  for (const moveId of moveset) {
    const sm = SETUP_MOVES[moveId];
    if (!sm) continue;
    // Special case: Growth under sun is +2/+2 instead of +1/+1
    const desc = (moveId === 'growth' && primaryCondition === 'drought')
      ? '+2 Atk e +2 SpAtk sob Sol (vs +1/+1 normal) — sinergia crítica com clima'
      : sm;
    setupMoves.push({ move: moveId, desc });
  }

  // Frailty: glass cannon profile (high offense, low bulk)
  const { hp, defense: defStat, special_defense: spDefStat, attack: atkStat, special_attack: spAtkStat } = p.baseStats;
  const mainOffense = Math.max(atkStat, spAtkStat);
  const physBulk = hp * defStat;
  const specBulk = hp * spDefStat;
  const frailtyLevel: 'none' | 'moderate' | 'critical' =
    (hp < 70 && Math.min(defStat, spDefStat) < 65) ? 'critical'
    : (Math.min(physBulk, specBulk) < 7000 && mainOffense >= 110) ? 'moderate'
    : 'none';

  // Status-activated and trigger-based abilities
  const statusAbilityInsights: string[] = [];
  for (const abilityId of p.abilities) {
    const sa = STATUS_ABILITY_MAP[abilityId];
    if (!sa) continue;
    statusAbilityInsights.push(`${displayName(abilityId)} — ${sa.effect} (ativa: ${sa.trigger})`);
    // Contrary with a high-power self-drop move is a primary identity — override any
    // weather condition that may have been inferred from learnable moves only
    if (abilityId === 'contrary') {
      const contraryMoves = ['leaf_storm', 'draco_meteor', 'overheat', 'psycho_boost', 'close_combat', 'superpower'];
      if (contraryMoves.some((m) => moveset.has(m))) {
        condPriority.set('contrary_setup', 4); // outranks weather (priority 3) and moves (2)
        primaryCondition = 'contrary_setup';
        maxPriority = 4;
      }
    }
  }

  return {
    primaryCondition, abilityInsights, moveInsights, speedUnderCondition, hasCriticalNeed,
    setupMoves, frailtyLevel, statusAbilityInsights,
  };
}

function handlePairSynergy(idA: string, idB: string, engine: DeterministicEngine): string {
  const a = engine.getPokemonContext(idA);
  const b = engine.getPokemonContext(idB);
  if (!a) return `Bot: ${displayName(idA)} não encontrado.`;
  if (!b) return `Bot: ${displayName(idB)} não encontrado.`;

  type MRow = { move_id: string };
  const movesA = new Set(engine.queryAll<MRow>('SELECT DISTINCT move_id FROM pokemon_moves WHERE pokemon_identifier = ?', [idA]).map((r) => r.move_id));
  const movesB = new Set(engine.queryAll<MRow>('SELECT DISTINCT move_id FROM pokemon_moves WHERE pokemon_identifier = ?', [idB]).map((r) => r.move_id));

  const nameA = displayName(idA), nameB = displayName(idB);
  const roleA = classifyCompRole(a), roleB = classifyCompRole(b);

  // Direct support moves: which moves of B support A (and vice versa)
  const bSupportsA: string[] = [];
  const aSupportsB: string[] = [];
  for (const [move, label] of Object.entries(SUPPORT_MOVE_LABELS)) {
    if (movesB.has(move)) bSupportsA.push(`${nameB} tem ${label}`);
    if (movesA.has(move)) aSupportsB.push(`${nameA} tem ${label}`);
  }

  // Intimidate
  if (b.abilities.includes('intimidate')) bSupportsA.push(`${nameB} tem Intimidate → −1 Atk dos inimigos, protege ${nameA} de dano físico`);
  if (a.abilities.includes('intimidate')) aSupportsB.push(`${nameA} tem Intimidate → −1 Atk dos inimigos, protege ${nameB} de dano físico`);

  // Serene Grace + Air Slash flinch lock
  if (b.abilities.includes('serene_grace') && movesB.has('air_slash')) bSupportsA.push(`${nameB} Serene Grace + Air Slash → 60% flinch, trava ação inimiga`);
  if (a.abilities.includes('serene_grace') && movesA.has('air_slash')) aSupportsB.push(`${nameA} Serene Grace + Air Slash → 60% flinch, trava ação inimiga`);

  // EQ safety
  const bImmEQ = b.types.includes('flying') || b.abilities.includes('levitate');
  const aImmEQ = a.types.includes('flying') || a.abilities.includes('levitate');
  if (movesA.has('earthquake') && bImmEQ) aSupportsB.push(`${nameA} pode usar Earthquake livremente (${nameB} imune — sem friendly fire)`);
  if (movesB.has('earthquake') && aImmEQ) bSupportsA.push(`${nameB} pode usar Earthquake livremente (${nameA} imune — sem friendly fire)`);

  // Weather synergy
  for (const [ab, weather] of Object.entries(WEATHER_SETTERS)) {
    const beneficiaries = WEATHER_BENEFICIARIES[ab] ?? [];
    if (b.abilities.includes(ab) && a.abilities.some((x) => beneficiaries.includes(x))) bSupportsA.push(`${nameB} seta ${weather} → ativa habilidade de ${nameA}`);
    if (a.abilities.includes(ab) && b.abilities.some((x) => beneficiaries.includes(x))) aSupportsB.push(`${nameA} seta ${weather} → ativa habilidade de ${nameB}`);
  }

  // Combined offensive coverage
  const typeChart = engine.getTypeChart();
  const covA = stabCoverage(a.types, typeChart);
  const covB = stabCoverage(b.types, typeChart);
  const covCombined = new Set([...covA, ...covB]);
  const allTypeIds = Object.keys(TYPE_LABELS);
  const uncovered = allTypeIds.filter((t) => !covCombined.has(t));

  // Trick Room duality
  const speedA = a.baseStats.speed, speedB = b.baseStats.speed;
  const trDuality = (speedA <= 55 && speedB >= 85) || (speedB <= 55 && speedA >= 85);

  const lines = [
    `Bot: ── Sinergia Competitiva: ${nameA} + ${nameB} ──`,
    '',
    `${nameA}: ${roleA} | Vel ${speedA} | ${a.types.map(typeLabel).join('/')}`,
    `${nameB}: ${roleB} | Vel ${speedB} | ${b.types.map(typeLabel).join('/')}`,
  ];

  const allSupport = [...bSupportsA, ...aSupportsB];
  if (allSupport.length > 0) {
    lines.push('');
    lines.push('Sinergia de setup:');
    allSupport.forEach((s) => lines.push(`  ✓ ${s}`));
  } else {
    lines.push('');
    lines.push('Sinergia de setup: nenhuma sinergia direta de moveset/habilidade detectada.');
  }

  lines.push('');
  lines.push('Cobertura ofensiva STAB combinada:');
  lines.push(`  ${nameA}: SE contra ${[...covA].map(typeLabel).join(', ') || '—'}`);
  lines.push(`  ${nameB}: SE contra ${[...covB].map(typeLabel).join(', ') || '—'}`);
  if (uncovered.length === 0) {
    lines.push('  ✓ Cobertura total — a dupla bate SE todos os 18 tipos');
  } else {
    lines.push(`  Sem cobertura SE: ${uncovered.map(typeLabel).join(', ')}`);
  }

  if (trDuality) {
    const slow = speedA <= 55 ? nameA : nameB;
    const fast = speedA >= 85 ? nameA : nameB;
    lines.push('');
    lines.push(`Trick Room: ${slow} (lento) + ${fast} (rápido) — funciona em ambos os modos de velocidade`);
  }

  return lines.join('\n');
}

function handleSynergySuggestions(identifier: string, engine: DeterministicEngine): string {
  const p = engine.getPokemonContext(identifier);
  if (!p) return `Bot: Pokémon "${displayName(identifier)}" não encontrado.`;

  const name = displayName(identifier);
  const { attack, special_attack: spAtk, speed } = p.baseStats;
  const mainOff = Math.max(attack, spAtk);
  const needsTR = speed <= 50;
  const isAttacker = mainOff >= 85 && (speed >= 60 || needsTR);
  const role = classifyCompRole(p);
  const types = p.types.map(typeLabel).join('/');

  type SRow = { identifier: string; types: string };
  const notOwnMega = (r: { identifier: string }) => !r.identifier.startsWith(identifier + '_mega');

  // Load moveset for condition analysis
  const movesetRows = engine.queryAll<{ move_id: string }>(
    'SELECT DISTINCT move_id FROM pokemon_moves WHERE pokemon_identifier = ?', [identifier]
  );
  const moveset = new Set(movesetRows.map((r) => r.move_id));
  const needs = analyzeNeeds(p, moveset);

  const sections: string[] = [
    `Bot: ── Parceiros competitivos para ${name} (${types}) ──`,
    `Papel: ${role}`,
    '',
  ];

  // 0. Needs analysis — what this Pokémon requires to be a real competitive threat
  const hasAnyNeed = needs.abilityInsights.length > 0 || needs.moveInsights.length > 0
    || needs.setupMoves.length > 0 || needs.frailtyLevel !== 'none'
    || needs.statusAbilityInsights.length > 0;

  if (hasAnyNeed) {
    sections.push(`Para ${name} alcançar seu potencial, precisa de:`);

    // Weather/condition dependencies
    needs.abilityInsights.forEach((i) => sections.push(`  ⚡ ${i}`));
    needs.moveInsights.forEach((i) => sections.push(`  ⚡ ${i}`));
    if (needs.hasCriticalNeed) {
      sections.push(`  ⚠ Sem essa condição: Vel ${p.baseStats.speed} é lenta demais para Tailwind e rápida demais para Trick Room`);
    }

    // Setup moves
    if (needs.setupMoves.length > 0) {
      needs.setupMoves.forEach((sm) =>
        sections.push(`  ⚡ ${displayName(sm.move)} — ${sm.desc} → precisa de 1 turno protegido para ativar`)
      );
    }

    // Frailty warning
    if (needs.frailtyLevel === 'critical') {
      sections.push(`  ⚠ Bulk crítico (HP ${p.baseStats.hp} / Def ${p.baseStats.defense} / SpDef ${p.baseStats.special_defense}) — precisa de Follow Me ou Fake Out para conseguir agir`);
    } else if (needs.frailtyLevel === 'moderate') {
      sections.push(`  ⚠ Glass cannon (off. alta, bulk baixo) — Follow Me ou Fake Out recomendado`);
    }

    // Status/trigger-activated abilities
    if (needs.statusAbilityInsights.length > 0) {
      needs.statusAbilityInsights.forEach((s) => sections.push(`  ⚡ ${s}`));
    }

    sections.push('');

    // Show primary condition setters as the most important partner type
    if (needs.primaryCondition && WEATHER_SETTERS[needs.primaryCondition] !== undefined) {
      const condLabel = CONDITION_LABELS[needs.primaryCondition];
      const settersList = engine.queryAll<SRow>(
        `SELECT DISTINCT p2.identifier,
                (SELECT GROUP_CONCAT(type_id, '/') FROM pokemon_types WHERE pokemon_id = p2.id ORDER BY slot) AS types
         FROM pokemon p2
         WHERE p2.id IN (SELECT pokemon_id FROM pokemon_abilities WHERE ability_id = ?)
           AND p2.identifier != ?
           AND p2.id NOT IN (SELECT DISTINCT from_id FROM pokemon_evolution)
         ORDER BY p2.id LIMIT 8`,
        [needs.primaryCondition, identifier]
      ).filter((r) => !isNfe(r.identifier) && notOwnMega(r));

      if (settersList.length) {
        const speedNote = needs.speedUnderCondition !== null
          ? ` — Vel base: ${p.baseStats.speed} → ${needs.speedUnderCondition} (sob ${condLabel})`
          : '';
        sections.push(`Parceiros que criam ${condLabel} — condição principal para ${name}${speedNote}:`);
        settersList.forEach((r) => {
          const legNote = isLegendary(r.identifier) ? ' [lendário]' : '';
          sections.push(`  • ${displayName(r.identifier)} (${r.types.split('/').map(typeLabel).join('/')})${legNote}`);
        });
        sections.push('');
      }
    }
  }

  // ── Partner scoring system ────────────────────────────────────────────────
  type Candidate = { identifier: string; types: string; score: number; contributions: string[] };
  const candidates = new Map<string, Candidate>();
  const addScore = (id: string, typesStr: string, points: number, reason: string): void => {
    if (!candidates.has(id)) candidates.set(id, { identifier: id, types: typesStr, score: 0, contributions: [] });
    const c = candidates.get(id)!;
    c.score += points;
    c.contributions.push(reason);
  };

  const typeChart = engine.getTypeChart();
  const computeWeaknesses = (defTypes: string[]): Set<string> => {
    const weak = new Set<string>();
    for (const [atkType, byAtk] of typeChart) {
      let mult = 1;
      for (const dt of defTypes) mult *= (byAtk.get(dt) ?? 1);
      if (mult >= 2) weak.add(atkType);
    }
    return weak;
  };
  const subjectWeaknesses = computeWeaknesses(p.types);

  // Condition setter — highest value partner for condition-dependent Pokémon
  if (needs.primaryCondition && WEATHER_SETTERS[needs.primaryCondition] !== undefined) {
    const condLabel = CONDITION_LABELS[needs.primaryCondition] ?? needs.primaryCondition;
    const speedNote = needs.speedUnderCondition !== null
      ? ` (Vel ${p.baseStats.speed} → ${needs.speedUnderCondition} sob ${condLabel})`
      : '';
    const condSetterScore = needs.hasCriticalNeed ? 80 : 60;
    engine.queryAll<SRow>(
      `SELECT DISTINCT p2.identifier,
              (SELECT GROUP_CONCAT(type_id, '/') FROM pokemon_types WHERE pokemon_id = p2.id ORDER BY slot) AS types
       FROM pokemon p2
       WHERE p2.id IN (SELECT pokemon_id FROM pokemon_abilities WHERE ability_id = ?)
         AND p2.identifier != ?
         AND p2.id NOT IN (SELECT DISTINCT from_id FROM pokemon_evolution)
       LIMIT 300`,
      [needs.primaryCondition, identifier]
    ).filter((r) => !isNfe(r.identifier) && notOwnMega(r))
     .forEach((r) => addScore(r.identifier, r.types, condSetterScore,
       `seta ${condLabel}${speedNote} → ativa o potencial completo de ${name}`));
  }

  // Redirect — Follow Me / Rage Powder protect attacker from targeted hits
  if (isAttacker) {
    engine.queryAll<SRow>(
      `SELECT DISTINCT p.identifier, GROUP_CONCAT(pt.type_id, '/') AS types
       FROM pokemon p JOIN pokemon_moves pm ON pm.pokemon_identifier = p.identifier
       JOIN pokemon_types pt ON p.id = pt.pokemon_id
       WHERE pm.move_id IN ('follow_me', 'rage_powder')
         AND p.identifier != ?
         ${FULLY_EVOLVED_SQL}
       GROUP BY p.id LIMIT 300`,
      [identifier]
    ).filter((r) => !isNfe(r.identifier) && notOwnMega(r))
     .forEach((r) => addScore(r.identifier, r.types, 25,
       `redireciona ataques adversários → ${name} ataca sem ser alvo`));
  }

  // Helping Hand — +50% damage boost for the attacker
  // No ORDER BY speed: slow TR setters (Slowbro, Farigiraf) using HH next turn are equally valid
  if (isAttacker) {
    engine.queryAll<SRow>(
      `SELECT DISTINCT p.identifier, GROUP_CONCAT(pt.type_id, '/') AS types
       FROM pokemon p JOIN pokemon_moves pm ON pm.pokemon_identifier = p.identifier
       JOIN pokemon_types pt ON p.id = pt.pokemon_id
       WHERE pm.move_id = 'helping_hand'
         AND p.identifier != ?
         ${FULLY_EVOLVED_SQL}
       GROUP BY p.id LIMIT 300`,
      [identifier]
    ).filter((r) => !isNfe(r.identifier) && notOwnMega(r))
     .forEach((r) => addScore(r.identifier, r.types, 20, `+50% no dano de ${name} nesse turno`));
  }

  // Trick Room setters (critical for slow Pokémon)
  if (needsTR) {
    engine.queryAll<SRow>(
      `SELECT DISTINCT p.identifier, GROUP_CONCAT(pt.type_id, '/') AS types
       FROM pokemon p JOIN pokemon_moves pm ON pm.pokemon_identifier = p.identifier
       JOIN pokemon_types pt ON p.id = pt.pokemon_id
       WHERE pm.move_id = 'trick_room'
         AND p.identifier != ?
         ${FULLY_EVOLVED_SQL}
       GROUP BY p.id LIMIT 300`,
      [identifier]
    ).filter((r) => !isNfe(r.identifier) && notOwnMega(r))
     .forEach((r) => addScore(r.identifier, r.types, 50,
       `seta Trick Room → ${name} age primeiro (Vel base ${p.baseStats.speed})`));
  }

  // Tailwind — speed support for non-TR teams
  if (!needsTR) {
    engine.queryAll<SRow>(
      `SELECT DISTINCT p.identifier, GROUP_CONCAT(pt.type_id, '/') AS types
       FROM pokemon p JOIN pokemon_moves pm ON pm.pokemon_identifier = p.identifier
       JOIN pokemon_types pt ON p.id = pt.pokemon_id
       WHERE pm.move_id = 'tailwind'
         AND p.identifier != ?
         ${FULLY_EVOLVED_SQL}
       GROUP BY p.id LIMIT 300`,
      [identifier]
    ).filter((r) => !isNfe(r.identifier) && notOwnMega(r))
     .forEach((r) => addScore(r.identifier, r.types, 15,
       `seta Tailwind → dobra a velocidade de ${name} por 3 turnos`));
  }

  // Fake Out — creates a free turn (reduced for TR teams since TR itself gives priority)
  {
    const foPoints = needsTR ? 10 : (18 + (needs.setupMoves.length > 0 ? 10 : 0));
    const setupDesc = needs.setupMoves.length > 0
      ? ` → turno livre para ${displayName(needs.setupMoves[0].move)}`
      : '';
    engine.queryAll<SRow>(
      `SELECT DISTINCT p.identifier, GROUP_CONCAT(pt.type_id, '/') AS types
       FROM pokemon p JOIN pokemon_moves pm ON pm.pokemon_identifier = p.identifier
       JOIN pokemon_types pt ON p.id = pt.pokemon_id
       WHERE pm.move_id = 'fake_out'
         AND p.identifier != ?
         ${FULLY_EVOLVED_SQL}
       GROUP BY p.id LIMIT 300`,
      [identifier]
    ).filter((r) => !isNfe(r.identifier) && notOwnMega(r))
     .forEach((r) => addScore(r.identifier, r.types, foPoints,
       `flinch no 1° turno${setupDesc} (${name} age sem risco)`));
  }

  // Prankster — gives priority to status moves (TR, screens, HH) — critical for TR teams
  if (needsTR) {
    engine.queryAll<SRow>(
      `SELECT DISTINCT p.identifier, GROUP_CONCAT(pt.type_id, '/') AS types
       FROM pokemon p JOIN pokemon_abilities pa ON p.id = pa.pokemon_id
       JOIN pokemon_types pt ON p.id = pt.pokemon_id
       WHERE pa.ability_id = 'prankster'
         AND p.identifier != ?
         ${FULLY_EVOLVED_SQL}
       GROUP BY p.id LIMIT 300`,
      [identifier]
    ).filter((r) => !isNfe(r.identifier) && notOwnMega(r))
     .forEach((r) => addScore(r.identifier, r.types, 10,
       `Prankster → Trick Room com prioridade, garante setup antes de qualquer golpe`));
  }

  // Armor Tail — blocks all priority moves targeting partner; shields attacker from Fake Out / Sucker Punch
  if (isAttacker) {
    engine.queryAll<SRow>(
      `SELECT DISTINCT p.identifier, GROUP_CONCAT(pt.type_id, '/') AS types
       FROM pokemon p JOIN pokemon_abilities pa ON p.id = pa.pokemon_id
       JOIN pokemon_types pt ON p.id = pt.pokemon_id
       WHERE pa.ability_id IN ('armor_tail', 'queenly_majesty')
         AND p.identifier != ?
         ${FULLY_EVOLVED_SQL}
       GROUP BY p.id LIMIT 300`,
      [identifier]
    ).filter((r) => !isNfe(r.identifier) && notOwnMega(r))
     .forEach((r) => addScore(r.identifier, r.types, 18,
       `Armor Tail → bloqueia movimentos de prioridade contra ${name} (Fake Out, Sucker Punch)`));
  }

  // Terrain setters that amplify partner's STAB moves
  if (isAttacker) {
    const terrainAbility = p.types.includes('psychic') ? 'psychic_surge'
      : p.types.includes('electric') ? 'electric_surge'
      : p.types.includes('grass') ? 'grassy_surge'
      : null;
    if (terrainAbility) {
      const terrainLabel = terrainAbility === 'psychic_surge' ? 'Psychic Surge → terreno Psíquico potencializa golpes de ' + name
        : terrainAbility === 'electric_surge' ? 'Electric Surge → terreno Elétrico potencializa golpes de ' + name
        : 'Grassy Surge → terreno Vegetal potencializa golpes de ' + name;
      engine.queryAll<SRow>(
        `SELECT DISTINCT p.identifier, GROUP_CONCAT(pt.type_id, '/') AS types
         FROM pokemon p JOIN pokemon_abilities pa ON p.id = pa.pokemon_id
         JOIN pokemon_types pt ON p.id = pt.pokemon_id
         WHERE pa.ability_id = ?
           AND p.identifier != ?
           ${FULLY_EVOLVED_SQL}
         GROUP BY p.id LIMIT 300`,
        [terrainAbility, identifier]
      ).filter((r) => !isNfe(r.identifier) && notOwnMega(r))
       .forEach((r) => addScore(r.identifier, r.types, 15, terrainLabel));
    }
  }

  // Intimidate — Atk debuff, physical protection for attacker
  if (isAttacker) {
    engine.queryAll<SRow>(
      `SELECT DISTINCT p.identifier, GROUP_CONCAT(pt.type_id, '/') AS types
       FROM pokemon p JOIN pokemon_abilities pa ON p.id = pa.pokemon_id
       JOIN pokemon_types pt ON p.id = pt.pokemon_id
       WHERE pa.ability_id = 'intimidate'
         AND p.identifier != ?
         ${FULLY_EVOLVED_SQL}
       GROUP BY p.id LIMIT 300`,
      [identifier]
    ).filter((r) => !isNfe(r.identifier) && notOwnMega(r))
     .forEach((r) => addScore(r.identifier, r.types, 15,
       `Intimidate → −1 Atk nos inimigos ao entrar, protege ${name} de dano físico`));
  }

  // EQ safe — immune partners let ${name} use Earthquake without friendly fire
  if (moveset.has('earthquake')) {
    engine.queryAll<SRow>(
      `SELECT DISTINCT p.identifier, GROUP_CONCAT(pt.type_id, '/') AS types
       FROM pokemon p JOIN pokemon_types pt ON p.id = pt.pokemon_id
       WHERE (p.id IN (SELECT pokemon_id FROM pokemon_types WHERE type_id = 'flying')
              OR p.id IN (SELECT pokemon_id FROM pokemon_abilities WHERE ability_id = 'levitate'))
         AND p.identifier != ?
         ${FULLY_EVOLVED_SQL}
       GROUP BY p.id LIMIT 300`,
      [identifier]
    ).filter((r) => !isNfe(r.identifier) && notOwnMega(r))
     .forEach((r) => addScore(r.identifier, r.types, 20,
       `imune a Earthquake → ${name} usa EQ livremente, sem friendly fire`));
  }

  // Instruct — doubles partner's last move, extreme value for high-damage attackers
  if (isAttacker) {
    engine.queryAll<SRow>(
      `SELECT DISTINCT p.identifier, GROUP_CONCAT(pt.type_id, '/') AS types
       FROM pokemon p JOIN pokemon_moves pm ON pm.pokemon_identifier = p.identifier
       JOIN pokemon_types pt ON p.id = pt.pokemon_id
       WHERE pm.move_id = 'instruct'
         AND p.identifier != ?
         ${FULLY_EVOLVED_SQL}
       GROUP BY p.id LIMIT 300`,
      [identifier]
    ).filter((r) => !isNfe(r.identifier) && notOwnMega(r))
     .forEach((r) => addScore(r.identifier, r.types, 20,
       `Instruct → ${name} usa o mesmo golpe duas vezes no turno`));
  }

  // Weather beneficiaries — partners that thrive under the weather ${name} sets
  for (const [weatherAbility, weatherLabel] of Object.entries(WEATHER_SETTERS)) {
    if (!p.abilities.includes(weatherAbility)) continue;
    const beneficiaryAbilities = WEATHER_BENEFICIARIES[weatherAbility] ?? [];
    if (!beneficiaryAbilities.length) continue;
    const inList = beneficiaryAbilities.map(() => '?').join(',');
    engine.queryAll<SRow>(
      `SELECT p2.identifier,
              (SELECT GROUP_CONCAT(type_id, '/') FROM pokemon_types WHERE pokemon_id = p2.id ORDER BY slot) AS types
       FROM pokemon p2
       WHERE p2.id IN (SELECT DISTINCT pokemon_id FROM pokemon_abilities WHERE ability_id IN (${inList}))
         AND p2.identifier != ?
         AND p2.id NOT IN (SELECT DISTINCT from_id FROM pokemon_evolution)
       ORDER BY (SELECT value FROM pokemon_stats WHERE pokemon_id = p2.id AND stat_id = 'special_attack') +
                (SELECT value FROM pokemon_stats WHERE pokemon_id = p2.id AND stat_id = 'attack') DESC
       LIMIT 300`,
      [...beneficiaryAbilities, identifier]
    ).filter((r) => !isNfe(r.identifier) && notOwnMega(r))
     .forEach((r) => addScore(r.identifier, r.types, 20,
       `beneficiado pelo ${weatherLabel} criado por ${name} (stats/velocidade dobram)`));
  }

  // ── Apply penalties ────────────────────────────────────────────────────────
  for (const [id, c] of candidates) {
    if (isLegendary(id)) c.score -= 8;

    // Shared weakness penalty — capped so strong typing choices aren't fully disqualified
    const candWeaknesses = computeWeaknesses(c.types.split('/'));
    const shared = [...subjectWeaknesses].filter((t) => candWeaknesses.has(t));
    if (shared.length >= 2) c.score -= Math.min(8 * shared.length, 18);
    else if (shared.length === 1) c.score -= 5;

    // Low-viability penalty — Pokémon with very low BST can't survive to use their support moves
    const cp2 = engine.getPokemonContext(id);
    if (cp2) {
      const { hp, attack: atk2, defense: def2, special_attack: sa2, special_defense: sd2, speed: sp2 } = cp2.baseStats;
      const bst = hp + atk2 + def2 + sa2 + sd2 + sp2;
      if (bst < 430) c.score -= 30;
    }
  }

  // Deduplicate: when both base form and mega are candidates, keep the higher-scoring one
  // (ties go to base form; mega stays only if it scored meaningfully higher)
  for (const id of [...candidates.keys()]) {
    const m = id.match(/^(.+?)_mega/);
    if (!m) continue;
    const base = m[1];
    const baseCand = candidates.get(base);
    if (!baseCand) continue;
    const megaCand = candidates.get(id)!;
    if (megaCand.score > baseCand.score) candidates.delete(base);
    else candidates.delete(id);
  }

  // ── Render top 4 ──────────────────────────────────────────────────────────
  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, 4);

  if (ranked.length === 0) {
    sections.push('Nenhum parceiro competitivo encontrado na base de dados.');
  } else {
    sections.push('Top parceiros recomendados:');
    sections.push('');
    ranked.forEach((c, i) => {
      const legNote = isLegendary(c.identifier) ? ' [lendário]' : '';
      sections.push(`${i + 1}. ${displayName(c.identifier)} (${c.types.split('/').map(typeLabel).join('/')})${legNote}`);

      const cp = engine.getPokemonContext(c.identifier);
      if (cp) {
        const { speed: spd, attack: atk, special_attack: spAtk, hp, defense: def, special_defense: spDef } = cp.baseStats;
        const cSpd = compSpeed(spd);
        const tier = speedTierLabel(spd);
        const mainOff = Math.max(atk, spAtk);
        const physBulk = hp * def;
        const specBulk = hp * spDef;
        const maxBulk = Math.max(physBulk, specBulk);

        // Speed note
        const speedNote = cSpd >= 156 ? `age antes da maioria (Vel comp ${cSpd})`
          : cSpd >= 112 ? `velocidade mediana (Vel comp ${cSpd})`
          : `muito lento — age por último; ideal sob Trick Room (Vel comp ${cSpd})`;

        // Primary competitive identity
        let identityNote: string;
        if (mainOff >= 120) {
          const offStat = atk > spAtk + 20 ? `Atk ${atk}` : spAtk > atk + 20 ? `SpAtk ${spAtk}` : `Atk/SpAtk ${atk}/${spAtk}`;
          identityNote = `atacante (${offStat}) — não é só suporte, ameaça real no campo`;
        } else if (maxBulk >= 9000) {
          const bulkSide = physBulk >= specBulk ? `Def ${def}` : `SpDef ${spDef}`;
          identityNote = `defensivo (HP ${hp} / ${bulkSide}) — aguenta golpes e mantém o papel por mais turnos`;
        } else if (maxBulk >= 6000) {
          identityNote = `suporte equilibrado (HP ${hp}) — serve de apoio sem se destacar na sobrevivência`;
        } else {
          identityNote = `suporte frágil (HP ${hp}) — entrega o efeito rápido mas precisa de proteção`;
        }

        sections.push(`   Perfil: ${tier} | ${speedNote}`);
        sections.push(`   Função: ${identityNote}`);

        // Shared weakness warning (only shown if there is overlap)
        const candWeaknesses = computeWeaknesses(c.types.split('/'));
        const shared = [...subjectWeaknesses].filter((t) => candWeaknesses.has(t));
        if (shared.length > 0) {
          sections.push(`   ⚠ Fraqueza compartilhada com ${name}: ${shared.map(typeLabel).join(', ')} — evite colocar ambos contra esses tipos`);
        }
      }

      c.contributions.forEach((contrib) => sections.push(`   • ${contrib}`));
      sections.push('');
    });
  }

  if (sections[sections.length - 1] === '') sections.pop();
  return sections.join('\n');
}

function handleHeldItemRecommendations(identifier: string, engine: DeterministicEngine): string {
  const p = engine.getPokemonContext(identifier);
  if (!p) return `Bot: Pokémon "${displayName(identifier)}" não encontrado.`;
  const { attack, defense, special_attack: spAtk, special_defense: spDef, speed, hp } = p.baseStats;
  const offBias = attack > spAtk + 25 ? 'physical' : spAtk > attack + 25 ? 'special' : 'mixed';
  const isSpeedControl = speed >= 100 && Math.max(attack, spAtk) < 85;
  const isBulky = hp >= 90 && (defense >= 85 || spDef >= 85);
  const isSweeper = speed >= 85 && Math.max(attack, spAtk) >= 95;
  const needsTR = speed <= 50;

  type HRow = { item_id: string; category: string; description: string; confidence: number; model_json: string };
  const items = engine.queryAll<HRow>(
    'SELECT item_id, category, description, confidence, model_json FROM held_item_effects WHERE confidence >= 0.72 ORDER BY confidence DESC'
  );

  const scored = items.map((item) => {
    let score = item.confidence;
    let model: string[];
    try { model = JSON.parse(item.model_json) as string[]; } catch { model = []; }
    const hasStat = (s: string) => model.some((m) => m.includes(s));
    if (offBias === 'physical' && (hasStat('stat_target-attack') || hasStat('modifier_kind-move_power_modifier'))) score += 0.18;
    if (offBias === 'special' && (hasStat('stat_target-special_attack') || hasStat('modifier_kind-move_power_modifier'))) score += 0.18;
    if (isSpeedControl && hasStat('stat_target-speed')) score += 0.22;
    if (isBulky && (item.category === 'defensive' || hasStat('modifier_kind-hp_recovery_modifier') || hasStat('modifier_kind-damage_taken_modifier'))) score += 0.12;
    if (isSweeper && item.category === 'offensive') score += 0.08;
    if (needsTR && hasStat('stat_target-speed')) score -= 0.15;
    for (const t of p.types) { if (hasStat(`type_hint-${t}`)) score += 0.12; }
    return { ...item, score };
  });

  const top = scored.filter((i) => i.category !== 'non_combat').sort((a, b) => b.score - a.score).slice(0, 6);
  if (!top.length) return `Bot: Nenhum held item recomendado para ${displayName(identifier)}.`;

  const types = p.types.map(typeLabel).join('/');
  const lines = top.map((item, i) => {
    const raw = item.description.replace(/Curadoria automatica de held item:\s*/i, '').trim();
    const desc = raw.length > 85 ? raw.slice(0, 82) + '…' : raw;
    const cat = item.category === 'offensive' ? '⚔' : item.category === 'defensive' ? '🛡' : item.category === 'form_control' ? '✨' : '◆';
    return `${i + 1}. ${cat} ${displayName(item.item_id)} — ${desc}`;
  });
  return [
    `Bot: Held items sugeridos para ${displayName(identifier)} (${types}):`,
    ...lines,
    `\nPerfil: ${isSpeedControl ? 'speed control' : isBulky ? 'bulk/suporte' : isSweeper ? 'sweeper' : 'utility'}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// NLU dispatcher
// ---------------------------------------------------------------------------
const HELP_MENU = [
  '• "perfil competitivo do [pokémon]"',
  '• "sinergias para [pokémon]"  /  "[A] + [B]" (análise de dupla)',
  '• "[A] vs [B]" (comparação de stats)',
  '• "quem bate [pokémon]" (counters por tipo)',
  '• "cadeia de evolução do [pokémon]"',
  '• "golpes que [pokémon] aprende"',
  '• "habilidades do [pokémon]"  /  "o que faz [ability]"',
  '• "o que é [golpe]" (info do move)',
  '• "item para [pokémon]"',
  '• "ranking de velocidade [sem lendários]"',
  '• "top 20 em HP / Ataque / BST"',
  '• "pokemon do tipo Fogo [da geração 3] [sem lendários]"',
  '• "pokemon da geração 3 [do tipo dragão]"',
  '• "legendários do tipo dragão"',
  '• "pokemon com BST acima de 600"',
  '• "quem é fraco contra Fogo"',
  '• "o que bate o tipo Pedra" (cobertura de tipo)',
].join('\n');

function detectIntent(t: string): string {
  // Two-pokemon comparison (FIRST — most specific signal)
  if (/\bvs\b|\bversus\b|comparar|comparando|diferenca.*entre|quem.*melhor.*entre/.test(t)) return 'compare';

  // Rankings
  if (/mais.*veloc|mais.*rapid|mais.*veloz|veloc.*rank|speed.*rank/.test(t)) return 'ranking_speed';
  if (/ranking|top\s*\d/.test(t)) {
    const s = extractStatNameFromText(t);
    return s === 'speed' ? 'ranking_speed' : 'ranking_stat';
  }
  if (/maior.*\b(hp|ataque|defesa|spatk|spdef|bst)\b|mais.*\b(hp|ataque|defesa)\b|top.*em.*(hp|ataque|defesa|velocidade|bst)/.test(t)) return 'ranking_stat';

  // BST threshold
  if (/bst.*(acima|abaixo|de|acima de|abaixo de)|pokemon.*bst|bst.*pokemon/.test(t)) return 'bst_threshold';

  // Competitive profile
  if (/perfil.*comp|papel.*comp|como.*usar.*comp|vis[aã]o.*comp/.test(t)) return 'competitive_profile';
  if (/\bperfil\b/.test(t)) return 'competitive_profile';

  // Synergy / pair
  if (/sinergi|parceir|combina.*com|quem.*bom.*junto|quem.*junto.*com/.test(t)) return 'synergy';
  if (/dupla\b/.test(t) && extractTwoPokemon(t) !== null) return 'pair_synergy';
  if (/dupla\b/.test(t)) return 'synergy';

  // Items
  if (/held.*item|item.*para|iten[s]?.*para|melhor.*item|melhor.*iten|equipamento|item.*recomend|iten[s]?.*recomend/.test(t)) return 'held_item';

  // Type weakness queries (BEFORE counter — "quem e fraco contra X" would match counter's "quem.*contra")
  if (/fraco.*contra|fraqueza.*a |fraqueza.*ao|fraqueza.*do tipo|quem.*e.*fraco|quem.*fraco|quem.*sofre/.test(t) && hasTypeToken(t)) return 'weak_to_type';

  // Counter
  if (/quem.*bate|quem.*vence|quem.*contra|counter.*para|como.*derrotar|como.*bater/.test(t)) return 'counter';
  if (/cobertura.*tipo|tipo.*cobertura|o que.*bate.*tipo|forte.*contra.*tipo|o que.*vence.*tipo/.test(t)) return 'type_coverage';
  if (/pokemon.*(?:do|de|com).*tipo|(?:do|de|com).*tipo.*pokemon|listar.*tipo|que.*tipo/.test(t)) return 'type_query';

  // Generation
  if (/lend[aá]r|legend[aá]r|m[ií]tico|mythic/.test(t)) return 'legendary_query';
  if (/(ger[ae]?[cç][aã]o?|gen)\s*\d/.test(t)) return 'generation_query';

  // Evolution
  if (/evolu[çc]|como.*evol|cadeia.*evol|quando.*evol/.test(t)) return 'evolution';

  // Movelist / ability list
  if (/que.*golpe.*aprende|golpe.*aprende|movelist|moveset.*de|golpes.*do|ataques.*do|golpes.*aprende/.test(t)) return 'movelist';
  if (/habilidade.*de|ability.*de|que.*habilidade.*tem|habilidades.*do/.test(t)) return 'ability_info_pokemon';

  // Specific move or ability info
  if (/o que.*faz|para que serve|como.*funciona/.test(t)) {
    if (/habilidade|ability|passiva/.test(t)) return 'ability_info';
    if (/golpe|move|ataque/.test(t)) return 'move_info';
    return 'ability_info'; // default to ability when ambiguous
  }
  if (/o que.*[eé]\b/.test(t)) {
    if (/habilidade|ability/.test(t)) return 'ability_info';
    return 'move_info'; // assume move if no qualifier
  }

  // Generic stats/detail
  if (/info|dados|detalhe|stat|base stat|atributo/.test(t)) return 'detail';

  return 'unknown';
}

function handleNLText(text: string, engine: DeterministicEngine): string {
  const t = text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const intent = detectIntent(t);
  const pokemonId = extractPokemonName(t);

  switch (intent) {
    case 'ranking_speed': {
      const excl = detectExcludeLegendary(t);
      const lm = t.match(/top\s*(\d+)/);
      return handleSpeedRanking(excl, lm ? Math.min(parseInt(lm[1], 10), 30) : 20, engine);
    }
    case 'ranking_stat': {
      const statId = extractStatNameFromText(t);
      const excl = detectExcludeLegendary(t);
      const lm = t.match(/top\s*(\d+)/);
      return handleStatRanking(statId, excl, lm ? Math.min(parseInt(lm[1], 10), 30) : 20, engine);
    }
    case 'bst_threshold': {
      const tm = t.match(/(\d{3,4})/);
      if (!tm) return 'Bot: Especifique um limite. Ex: "pokemon com BST acima de 600"';
      const comparator = /abaixo|menor/.test(t) ? '<' : '>';
      return handleBSTThreshold(comparator, parseInt(tm[1], 10), engine);
    }
    case 'competitive_profile':
      if (!pokemonId) return 'Bot: Qual Pokémon? Ex: "perfil competitivo do Garchomp"';
      return handleCompetitiveProfile(pokemonId, engine);
    case 'synergy':
      if (!pokemonId) return 'Bot: Qual Pokémon? Ex: "sinergias para Charizard"';
      return handleSynergySuggestions(pokemonId, engine);
    case 'pair_synergy': {
      const pair = extractTwoPokemon(t);
      if (!pair) return 'Bot: Especifique dois Pokémon. Ex: "dupla Garchomp + Togekiss"';
      return handlePairSynergy(pair[0], pair[1], engine);
    }
    case 'held_item':
      if (!pokemonId) return 'Bot: Qual Pokémon? Ex: "item para Garchomp"';
      return handleHeldItemRecommendations(pokemonId, engine);
    case 'counter':
      if (!pokemonId) return 'Bot: Qual Pokémon? Ex: "quem bate Garchomp"';
      return handleCounterQuery(pokemonId, engine);
    case 'compare': {
      const pair = extractTwoPokemon(t);
      if (!pair) return 'Bot: Especifique dois Pokémon. Ex: "Charizard vs Blastoise"';
      return handleCompareQuery(pair[0], pair[1], engine);
    }
    case 'evolution':
      if (!pokemonId) return 'Bot: Qual Pokémon? Ex: "como evolui Eevee"';
      return handleEvolutionChain(pokemonId, engine);
    case 'movelist':
      if (!pokemonId) return 'Bot: Qual Pokémon? Ex: "golpes que Togekiss aprende"';
      return handleMovelist(pokemonId, engine);
    case 'ability_info_pokemon':
      if (!pokemonId) return 'Bot: Qual Pokémon? Ex: "habilidades do Garchomp"';
      return handleAbilityInfoForPokemon(pokemonId, engine);
    case 'ability_info': {
      const abilityId = extractAbilityName(t);
      if (!abilityId && pokemonId) return handleAbilityInfoForPokemon(pokemonId, engine);
      if (!abilityId) return 'Bot: Qual habilidade? Ex: "o que faz Intimidate"';
      return handleAbilityInfo(abilityId, engine);
    }
    case 'move_info': {
      const moveId = extractMoveName(t);
      if (!moveId) return 'Bot: Qual golpe? Ex: "o que é Earthquake"';
      return handleMoveInfo(moveId, engine);
    }
    case 'type_query': {
      const typeId = extractTypeName(t);
      if (!typeId) return 'Bot: Qual tipo? Ex: "pokemon do tipo Fogo"';
      return handleTypeQuery(typeId, extractGenerationNumber(t), detectExcludeLegendary(t), engine);
    }
    case 'generation_query': {
      const gen = extractGenerationNumber(t);
      if (!gen) return 'Bot: Qual geração? Ex: "pokemon da geração 3"';
      return handleGenerationQuery(gen, extractTypeName(t), engine);
    }
    case 'legendary_query':
      return handleLegendaryQuery(extractGenerationNumber(t), extractTypeName(t), engine);
    case 'type_coverage': {
      const typeId = extractTypeName(t);
      if (!typeId) return 'Bot: Qual tipo? Ex: "o que bate o tipo Pedra"';
      return handleTypeCoverage(typeId, engine);
    }
    case 'weak_to_type': {
      const typeId = extractTypeName(t);
      if (!typeId) return 'Bot: Qual tipo? Ex: "quem é fraco contra Fogo"';
      return handleWeakToType(typeId, engine);
    }
    case 'detail':
      if (!pokemonId) return `Bot: Comandos disponíveis:\n${HELP_MENU}`;
      return handleCompetitiveProfile(pokemonId, engine);
    default:
      if (pokemonId) {
        return `Bot: Encontrei ${displayName(pokemonId)} — o que você quer saber?\n${HELP_MENU}`;
      }
      return `Bot: Comandos disponíveis:\n${HELP_MENU}`;
  }
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------
function handleCommand(input: string, engine: DeterministicEngine): string {
  const raw = input.trim();
  if (raw === '__PING__') return 'pong';
  if (raw === '__RESET__') return 'Bot: Estado da conversa reiniciado.';

  if (raw === '__POKEDEX_LIST_JSON__') {
    try {
      return JSON.stringify({ ok: true, pokemon: engine.getAllPokemon().map(buildListEntry) });
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e) });
    }
  }

  if (raw.startsWith('__POKEDEX_DETAIL_JSON__:')) {
    const identifier = raw.slice('__POKEDEX_DETAIL_JSON__:'.length).trim().toLowerCase().replace(/\s+/g, '_');
    try {
      const p = engine.getPokemonContext(identifier, { includeMoves: true });
      if (!p) return JSON.stringify({ ok: false, error: 'Pokémon não encontrado.' });
      return JSON.stringify({ ok: true, detail: buildDetailEntry(p, engine.getTypeChart()) });
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e) });
    }
  }

  if (raw === '') return 'Bot: Digite uma pergunta para continuar.';
  return handleNLText(raw, engine);
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
function main(): void {
  if (!fs.existsSync(DB_PATH)) {
    process.stderr.write(`[bridge] ERROR: SQLite not found at ${DB_PATH}\n`);
    process.exit(1);
  }

  let engine: DeterministicEngine;
  try {
    engine = new DeterministicEngine(DB_PATH);
  } catch (e) {
    process.stderr.write(`[bridge] ERROR opening DB: ${e}\n`);
    process.exit(1);
  }

  try {
    buildNameIndex(engine.getAllPokemon());
    process.stderr.write(`[bridge] name index: ${nameIndex.size} entries\n`);
  } catch (e) {
    process.stderr.write(`[bridge] WARN: name index failed: ${e}\n`);
  }

  try {
    buildAbilityIndex(engine);
    buildMoveIndex(engine);
    buildNfeSet(engine);
    process.stderr.write(`[bridge] ability index: ${abilityIndex.size} | move index: ${moveIndex.size} | nfe set: ${nfeIds.size}\n`);
  } catch (e) {
    process.stderr.write(`[bridge] WARN: ability/move index failed: ${e}\n`);
  }

  process.stderr.write(`[bridge] ready  db=${DB_PATH}\n`);

  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  rl.on('line', (line) => {
    try {
      writeResponse(handleCommand(line, engine));
    } catch (e) {
      writeResponse(`Bot: Ocorreu um erro interno (${e}).`);
    }
  });

  rl.on('close', () => {
    engine.close();
    process.exit(0);
  });
}

main();
