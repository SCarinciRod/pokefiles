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

const BRIDGE_VERSION = '2.1.0';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { DeterministicEngine, PokemonContext, BattleSimulator, BattleAI } from './engine';
import type { BattlePokemonConfig, BattleTeamConfig, BattleState, BattleAction, BattlePokemon, Nature } from './engine';

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
// NN inference — async process (stdout JSON-lines)
// ---------------------------------------------------------------------------

const NN_SCRIPT_PATH = process.env['BRIDGE_STRATEGY_SCRIPT']
  ?? path.join(__dirname, 'train', 'strategy', 'infer_strategy.py');
const NN_ALL_TYPES = [
  'normal','fire','water','electric','grass','ice',
  'fighting','poison','ground','flying','psychic','bug',
  'rock','ghost','dragon','dark','steel','fairy',
];
const NN_ROLES = ['physical_sweeper','special_sweeper','physical_wall','special_wall','tank','lead','support_utility'];

// Ability archetype flags — mirrors export_synergy_training_ts.js
const NN_ABILITY_ARCHETYPES: ReadonlyArray<ReadonlySet<string>> = [
  new Set(['drought','drizzle','sand_stream','snow_warning']),
  new Set(['swift_swim','chlorophyll','solar_power','slush_rush','sand_rush','harvest',
           'flower_gift','rain_dish','hydration','dry_skin','ice_body','sand_force']),
  new Set(['intimidate']),
  new Set(['electric_surge','psychic_surge','grassy_surge','misty_surge']),
  new Set(['surge_surfer','grass_pelt','analytic']),
  new Set(['prankster']),
  new Set(['speed_boost']),
  new Set(['regenerator','multiscale','magic_guard','sturdy','thick_fat','filter','solid_rock']),
];

// Move archetype flags — mirrors export_synergy_training_ts.js
const NN_MOVE_ARCHETYPES: ReadonlyArray<ReadonlySet<string>> = [
  new Set(['fake_out']),
  new Set(['trick_room']),
  new Set(['tailwind']),
  new Set(['follow_me','rage_powder']),
  new Set(['helping_hand']),
  new Set(['earthquake']),
  new Set(['protect','wide_guard','quick_guard','detect','baneful_bunker','spiky_shield']),
  new Set(['dragon_dance','nasty_plot','calm_mind','swords_dance','quiver_dance','shift_gear','shell_smash','bulk_up','coil']),
];

// Per-pokemon move archetype cache (populated at startup from DB)
const nnMoveArchetypeMap = new Map<number, number[]>();

let pyProcess: ChildProcess | null = null;
let nnReady = false;
const nnPendingRequests = new Map<string, (score: number) => void>();
let nnReqIdCounter = 0;

function nnAbilityArchetypes(abilities: string[]): number[] {
  return NN_ABILITY_ARCHETYPES.map((set) => abilities.some((a) => set.has(a)) ? 1 : 0);
}

function nnRoleOneHot(stats: PokemonContext['baseStats']): number[] {
  const s = stats;
  let roleIdx = 6; // support_utility
  if (s.attack >= 100 && s.speed >= 85 && s.special_attack < 90) roleIdx = 0;
  else if (s.special_attack >= 100 && s.speed >= 85 && s.attack < 90) roleIdx = 1;
  else if (s.defense >= 100 && s.hp >= 90) roleIdx = 2;
  else if (s.special_defense >= 100 && s.hp >= 90) roleIdx = 3;
  else if (s.hp >= 100 && s.defense >= 80 && s.special_defense >= 80) roleIdx = 4;
  else if (s.speed >= 110) roleIdx = 5;
  const vec = new Array(NN_ROLES.length).fill(0);
  vec[roleIdx] = 1;
  return vec;
}

function buildFeatureVector(a: PokemonContext, b: PokemonContext): number[] {
  const typesA = NN_ALL_TYPES.map((t) => a.types.includes(t) ? 1 : 0);
  const typesB = NN_ALL_TYPES.map((t) => b.types.includes(t) ? 1 : 0);
  const statsA = [a.baseStats.hp, a.baseStats.attack, a.baseStats.defense,
                  a.baseStats.special_attack, a.baseStats.special_defense, a.baseStats.speed].map((v) => v / 255);
  const statsB = [b.baseStats.hp, b.baseStats.attack, b.baseStats.defense,
                  b.baseStats.special_attack, b.baseStats.special_defense, b.baseStats.speed].map((v) => v / 255);
  const roleA = nnRoleOneHot(a.baseStats);
  const roleB = nnRoleOneHot(b.baseStats);
  const abA = nnAbilityArchetypes(a.abilities);
  const abB = nnAbilityArchetypes(b.abilities);
  const mvA = nnMoveArchetypeMap.get(a.id) ?? new Array(8).fill(0);
  const mvB = nnMoveArchetypeMap.get(b.id) ?? new Array(8).fill(0);
  return [...typesA, ...typesB, ...statsA, ...statsB, ...roleA, ...roleB, ...abA, ...abB, ...mvA, ...mvB];
  // 18+18+6+6+7+7+8+8+8+8 = 94
}

function buildNNMoveArchetypeMap(engine: DeterministicEngine): void {
  const rows = engine.queryAll<{ pokemon_id: number; move_id: string }>(
    `SELECT pokemon_id, move_id FROM pokemon_moves WHERE pokemon_id IS NOT NULL`
  );
  for (const { pokemon_id, move_id } of rows) {
    if (!nnMoveArchetypeMap.has(pokemon_id)) nnMoveArchetypeMap.set(pokemon_id, new Array(8).fill(0));
    const flags = nnMoveArchetypeMap.get(pokemon_id)!;
    for (let i = 0; i < NN_MOVE_ARCHETYPES.length; i++) {
      if (NN_MOVE_ARCHETYPES[i].has(move_id)) flags[i] = 1;
    }
  }
  process.stderr.write(`[bridge] nn move archetype map: ${nnMoveArchetypeMap.size} pokemon\n`);
}

function startNNProcess(): Promise<void> {
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

  if (!fs.existsSync(NN_SCRIPT_PATH)) {
    process.stderr.write('[bridge] nn: infer_strategy.py not found — heuristics only\n');
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    pyProcess = spawn(pythonCmd, [NN_SCRIPT_PATH], {
      cwd: process.env['BRIDGE_PY_CWD'] ?? path.join(__dirname, '..', '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let buf = '';
    pyProcess.stdout!.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as Record<string, unknown>;
          if (msg['type'] === 'ready') {
            nnReady = true;
            process.stderr.write('[bridge] nn: model ready\n');
            resolve();
          } else if (typeof msg['score'] === 'number' && typeof msg['id'] === 'string') {
            const cb = nnPendingRequests.get(msg['id'] as string);
            if (cb) { cb(msg['score'] as number); nnPendingRequests.delete(msg['id'] as string); }
          }
        } catch { /* ignore malformed lines */ }
      }
    });

    pyProcess.stderr!.on('data', (d: Buffer) => {
      process.stderr.write('[nn] ' + d.toString());
    });

    pyProcess.on('exit', (code) => {
      nnReady = false;
      pyProcess = null;
      process.stderr.write(`[bridge] nn process exited (code ${code})\n`);
      // Resolve any pending requests with fallback
      for (const [, cb] of nnPendingRequests) cb(0.5);
      nnPendingRequests.clear();
    });

    // Timeout: if model not ready in 20s, continue without NN
    setTimeout(() => { if (!nnReady) { process.stderr.write('[bridge] nn: startup timeout — heuristics only\n'); resolve(); } }, 20_000);
  });
}

function queryNN(features: number[]): Promise<number> {
  if (!nnReady || !pyProcess) return Promise.resolve(0.5);
  const id = String(nnReqIdCounter++);
  return new Promise<number>((resolve) => {
    nnPendingRequests.set(id, resolve);
    pyProcess!.stdin!.write(JSON.stringify({ id, features }) + '\n');
    setTimeout(() => {
      if (nnPendingRequests.has(id)) { nnPendingRequests.delete(id); resolve(0.5); }
    }, 5_000);
  });
}

// ---------------------------------------------------------------------------
// NLU intent classifier — async process (fallback for unknown intents)
// ---------------------------------------------------------------------------

const NLU_SCRIPT_PATH = process.env['BRIDGE_NLU_SCRIPT']
  ?? path.join(__dirname, 'train', 'nlu', 'infer_nlu.py');
const NLU_CONFIDENCE_THRESHOLD = 0.55; // only accept NLU prediction above this confidence

let nluProcess: ChildProcess | null = null;
let nluReady = false;
const nluPendingRequests = new Map<string, (result: { intent: string; confidence: number }) => void>();
let nluReqIdCounter = 0;

function startNLUProcess(): Promise<void> {
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

  if (!fs.existsSync(NLU_SCRIPT_PATH)) {
    process.stderr.write('[bridge] nlu: infer_nlu.py not found — regex-only intent detection\n');
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    nluProcess = spawn(pythonCmd, [NLU_SCRIPT_PATH], {
      cwd: process.env['BRIDGE_PY_CWD'] ?? path.join(__dirname, '..', '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let buf = '';
    nluProcess.stdout!.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as Record<string, unknown>;
          if (msg['type'] === 'ready') {
            nluReady = true;
            process.stderr.write('[bridge] nlu: model ready\n');
            resolve();
          } else if (typeof msg['intent'] === 'string' && typeof msg['id'] === 'string') {
            const cb = nluPendingRequests.get(msg['id'] as string);
            if (cb) {
              cb({ intent: msg['intent'] as string, confidence: (msg['confidence'] as number) ?? 0 });
              nluPendingRequests.delete(msg['id'] as string);
            }
          }
        } catch { /* ignore malformed lines */ }
      }
    });

    nluProcess.stderr!.on('data', (d: Buffer) => {
      process.stderr.write('[nlu] ' + d.toString());
    });

    nluProcess.on('exit', (code) => {
      nluReady = false;
      nluProcess = null;
      process.stderr.write(`[bridge] nlu process exited (code ${code})\n`);
      for (const [, cb] of nluPendingRequests) cb({ intent: 'unknown', confidence: 0 });
      nluPendingRequests.clear();
    });

    // Timeout: if not ready in 30s, continue without NLU
    setTimeout(() => {
      if (!nluReady) { process.stderr.write('[bridge] nlu: startup timeout — regex-only\n'); resolve(); }
    }, 30_000);
  });
}

function queryNLU(text: string): Promise<{ intent: string; confidence: number }> {
  if (!nluReady || !nluProcess) return Promise.resolve({ intent: 'unknown', confidence: 0 });
  const id = String(nluReqIdCounter++);
  return new Promise((resolve) => {
    nluPendingRequests.set(id, resolve);
    nluProcess!.stdin!.write(JSON.stringify({ id, text }) + '\n');
    setTimeout(() => {
      if (nluPendingRequests.has(id)) {
        nluPendingRequests.delete(id);
        resolve({ intent: 'unknown', confidence: 0 });
      }
    }, 5_000);
  });
}

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
    // Require ≥5 chars to avoid short substrings like "ho"/"chi"/"wo" matching unrelated words
    if (baseParts.length > 1 && baseParts[0].length >= 5 && !nameIndex.has(baseParts[0])) {
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

// Optimal String Alignment distance (Damerau-Levenshtein restricted) — handles transpositions
// as single edits (e.g. "urshfiu"↔"urshifu" = 1).  Uses 2-row DP, O(m·n) time.
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev2 = new Array<number>(n + 1).fill(0);            // dp[i-2][*]
  let prev1 = Array.from({ length: n + 1 }, (_, i) => i); // dp[i-1][*]
  const curr = new Array<number>(n + 1).fill(0);           // dp[i][*]
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,         // insert
        prev1[j] + 1,            // delete
        prev1[j - 1] + cost,     // substitute / match
      );
      // Transposition (OSA): swap a[i-1] ↔ b[j-1] costs 1 if they cross
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        curr[j] = Math.min(curr[j], prev2[j - 2] + 1);
      }
    }
    prev2 = prev1.slice();
    prev1 = curr.slice();
  }
  return curr[n];
}

// Fuzzy match: one token vs all nameIndex keys. Returns best (id, dist) pair within threshold.
// Threshold = max(1, floor(keyLen / 4)) — 1 edit ≤8 chars, 2 edits ≤12, 3 edits ≤16.
function fuzzyMatchToken(token: string, exclude: string[] = []): { id: string; dist: number } | null {
  if (token.length < 4) return null;
  const sortedKeys = [...nameIndex.keys()].sort((a, b) => b.length - a.length);
  let bestId: string | null = null;
  let bestDist = Infinity;
  let bestKeyLen = 0;
  for (const key of sortedKeys) {
    if (key.length < 4) continue;
    const maxDist = Math.max(1, Math.floor(key.length / 4));
    if (Math.abs(token.length - key.length) > maxDist) continue;
    const dist = levenshtein(token, key);
    if (dist <= maxDist && (dist < bestDist || (dist === bestDist && key.length > bestKeyLen))) {
      const candidate = nameIndex.get(key)!;
      if (!exclude.includes(candidate)) {
        bestDist = dist;
        bestKeyLen = key.length;
        bestId = candidate;
      }
    }
  }
  return bestId ? { id: bestId, dist: bestDist } : null;
}

function extractPokemonName(text: string): string | null {
  const t = text.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const sortedKeys = [...nameIndex.keys()].sort((a, b) => b.length - a.length);

  // Pass 1: exact substring match
  for (const key of sortedKeys) {
    if (t.includes(key)) return nameIndex.get(key)!;
  }

  // Pass 2: fuzzy fallback — check each token against all keys
  const tokens = t.split(/\s+/).filter((tok) => tok.length >= 4);
  let bestId: string | null = null;
  let bestDist = Infinity;
  let bestKeyLen = 0;
  for (const tok of tokens) {
    const match = fuzzyMatchToken(tok);
    if (match && (match.dist < bestDist || (match.dist === bestDist && tok.length > bestKeyLen))) {
      bestDist = match.dist;
      bestKeyLen = tok.length;
      bestId = match.id;
    }
  }
  return bestId;
}

function extractTwoPokemon(t: string): [string, string] | null {
  const sortedKeys = [...nameIndex.keys()].sort((a, b) => b.length - a.length);
  const found: string[] = [];
  let remaining = t.replace(/[^\w\s]/g, ' ');

  // Pass 1: exact substring match
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

  // Pass 2: fuzzy fallback for remaining tokens
  const tokens = remaining.split(/\s+/).filter((tok) => tok.length >= 4);
  for (const tok of tokens) {
    const match = fuzzyMatchToken(tok, found);
    if (match) {
      found.push(match.id);
      if (found.length === 2) return [found[0], found[1]];
    }
  }

  return found.length === 2 ? [found[0], found[1]] : null;
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
  const regions: Record<string, number> = { kanto:1,johto:2,hoenn:3,sinnoh:4,unova:5,kalos:6,alola:7,galar:8,paldea:9 };
  for (const [region, num] of Object.entries(regions)) {
    if (t.includes(region)) return num;
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

function buildEvolutionData(pokemonId: number, pokemonIdentifier: string, engine: DeterministicEngine) {
  interface EvoEdge { from_id: number; to_id: number; trigger: string; min_level: number | null; condition: string | null; }
  interface PRow { id: number; identifier: string; }
  interface TRow { type_id: string; }

  const allEdges = engine.queryAll<EvoEdge>('SELECT from_id, to_id, trigger, min_level, condition FROM pokemon_evolution');
  if (allEdges.length === 0) return { members: [], transitions: [] };

  const connectedIds = new Set<number>([pokemonId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of allEdges) {
      if (connectedIds.has(edge.from_id) && !connectedIds.has(edge.to_id)) { connectedIds.add(edge.to_id); changed = true; }
      if (connectedIds.has(edge.to_id) && !connectedIds.has(edge.from_id)) { connectedIds.add(edge.from_id); changed = true; }
    }
  }

  const chainEdges = allEdges.filter((e) => connectedIds.has(e.from_id) && connectedIds.has(e.to_id));
  if (chainEdges.length === 0) return { members: [], transitions: [] };

  const toIds = new Set(chainEdges.map((e) => e.to_id));
  const stages = new Map<number, number>();
  const queue: number[] = [];
  for (const id of connectedIds) { if (!toIds.has(id)) { stages.set(id, 1); queue.push(id); } }

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curStage = stages.get(cur)!;
    for (const edge of chainEdges) {
      if (edge.from_id === cur && !stages.has(edge.to_id)) { stages.set(edge.to_id, curStage + 1); queue.push(edge.to_id); }
    }
  }

  const members = [...connectedIds].map((id) => {
    const row = engine.queryAll<PRow>('SELECT id, identifier FROM pokemon WHERE id = ?', [id])[0];
    if (!row) return null;
    const types = engine.queryAll<TRow>('SELECT type_id FROM pokemon_types WHERE pokemon_id = ? ORDER BY slot', [id]).map((r) => r.type_id);
    return { id: row.id, identifier: row.identifier, display_name: displayName(row.identifier), types, stage: stages.get(id) ?? 1, current: id === pokemonId };
  }).filter(Boolean);

  const transitions = chainEdges.map((e) => {
    const fromRow = engine.queryAll<PRow>('SELECT identifier FROM pokemon WHERE id = ?', [e.from_id])[0];
    const toRow = engine.queryAll<PRow>('SELECT identifier FROM pokemon WHERE id = ?', [e.to_id])[0];
    if (!fromRow || !toRow) return null;
    let condition = e.condition ?? e.trigger;
    if (e.trigger === 'level_up') condition = e.min_level ? `Nível ${e.min_level}` : 'Level up';
    else if (e.trigger === 'use_item') condition = e.condition ? `Usar ${displayName(e.condition)}` : 'Usar item';
    else if (e.trigger === 'trade') condition = e.condition ? `Troca com ${displayName(e.condition)}` : 'Troca';
    else if (e.trigger === 'shed') condition = 'Level up (slot vazio)';
    else if (e.trigger === 'friendship') condition = e.min_level ? `Amizade (nível ${e.min_level})` : 'Amizade';
    return { from_identifier: fromRow.identifier, to_identifier: toRow.identifier, from_label: displayName(fromRow.identifier), to_label: displayName(toRow.identifier), condition };
  }).filter(Boolean);

  return { members, transitions };
}

function buildDetailEntry(p: PokemonContext, typeChart: Map<string, Map<string, number>>, engine: DeterministicEngine) {
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
  const typeRelations = { weaknesses, resistances, immunities };

  interface LoreRow { slot: number; entry: string; }
  const loreRows = engine.queryAll<LoreRow>('SELECT slot, entry FROM pokemon_lore WHERE pokemon_id = ? ORDER BY slot', [p.id]);
  const description = loreRows.find((r) => r.slot === 1)?.entry ?? null;
  const lore = loreRows.filter((r) => r.slot > 1).map((r) => r.entry).join(' ') || null;

  interface MoveRow { move_id: string; }
  const moveRows = engine.queryAll<MoveRow>('SELECT move_id FROM pokemon_moves WHERE pokemon_identifier = ? ORDER BY move_id', [p.identifier]);
  const moves_details = moveRows.map((r) => {
    const m = engine.getMove(r.move_id);
    if (!m) return { identifier: r.move_id, label: displayName(r.move_id), type: '', type_label: '-', category_label: '-', power: '-', accuracy: '-', pp: '-', priority: '0', effect: '-', effect_chance: null, ailment: null, effect_category: null };
    return {
      identifier: m.id, label: displayName(m.id),
      type: m.type_id, type_label: typeLabel(m.type_id),
      category_label: m.category === 'physical' ? 'Físico' : m.category === 'special' ? 'Especial' : 'Status',
      power: m.base_power > 0 ? String(m.base_power) : '—',
      accuracy: m.accuracy > 0 ? String(m.accuracy) : '—',
      pp: String(m.pp), priority: '0',
      effect: m.description,
      effect_chance: m.effect_chance !== null ? String(m.effect_chance) : null,
      ailment: m.ailment, effect_category: m.effect_category,
    };
  });

  const ability_options = p.abilities.map((abilityId) => {
    const a = engine.getAbility(abilityId);
    return {
      identifier: abilityId, label: displayName(abilityId),
      short_effect: a?.short_effect ?? '',
      effect: a?.effect ?? '',
      type_relations: typeRelations,
    };
  });

  const evolution = buildEvolutionData(p.id, p.identifier, engine);

  return {
    id: p.id, identifier: p.identifier, display_name: displayName(p.identifier),
    height_dm: p.height_dm, height_m: p.height_dm / 10,
    weight_hg: p.weight_hg, weight_kg: p.weight_hg / 10,
    types: p.types, type_labels: p.types.map(typeLabel),
    abilities: p.abilities.map(displayName), ability_identifiers: p.abilities,
    selected_ability: p.abilities[0] ?? '', source_generation: p.source_generation,
    stats: statEntries, max_stat: maxStat,
    type_relations: typeRelations,
    description, lore,
    moves_count: moveRows.length, moves_source: 'exact' as const, moves_details,
    ability_options, evolution,
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
  if (cs >= 200) return 'Elite';
  if (cs >= 178) return 'Muito rápido';
  if (cs >= 156) return 'Rápido';
  if (cs >= 134) return 'Médio';
  if (cs >= 112) return 'Lento';
  return 'Muito lento';
}

// ---------------------------------------------------------------------------
// Intent handlers
// ---------------------------------------------------------------------------

function handleCompetitiveProfile(identifier: string, engine: DeterministicEngine): string {
  const p = engine.getPokemonContext(identifier);
  if (!p) return `Bot: Pokémon "${displayName(identifier)}" não encontrado na base de dados.`;
  const { hp, attack, defense, special_attack: spAtk, special_defense: spDef, speed } = p.baseStats;
  const bst = hp + attack + defense + spAtk + spDef + speed;
  const mainOff = Math.max(attack, spAtk);
  const offBias = attack > spAtk + 25 ? 'physical' : spAtk > attack + 25 ? 'special' : null;
  const name = displayName(identifier);
  const types = p.types.map(typeLabel).join('/');

  // Load moveset
  type MRow = { move_id: string };
  const moveset = new Set(
    engine.queryAll<MRow>('SELECT DISTINCT move_id FROM pokemon_moves WHERE pokemon_identifier = ?', [identifier])
      .map((r) => r.move_id)
  );

  // Support identity (mirrors handleSynergySuggestions logic)
  const needsTR = speed <= 50;
  const inSpeedDeadZone = speed > 50 && speed <= 90;
  const isAttacker = mainOff >= 85 && (speed >= 60 || needsTR);
  const selfWeatherSetterAbility = p.abilities.find((ab) => ab in WEATHER_SETTERS);
  const hasFakeOut = moveset.has('fake_out');
  const hasRedirection = moveset.has('follow_me') || moveset.has('rage_powder');
  const hasIntimidateAbility = p.abilities.includes('intimidate');
  const isSupport = hasFakeOut || hasRedirection
    || (selfWeatherSetterAbility !== undefined && mainOff < 100)
    || (hasIntimidateAbility && !isAttacker);

  // Needs analysis
  const needs = analyzeNeeds(p, moveset);

  // Competitive stats
  const csHP = compHP(hp); const csAtk = compOffense(attack); const csSpAtk = compOffense(spAtk);
  const csDef = compDef(defense); const csSpDef = compDef(spDef); const csSpd = compSpeed(speed);

  // Weaknesses
  const typeChart = engine.getTypeChart();
  const weaknesses: string[] = [];
  for (const [atkType, byAtk] of typeChart) {
    let mult = 1.0;
    for (const defType of p.types) { const v = byAtk.get(defType); if (v !== undefined) mult *= v; }
    if (mult >= 2.0) weaknesses.push(`${typeLabel(atkType)}${mult >= 4 ? '×4' : ''}`);
  }

  // Primary STAB moves
  type StabMRow = { id: string; base_power: number; category: string };
  const primaryStabMoves: string[] = [];
  for (const stabType of p.types) {
    const catClause = offBias === 'physical' ? `m.category = 'physical'`
      : offBias === 'special' ? `m.category = 'special'`
      : `m.category IN ('physical', 'special')`;
    const best = engine.queryAll<StabMRow>(
      `SELECT m.id, m.base_power, m.category
       FROM moves m JOIN pokemon_moves pm ON m.id = pm.move_id
       WHERE pm.pokemon_identifier = ? AND m.type_id = ?
         AND ${catClause} AND m.base_power >= 60
       ORDER BY m.base_power DESC LIMIT 5`,
      [identifier, stabType]
    ).filter((m) => !STAB_MOVE_BLACKLIST.has(m.id)).slice(0, 2);
    for (const m of best) {
      primaryStabMoves.push(`${displayName(m.id)} (${m.base_power}BP, ${m.category === 'physical' ? 'fís.' : 'esp.'}, STAB×1.5)`);
    }
  }

  // Build output
  // Role — override for support archetypes (same logic as handleSynergySuggestions)
  let profileRole = classifyCompRole(p);
  if (hasFakeOut && hasIntimidateAbility) {
    profileRole = 'Suporte — Fake Out + Intimidate (enabler de campo)';
  } else if (hasRedirection) {
    profileRole = 'Suporte — Redireção (protege parceiro de ataques direcionados)';
  } else if (hasFakeOut) {
    profileRole = 'Speed Control / Pivot — enabler';
  } else if (selfWeatherSetterAbility && mainOff < 100) {
    profileRole = `Setter de ${WEATHER_SETTERS[selfWeatherSetterAbility]} / Suporte`;
  }

  const lines: string[] = [
    `Bot: ── Perfil Competitivo: ${name} ──`,
    `Papel: ${profileRole}`,
    `Tipos: ${types}${weaknesses.length > 0 ? ` | Fraquezas: ${weaknesses.join(', ')}` : ' | Sem fraquezas comuns'}`,
    '',
    `Stats base:  HP ${hp} / Atk ${attack} / Def ${defense} / SpAtk ${spAtk} / SpDef ${spDef} / Vel ${speed}  (BST ${bst})`,
    `Stats comp:  HP ${csHP} / Atk ${csAtk} / Def ${csDef} / SpAtk ${csSpAtk} / SpDef ${csSpDef} / Vel ${csSpd}  (Lvl50, 31IV, 252EV, +nat)`,
  ];

  // Speed line with VGC context
  if (needsTR) {
    lines.push(`Velocidade: Muito lento (${csSpd}) — ideal sob Trick Room | Tailwind → ${speed * 2}`);
  } else if (inSpeedDeadZone) {
    lines.push(`Velocidade: Dead zone (${csSpd}) — Tailwind → ${speed * 2} (attacker rápido) | Paralisia → ~${Math.round(speed / 2)} (viável TR)`);
  } else {
    lines.push(`Velocidade: ${speedTierLabel(speed)} (${csSpd}) | Tailwind → ${speed * 2}`);
  }

  // Abilities — with full explanations
  lines.push('');
  lines.push('Habilidades:');
  for (const abilityId of p.abilities) {
    const passive = PASSIVE_ABILITY_MAP[abilityId];
    const support = SUPPORT_ABILITY_MAP[abilityId];
    const cond = ABILITY_CONDITION_MAP[abilityId];
    const status = STATUS_ABILITY_MAP[abilityId];
    if (passive) {
      lines.push(`  ⚡ ${passive.label} — ${passive.note}`);
    } else if (support) {
      lines.push(`  ⚡ ${displayName(abilityId)} — ${support}`);
    } else if (cond) {
      let note = `${displayName(abilityId)} — ativa com ${cond.label}`;
      if (cond.speedMult) note += ` → Vel ${speed} × ${cond.speedMult} = ${speed * cond.speedMult}`;
      else if (cond.atkMult) note += ` → Atq×${cond.atkMult}`;
      lines.push(`  ⚡ ${note}`);
    } else if (status) {
      lines.push(`  ⚡ ${displayName(abilityId)} — ativa sob ${status.trigger}: ${status.effect}`);
    } else {
      const generic = GENERIC_ABILITY_NOTES[abilityId];
      lines.push(generic ? `  ○ ${displayName(abilityId)} — ${generic}` : `  ○ ${displayName(abilityId)}`);
    }
  }

  // Key moves
  const hasMoveInfo = needs.setupMoves.length > 0 || needs.spreadMoves.length > 0
    || primaryStabMoves.length > 0 || needs.moveInsights.length > 0
    || needs.statusAbilityInsights.length > 0;
  if (hasMoveInfo) {
    lines.push('');
    lines.push('Golpes principais:');
    needs.setupMoves.forEach((sm) =>
      lines.push(`  ◆ Setup: ${displayName(sm.move)} — ${sm.desc} (precisa de 1 turno protegido)`)
    );
    needs.moveInsights.forEach((mi) => lines.push(`  ◆ Cond.: ${mi}`));
    needs.statusAbilityInsights.forEach((si) => lines.push(`  ◆ ${si}`));
    if (needs.spreadMoves.length > 0) {
      lines.push(`  ◆ Área: ${needs.spreadMoves.slice(0, 4).join(' • ')}`);
    }
    if (primaryStabMoves.length > 0) {
      lines.push(`  ◆ STAB: ${primaryStabMoves.join(' • ')}`);
    }
  }

  // Held items
  const topItems = getTopHeldItems(p, moveset, isSupport, inSpeedDeadZone, engine, 3);
  if (topItems.length > 0) {
    lines.push('');
    lines.push('Held items sugeridos:');
    topItems.forEach((item) => lines.push(`  ${item.icon} ${displayName(item.item_id)} — ${item.note}`));
  }

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

// Spread moves that hit multiple targets in VGC doubles — keyed by attacking type
const VGC_SPREAD_MOVES: Record<string, Array<{ id: string; bp: number; note: string }>> = {
  rock:     [{ id: 'rock_slide',      bp: 75,  note: '30% flinch — atinge os dois inimigos' }],
  electric: [{ id: 'discharge',       bp: 80,  note: '30% paralisia — atinge os dois inimigos' }],
  ground:   [
    { id: 'earthquake', bp: 100, note: 'atinge todos no campo (inclui o parceiro!)' },
    { id: 'bulldoze',   bp: 60,  note: '-1 Vel a todos — inclui parceiro' },
  ],
  ice:      [
    { id: 'blizzard',   bp: 110, note: 'atinge os dois inimigos (100% accuracy sob Granizo)' },
    { id: 'icy_wind',   bp: 55,  note: '-1 Vel a ambos os inimigos' },
  ],
  fire:     [{ id: 'heat_wave',       bp: 95,  note: 'atinge os dois inimigos' }],
  water:    [{ id: 'surf',            bp: 90,  note: 'atinge todos no campo (inclui parceiro)' }],
  fairy:    [{ id: 'dazzling_gleam',  bp: 80,  note: 'atinge os dois inimigos' }],
  dark:     [{ id: 'snarl',           bp: 55,  note: '-1 Atq.Esp. a ambos os inimigos' }],
  dragon:   [{ id: 'breaking_swipe', bp: 60,  note: '-1 Ataque a ambos os inimigos' }],
  normal:   [{ id: 'hyper_voice',    bp: 90,  note: 'atinge os dois inimigos (ignora Substitute)' }],
};

function handleBadMatchups(identifier: string, engine: DeterministicEngine): string {
  const p = engine.getPokemonContext(identifier);
  if (!p) return `Bot: Pokémon "${displayName(identifier)}" não encontrado.`;

  const typeChart = engine.getTypeChart();
  const name = displayName(identifier);

  // Build weakness list
  const weaknesses: Array<{ type: string; mult: number }> = [];
  for (const [atkType, byAtk] of typeChart) {
    let mult = 1.0;
    for (const defType of p.types) { const v = byAtk.get(defType); if (v !== undefined) mult *= v; }
    if (mult > 1.0) weaknesses.push({ type: atkType, mult });
  }
  weaknesses.sort((a, b) => b.mult - a.mult);

  if (!weaknesses.length) {
    return `Bot: ${name} não tem fraquezas de tipo — é difícil de explorar pela cobertura de tipo no VGC.`;
  }

  const lines: string[] = [
    `Bot: ── Bad Matchups — ${name} (${p.types.map(typeLabel).join('/')}) ──`,
  ];

  // Per-weakness section: threats + spread move warning
  type ThreatRow = { identifier: string; speed: number; best_off: number };
  for (const { type, mult } of weaknesses) {
    const severity = mult >= 4 ? 'CRÍTICO ×4' : 'ALTO ×2';
    const spreadMoves = VGC_SPREAD_MOVES[type] ?? [];

    lines.push(`\n▶ Fraqueza ${typeLabel(type)} [${severity}]`);

    const threats = engine.queryAll<ThreatRow>(
      `SELECT p2.identifier,
        COALESCE((SELECT value FROM pokemon_stats WHERE pokemon_id=p2.id AND stat_id='speed'),60) AS speed,
        MAX(
          COALESCE((SELECT value FROM pokemon_stats WHERE pokemon_id=p2.id AND stat_id='attack'),60),
          COALESCE((SELECT value FROM pokemon_stats WHERE pokemon_id=p2.id AND stat_id='special_attack'),60)
        ) AS best_off
       FROM pokemon p2
       WHERE p2.id IN (SELECT pokemon_id FROM pokemon_types WHERE type_id = ?)
         AND p2.identifier NOT LIKE '%_mega%'
         AND p2.identifier NOT LIKE '%_gmax%'
         AND p2.id NOT IN (SELECT DISTINCT from_id FROM pokemon_evolution)
       ORDER BY best_off DESC
       LIMIT 5`,
      [type]
    );

    if (threats.length) {
      const top = threats.slice(0, 3);
      lines.push(`  Ameaças: ${top.map((t) => `${displayName(t.identifier)} (Off:${t.best_off} Vel:${t.speed})`).join(' | ')}`);
    }
    if (spreadMoves.length) {
      lines.push(`  Spread: ${spreadMoves.map((m) => `${displayName(m.id)} ${m.bp}BP — ${m.note}`).join(' | ')}`);
    }
  }

  // Workarounds
  lines.push(`\n── Como contornar ──`);

  // Type immunity partners for top weaknesses
  for (const { type } of weaknesses.slice(0, 3)) {
    const byAtk = typeChart.get(type);
    if (!byAtk) continue;
    const immuneDefTypes: string[] = [];
    for (const [defType, val] of byAtk) { if (val === 0) immuneDefTypes.push(defType); }
    if (immuneDefTypes.length) {
      lines.push(`  • Parceiro ${immuneDefTypes.map(typeLabel).join('/')} é imune a ${typeLabel(type)}`);
    }
  }

  // Wide Guard for spread coverage
  const hasSpreads = weaknesses.some((w) => (VGC_SPREAD_MOVES[w.type] ?? []).length > 0);
  if (hasSpreads) {
    lines.push(`  • Wide Guard bloqueia spread moves (Earthquake, Heat Wave…) por 1 turno`);
  }

  // Redirection support
  lines.push(`  • Follow Me / Rage Powder redireciona ataques single-target para o parceiro`);

  // Intimidate for physical weak types
  const PHYSICAL_TYPES = new Set(['fighting', 'ground', 'rock', 'dark', 'bug', 'dragon', 'steel', 'normal', 'poison', 'grass', 'ghost']);
  if (weaknesses.some((w) => PHYSICAL_TYPES.has(w.type))) {
    lines.push(`  • Intimidate reduz o Ataque de ameaçadores físicos antes de sofrerem dano`);
  }

  // Speed advantage / Trick Room
  if (p.baseStats.speed < 60) {
    lines.push(`  • Trick Room inverte a ordem de ação — ${name} (Vel:${p.baseStats.speed}) passa a agir primeiro`);
  } else if (p.baseStats.speed < 80) {
    lines.push(`  • Tailwind dobra a velocidade do time — útil se ameaças passam ${name} no speed tier`);
  }

  return lines.join('\n');
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

// Moves that gain significant benefit under a specific condition.
// minAtk / minSpAtk: minimum stat required for this move to be worth highlighting
// moveType: used to add (STAB) marker when the move's type matches the Pokémon's types
const MOVE_CONDITION_MAP: Record<string, {
  condition: string; benefit: string;
  minAtk?: number; minSpAtk?: number; moveType?: string;
}> = {
  solar_beam:   { condition: 'drought',      benefit: 'dispensa turno de carga',                         moveType: 'grass' },
  solar_blade:  { condition: 'drought',      benefit: 'dispensa turno de carga',   minAtk: 75,            moveType: 'grass' },
  synthesis:    { condition: 'drought',      benefit: 'recupera 2/3 HP (vs 1/2)' },
  morning_sun:  { condition: 'drought',      benefit: 'recupera 2/3 HP (vs 1/2)' },
  moonlight:    { condition: 'drought',      benefit: 'recupera 2/3 HP (vs 1/2)' },
  thunder:      { condition: 'drizzle',      benefit: '100% de precisão, 30% paralisia',                 moveType: 'electric' },
  hurricane:    { condition: 'drizzle',      benefit: '100% de precisão, 30% confusão',                  moveType: 'flying' },
  blizzard:     { condition: 'snow_warning', benefit: '100% de precisão',                                moveType: 'ice' },
  gyro_ball:    { condition: 'trick_room',   benefit: 'dano pelo diferencial de velocidade — mais forte quanto mais lento que o alvo', minAtk: 80, moveType: 'steel' },
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

// Support moves — what the Pokémon provides for the team, not what it does offensively
const SUPPORT_MOVE_MAP: Record<string, string> = {
  fake_out:     'flinch no 1° turno (prioridade +3) — garante 1 turno livre para o parceiro',
  parting_shot: 'reduz Atk e SpAtk adversário e troca de campo — pivot com debuff',
  u_turn:       'ataca e troca de campo — pivot seguro sem perder momentum',
  follow_me:    'redireciona todos os ataques direcionados para si — protege parceiro',
  rage_powder:  'redireciona todos os ataques direcionados para si — protege parceiro',
  spore:        '100% de sono — remove adversário do campo por vários turnos',
  sleep_powder: 'sono (75% precisão) — remove adversário do campo',
  trick_room:   'inverte ordem de velocidade por 5 turnos — beneficia Pokémon lentos',
  tailwind:     'dobra a velocidade do time por 4 turnos',
  helping_hand: '+50% no dano do parceiro nesse turno',
  encore:       'força adversário a repetir o último golpe por 3 turnos',
  taunt:        'bloqueia status e suporte adversário por 3 turnos',
  thunder_wave: 'paralisia — reduz Vel adversária a 25%, chance de imobilização',
  glare:        'paralisia (ignora imunidades Normais/Fantasmas) — Vel a 25%',
  nuzzle:       'paralisia garantida + dano leve — Vel a 25%',
  will_o_wisp:  'queimadura — corta Atk adversário à metade',
  reflect:      'corta dano físico à metade por 5 turnos (todo o time)',
  light_screen: 'corta dano especial à metade por 5 turnos (todo o time)',
};

// Support abilities — always-on field presence that helps the team
const SUPPORT_ABILITY_MAP: Record<string, string> = {
  intimidate:    'ao entrar: −1 Atk em todos adversários — reduz dano físico recebido pelo time',
  prankster:     '+1 prioridade em moves de status — Encore/Thunder Wave agem antes de qualquer ataque',
  regenerator:   'recupera 1/3 HP ao sair de campo — sustentabilidade como pivot',
  magic_bounce:  'reflete moves de status de volta ao adversário',
  unaware:       'ignora modificações de stats adversárias — counter de setup',
  drought:       'cria Sol intenso ao entrar — ativa habilidades como Chlorophyll/Solar Power',
  drizzle:       'cria Chuva pesada ao entrar — ativa habilidades como Swift Swim/Rain Dish',
  sand_stream:   'cria Tempestade de areia ao entrar — ativa Sand Rush/Sand Force',
  snow_warning:  'cria Neve ao entrar — ativa Slush Rush/Ice Body',
  psychic_surge: 'seta Psychic Terrain — bloqueia moves prioritários adversários, +30% em golpes Psíquicos',
  electric_surge:'seta Electric Terrain — bloqueia sono, +30% em golpes Elétricos no campo',
  grassy_surge:  'seta Grassy Terrain — recupera 1/8 HP/turno da equipe, +30% em golpes Planta',
  misty_surge:   'seta Misty Terrain — bloqueia status, reduz golpes Dragão à metade no campo',
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

// Passive always-on abilities that define the Pokémon's offensive identity
const PASSIVE_ABILITY_MAP: Record<string, { label: string; note: string }> = {
  aerilate:      { label: 'Aerilate',      note: 'golpes Normais tornam-se Voador (+30% poder, STAB para Voadores)' },
  pixilate:      { label: 'Pixilate',      note: 'golpes Normais tornam-se Fada (+30% poder, STAB para Fadas)' },
  refrigerate:   { label: 'Refrigerate',   note: 'golpes Normais tornam-se Gelo (+30% poder, STAB para Gelo)' },
  galvanize:     { label: 'Galvanize',     note: 'golpes Normais tornam-se Elétrico (+30% poder, STAB para Elétrico)' },
  parental_bond: { label: 'Parental Bond', note: 'golpes de alvo único acertam duas vezes (2ª pancada = 25% da 1ª) — golpes em área não recebem o segundo hit (Gen 8+), sempre prefira ataques de alvo único' },
  tough_claws:   { label: 'Tough Claws',   note: '+30% em golpes de contato físico' },
  sheer_force:   { label: 'Sheer Force',   note: '+30% em golpes com efeito secundário (remove o efeito secundário)' },
  adaptability:  { label: 'Adaptability',  note: 'STAB aumentado para ×2 (vs ×1.5 normal)' },
  libero:        { label: 'Libero',        note: 'muda de tipo para o golpe usado — STAB garantido em qualquer ataque' },
  protean:       { label: 'Protean',       note: 'muda de tipo para o golpe usado — STAB garantido em qualquer ataque' },
  mold_breaker:  { label: 'Mold Breaker',  note: 'ignora habilidades defensivas do alvo (ex: Levitate, Sturdy, Solid Rock)' },
  serene_grace:  { label: 'Serene Grace',  note: 'dobra a chance de efeitos secundários (ex: Air Slash 30% → 60% flinch, Thunder Wave via Togekiss mais confiável)' },
  speed_boost:   { label: 'Speed Boost',   note: '+1 Vel ao final de cada turno — cresce de ameaça a cada turno no campo' },
};

// Curated Portuguese notes for key VGC held items
const ITEM_NOTES_PT: Record<string, { note: string; icon: string }> = {
  choice_band:       { note: '+50% Atk, trava em 1 golpe por turno — maximiza dano físico',                          icon: '⚔' },
  choice_specs:      { note: '+50% SpAtk, trava em 1 golpe por turno — maximiza dano especial',                      icon: '⚔' },
  choice_scarf:      { note: '+50% Vel, trava em 1 golpe — resolve dead zone de velocidade',                         icon: '◆' },
  life_orb:          { note: '+30% dano em todos os golpes, custa 10% HP — máximo de dano sem lock',                 icon: '⚔' },
  focus_sash:        { note: 'Sobrevive qualquer KO com 1 HP (1 uso) — garante pelo menos 1 ação no campo',          icon: '◆' },
  sitrus_berry:      { note: 'Recupera 25% HP ao cair abaixo de 50% — mais turnos de ação no campo',                 icon: '🛡' },
  lum_berry:         { note: 'Cura qualquer status 1 vez — proteção contra sono, paralisia e queimadura',            icon: '◆' },
  mental_herb:       { note: 'Remove Taunt/Encore 1 vez — garante que moves de suporte funcionem',                   icon: '◆' },
  assault_vest:      { note: '+50% SpDef, sem status moves — pivot resistente a dano especial',                      icon: '🛡' },
  rocky_helmet:      { note: '16% dano ao atacante em golpes de contato — penaliza Fake Out e físicos adversários',  icon: '🛡' },
  weakness_policy:   { note: '+2 Atk e SpAtk ao levar golpe super efetivo — explosivo para Pokémon com bulk',        icon: '⚔' },
  safety_goggles:    { note: 'Imune a powder (Spore/Sleep Powder) e dano de granizo/areia',                          icon: '◆' },
  booster_energy:    { note: 'Ativa Protosynthesis/Hadron Engine sem condição de campo',                             icon: '◆' },
  leftovers:         { note: '1/16 HP recuperado por turno — sustentabilidade para pivots e tanques',                icon: '🛡' },
  eviolite:          { note: '+50% Def e SpDef para formas não finais — usado em NFEs competitivos',                 icon: '🛡' },
  wide_lens:         { note: '+10% precisão em todos os golpes — confiabilidade para Stone Edge / Thunder',           icon: '◆' },
  adrenaline_orb:    { note: 'Ativa quando atingido por Intimidate — +1 Vel imediato (1 uso)',                       icon: '◆' },
  clear_amulet:      { note: 'Bloqueia qualquer redução de stat por adversários — counter de Intimidate',            icon: '◆' },
  covert_cloak:      { note: 'Imune a efeitos secundários de golpes adversários (ex: flinch, queimadura)',           icon: '◆' },
};

// Common abilities not covered by the other maps — shown in competitive profile
const GENERIC_ABILITY_NOTES: Record<string, string> = {
  rough_skin:    '16% dano ao atacante em golpes de contato (passivo, sem item)',
  iron_barbs:    '16% dano ao atacante em golpes de contato (passivo, sem item)',
  magic_guard:   'imune a dano indireto — veneno, queimadura, granizo, areia, recoil',
  huge_power:    'dobra o Atk — stat efetivo equivale ao dobro do base',
  pure_power:    'dobra o Atk — stat efetivo equivale ao dobro do base',
  hustle:        '+50% Atk, mas −20% precisão em golpes físicos',
  no_guard:      '100% de precisão em todos os golpes (inclusive recebe com 100% também)',
  flash_fire:    'imune a Fogo — ao ser atingido: +50% poder Fire até trocar',
  levitate:      'imune a golpes Terra e Bulldoze',
  sand_veil:     '+20% evasão sob Tempestade de areia',
  sand_rush:     'Vel ×2 sob Tempestade de areia',
  blaze:         '+50% poder de Fogo ao cair abaixo de 1/3 HP',
  torrent:       '+50% poder de Água ao cair abaixo de 1/3 HP',
  overgrow:      '+50% poder de Planta ao cair abaixo de 1/3 HP',
  swarm:         '+50% poder de Inseto ao cair abaixo de 1/3 HP',
  super_luck:    '+50% de chance de crítico',
  overcoat:      'imune a powder, granizo e areia (não toma dano de clima)',
  natural_cure:  'cura status ao sair de campo — pivot com auto-cura',
  synchronize:   'repassa burn/paralisia/veneno ao atacante que infligiu o status',
  trace:         'copia a habilidade do oponente ao entrar em campo',
  sturdy:        'sobrevive qualquer OHKO com 1 HP se estiver em HP cheio',
  multiscale:    'reduz dano à metade se estiver em HP cheio',
  wonder_guard:  'só toma dano de golpes super efetivos',
  pickup:        'pode pegar itens do campo — útil em alguns formatos',
  stench:        '10% de flinch em qualquer golpe com contato',
  own_tempo:     'imune a confusão',
  inner_focus:   'imune a flinch',
  oblivious:     'imune a infatuação e Taunt',
  cloud_nine:    'neutraliza efeitos do clima enquanto em campo',
  air_lock:      'neutraliza efeitos do clima enquanto em campo',
  pressure:      'faz o adversário gastar PP em dobro',
  cursed_body:   '30% de chance de desativar o golpe usado contra si',
  fluffy:        'reduz dano de golpes de contato à metade, mas dobra dano de Fogo',
  fur_coat:      'dobra a Def (só Def física)',
  thick_fat:     'recebe metade do dano de Fogo e Gelo',
  water_absorb:  'imune a Água — recupera 25% HP ao ser atingido por Água',
  volt_absorb:   'imune a Elétrico — recupera 25% HP ao ser atingido por Elétrico',
  storm_drain:   'redireciona todos os ataques Água para si — imune, recupera SpAtk',
  lightning_rod: 'redireciona todos os ataques Elétrico para si — imune, recupera SpAtk',
  sap_sipper:    'imune a Planta — ao ser atingido por Planta: +1 Atk',
  motor_drive:   'imune a Elétrico — ao ser atingido: +1 Vel',
  justified:     'ao ser atingido por Sombrio: +1 Atk',
  rattled:       'ao ser atingido por Inseto/Fantasma/Sombrio ou Intimidate: +1 Vel',
};

// Moves whose base power is misleading: conditional, delayed, recharge, or self-KO
const STAB_MOVE_BLACKLIST = new Set([
  'dream_eater', 'future_sight', 'doom_desire', 'last_resort',
  'wring_out', 'crush_grip', 'stored_power', 'final_gambit',
  'giga_impact', 'hyper_beam', 'blast_burn', 'hydro_cannon', 'frenzy_plant',
  'roar_of_time', 'rock_wrecker', 'self_destruct', 'explosion',
]);

interface NeedsProfile {
  primaryCondition: string | null;
  abilityInsights: string[];
  moveInsights: string[];
  passiveInsights: string[];      // Always-on ability mechanics (Aerilate, Parental Bond, etc.)
  spreadMoves: string[];          // STAB spread moves the Pokémon has learned
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
  const passiveInsights: string[] = [];
  const moveInsightEntries: Array<{ text: string; condition: string }> = [];

  // Very slow Pokémon (speed ≤ 50) are inherently TR abusers — anchor trick_room at
  // priority 3 so it outranks weather conditions inferred from learnable moves (priority 2)
  if (p.baseStats.speed <= 50) {
    condPriority.set('trick_room', 3);
  }

  for (const abilityId of p.abilities) {
    const cond = ABILITY_CONDITION_MAP[abilityId];
    if (cond) {
      const priority = cond.speedMult ? 3 : cond.atkMult ? 2 : 1;
      condPriority.set(cond.condition, Math.max(condPriority.get(cond.condition) ?? 0, priority));
      let note = `${displayName(abilityId)} ativa com ${cond.label}`;
      if (cond.speedMult) note += ` → Vel ${p.baseStats.speed} → ${p.baseStats.speed * cond.speedMult}`;
      else if (cond.atkMult) note += ` → +50% Atq.Esp.`;
      abilityInsights.push(note);
    }
    const passive = PASSIVE_ABILITY_MAP[abilityId];
    if (passive) passiveInsights.push(`${passive.label} — ${passive.note}`);
  }

  for (const moveId of moveset) {
    const mc = MOVE_CONDITION_MAP[moveId];
    if (!mc) continue;
    if (mc.minAtk !== undefined && p.baseStats.attack < mc.minAtk) continue;
    if (mc.minSpAtk !== undefined && p.baseStats.special_attack < mc.minSpAtk) continue;

    // Relevance guard: only highlight when the Pokémon actually benefits from this condition
    const hasAbilityForCondition = p.abilities.some(
      (ab) => ABILITY_CONDITION_MAP[ab]?.condition === mc.condition
    );
    const hasStabForMove = !!(mc.moveType && p.types.includes(mc.moveType));
    // Slow TR abusers (speed ≤ 50) can legitimately use Gyro Ball even without a TR ability
    const isTrAbuser = mc.condition === 'trick_room' && p.baseStats.speed <= 50;
    // Self-setter: subject's own ability creates this condition (e.g. Charizard-Y + drought + Solar Beam)
    const selfSetsCondition = p.abilities.includes(mc.condition)
      && WEATHER_SETTERS[mc.condition] !== undefined;

    if (!hasAbilityForCondition && !hasStabForMove && !isTrAbuser && !selfSetsCondition) continue;

    condPriority.set(mc.condition, Math.max(condPriority.get(mc.condition) ?? 0, 2));
    const stabNote = mc.moveType && p.types.includes(mc.moveType) ? ' (STAB ×1.5)' : '';
    moveInsightEntries.push({
      text: `${displayName(moveId)}${stabNote} — ${mc.benefit} (requer ${CONDITION_LABELS[mc.condition] ?? mc.condition})`,
      condition: mc.condition,
    });
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

  // Spread moves — hits both opponents in doubles; particularly valuable with STAB
  // Physical spreads: earthquake, rock_slide, bulldoze, breaking_swipe, lunge
  // Special spreads: heat_wave, discharge, surf, muddy_water, blizzard, hyper_voice,
  //   boomburst, dazzling_gleam, snarl, icy_wind, electroweb, astral_barrage,
  //   eruption, water_spout, petal_blizzard, lava_plume
  const SPREAD_MOVES: Record<string, { type: string; cat: 'physical' | 'special'; label: string }> = {
    earthquake:       { type: 'ground',   cat: 'physical', label: 'atinge os dois inimigos (cuidado: acerta o parceiro também)' },
    rock_slide:       { type: 'rock',     cat: 'physical', label: 'atinge os dois inimigos, 30% flinch' },
    bulldoze:         { type: 'ground',   cat: 'physical', label: 'atinge os dois inimigos, −1 Vel em todos' },
    breaking_swipe:   { type: 'dragon',   cat: 'physical', label: 'atinge os dois inimigos, −1 Atk em todos' },
    heat_wave:        { type: 'fire',     cat: 'special',  label: 'atinge os dois inimigos' },
    discharge:        { type: 'electric', cat: 'special',  label: 'atinge os dois inimigos, 30% paralisia' },
    surf:             { type: 'water',    cat: 'special',  label: 'atinge os dois inimigos (inclui parceiro)' },
    muddy_water:      { type: 'water',    cat: 'special',  label: 'atinge os dois inimigos, 30% −Acc' },
    blizzard:         { type: 'ice',      cat: 'special',  label: 'atinge os dois inimigos' },
    hyper_voice:      { type: 'normal',   cat: 'special',  label: 'atinge os dois inimigos, ignora Substituição' },
    boomburst:        { type: 'normal',   cat: 'special',  label: 'atinge os dois inimigos com poder máximo' },
    dazzling_gleam:   { type: 'fairy',    cat: 'special',  label: 'atinge os dois inimigos' },
    snarl:            { type: 'dark',     cat: 'special',  label: 'atinge os dois inimigos, −1 SpAtk em todos' },
    icy_wind:         { type: 'ice',      cat: 'special',  label: 'atinge os dois inimigos, −1 Vel em todos' },
    electroweb:       { type: 'electric', cat: 'special',  label: 'atinge os dois inimigos, −1 Vel em todos' },
    astral_barrage:   { type: 'ghost',    cat: 'special',  label: 'atinge os dois inimigos' },
    eruption:         { type: 'fire',     cat: 'special',  label: 'atinge os dois inimigos (poder proporcional ao HP)' },
    water_spout:      { type: 'water',    cat: 'special',  label: 'atinge os dois inimigos (poder proporcional ao HP)' },
    petal_blizzard:   { type: 'grass',    cat: 'physical', label: 'atinge os dois inimigos' },
    lava_plume:       { type: 'fire',     cat: 'special',  label: 'atinge os dois inimigos, 30% queimadura' },
  };
  const spreadMoves: string[] = [];
  for (const moveId of moveset) {
    const sm = SPREAD_MOVES[moveId];
    if (!sm) continue;
    // Skip if the Pokémon's primary offense doesn't match the move category
    if (sm.cat === 'physical') {
      if (atkStat < 70) continue;
      if (spAtkStat > atkStat + 30) continue;  // heavily special-biased attacker
    }
    if (sm.cat === 'special') {
      const hasStabOnMove = p.types.includes(sm.type);
      if (hasStabOnMove) {
        if (spAtkStat < 70) continue;  // STAB special: standard threshold
      } else {
        if (spAtkStat < 90) continue;  // non-STAB special: needs high SpAtk to be worth noting
        if (atkStat > spAtkStat + 25) continue;  // non-STAB special: not heavily physical-biased
      }
    }
    const stabNote = p.types.includes(sm.type) ? ' (STAB ×1.5)' : '';
    spreadMoves.push(`${displayName(moveId)}${stabNote} — ${sm.label}`);
  }
  // Parental Bond (Gen 8+) does not apply to spread moves — single-target moves are strictly better
  if (p.abilities.includes('parental_bond')) spreadMoves.length = 0;

  // Only show move insights that match the primary condition — prevents Blizzard appearing
  // for a drizzle Pokémon just because it can learn blizzard, or gyro_ball on a TR abuser
  // that already has the TR condition anchored via ability.
  const moveInsights = moveInsightEntries
    .filter((e) => primaryCondition === null || e.condition === primaryCondition)
    .map((e) => e.text);

  return {
    primaryCondition, abilityInsights, moveInsights, passiveInsights, spreadMoves,
    speedUnderCondition, hasCriticalNeed, setupMoves, frailtyLevel, statusAbilityInsights,
  };
}

// Returns top held item suggestions for a Pokémon with VGC-aware heuristic scoring
function getTopHeldItems(
  p: PokemonContext,
  moveset: Set<string>,
  isSupport: boolean,
  inSpeedDeadZone: boolean,
  engine: DeterministicEngine,
  limit = 3
): Array<{ item_id: string; note: string; icon: string }> {
  const { attack, special_attack: spAtk, speed, hp, defense: def, special_defense: spDef } = p.baseStats;
  const mainOff = Math.max(attack, spAtk);
  const offBias = attack > spAtk + 25 ? 'physical' : spAtk > attack + 25 ? 'special' : 'mixed';
  const needsTR = speed <= 50;
  const avgBulk = (hp * (def + spDef)) / 200;
  const isFrail = avgBulk < 35;
  const hasRedirection = moveset.has('follow_me') || moveset.has('rage_powder');
  const hasTrickRoom = moveset.has('trick_room');
  const hasPivot = moveset.has('u_turn') || moveset.has('parting_shot');
  const hasIntimidateAbility = p.abilities.includes('intimidate');
  const isParadox = p.abilities.includes('protosynthesis') || p.abilities.includes('hadron_engine');

  type HRow = { item_id: string; category: string; confidence: number; model_json: string };
  const allItems = engine.queryAll<HRow>(
    'SELECT item_id, category, confidence, model_json FROM held_item_effects WHERE confidence >= 0.70 ORDER BY confidence DESC'
  );

  const scored = allItems
    .filter((item) => item.item_id in ITEM_NOTES_PT && item.category !== 'non_combat')
    .map((item) => {
      let score = item.confidence * 30;
      let model: string[];
      try { model = JSON.parse(item.model_json) as string[]; } catch { model = []; }
      const hasFeat = (s: string) => model.some((m) => m.includes(s));

      switch (item.item_id) {
        case 'choice_band':
          if (offBias === 'physical' && !isSupport) score += 60;
          if (attack >= 120) score += 15;
          if (isSupport || moveset.has('fake_out')) score -= 80;
          break;
        case 'choice_specs':
          if (offBias === 'special' && !isSupport) score += 60;
          if (spAtk >= 120) score += 15;
          if (isSupport || moveset.has('fake_out')) score -= 80;
          break;
        case 'choice_scarf':
          if (inSpeedDeadZone && !needsTR) score += 75;
          else if (speed >= 100) score += 5;
          if (needsTR) score -= 100;
          if (isSupport && !moveset.has('fake_out')) score -= 40;
          if (hasRedirection) score -= 60;   // redirectors lose move flexibility with lock-in
          if (moveset.has('fake_out')) score -= 40;  // Fake Out users prefer flexible items
          break;
        case 'life_orb':
          if (mainOff >= 100 && !isSupport) score += 55;
          if (mainOff >= 120) score += 15;
          if (isSupport) score -= 55;
          break;
        case 'focus_sash':
          if (isFrail) score += 55;
          else if (hp <= 70) score += 30;
          if (isSupport && (hasRedirection || hasTrickRoom)) score += 30;
          break;
        case 'sitrus_berry':
          if (hp >= 80) score += 40;
          if (isSupport) score += 25;
          break;
        case 'lum_berry':
          score += 20;
          break;
        case 'mental_herb':
          if (isSupport) score += 85;
          if (hasRedirection || hasTrickRoom) score += 25;
          break;
        case 'assault_vest':
          if (!isSupport && hasPivot) score += 40;
          if (spDef <= 80 && mainOff >= 90) score += 20;
          if (isSupport) score -= 25;  // can't use support moves with AV
          break;
        case 'rocky_helmet':
          if (hasIntimidateAbility) score += 50;
          if (hp >= 80 && def >= 70) score += 25;
          break;
        case 'weakness_policy':
          if (avgBulk >= 50 && mainOff >= 90 && !isSupport) score += 55;
          if (p.abilities.includes('sturdy')) score += 25;
          break;
        case 'safety_goggles':
          score += 20;
          break;
        case 'booster_energy':
          score += isParadox ? 150 : -150;
          break;
        case 'leftovers':
          if (isSupport && avgBulk >= 45) score += 35;       // support tanks benefit from passive regen
          else if (!isSupport && avgBulk >= 70 && speed <= 80) score += 25;  // slow bulky attackers only
          break;
        case 'adrenaline_orb':
          if (hasIntimidateAbility) score -= 20;  // the wearer gets Intimidated, not the partner
          score += inSpeedDeadZone ? 25 : 10;
          break;
        case 'clear_amulet':
          score += 15;
          break;
        case 'covert_cloak':
          score += 15;
          break;
      }

      for (const t of p.types) {
        if (hasFeat(`type_hint-${t}`)) score += 6;
      }
      if (offBias === 'physical' && hasFeat('stat_target-attack')) score += 8;
      if (offBias === 'special' && hasFeat('stat_target-special_attack')) score += 8;

      const { note, icon } = ITEM_NOTES_PT[item.item_id]!;
      return { item_id: item.item_id, note, icon, score };
    });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

async function handlePairSynergy(idA: string, idB: string, engine: DeterministicEngine): Promise<string> {
  const a = engine.getPokemonContext(idA);
  const b = engine.getPokemonContext(idB);
  if (!a) return `Bot: ${displayName(idA)} não encontrado.`;
  if (!b) return `Bot: ${displayName(idB)} não encontrado.`;

  type MRow = { move_id: string };
  const movesA = new Set(engine.queryAll<MRow>('SELECT DISTINCT move_id FROM pokemon_moves WHERE pokemon_identifier = ?', [idA]).map((r) => r.move_id));
  const movesB = new Set(engine.queryAll<MRow>('SELECT DISTINCT move_id FROM pokemon_moves WHERE pokemon_identifier = ?', [idB]).map((r) => r.move_id));

  const nameA = displayName(idA), nameB = displayName(idB);

  function pairRoleDisplay(p: PokemonContext, moves: Set<string>): string {
    const mainOff = Math.max(p.baseStats.attack, p.baseStats.special_attack);
    const hasFO = moves.has('fake_out');
    const hasRedir = moves.has('follow_me') || moves.has('rage_powder');
    const hasIntimidate = p.abilities.includes('intimidate');
    const weatherAb = p.abilities.find((ab) => ab in WEATHER_SETTERS);
    if (hasFO && hasIntimidate) return 'Suporte — Fake Out + Intimidate (enabler de campo)';
    if (hasRedir) return 'Suporte — Redireção (protege parceiro de ataques direcionados)';
    if (hasFO) return 'Speed Control / Pivot — enabler';
    if (weatherAb && mainOff < 100) return `Setter de ${WEATHER_SETTERS[weatherAb]} / Suporte`;
    return classifyCompRole(p);
  }

  const roleA = pairRoleDisplay(a, movesA), roleB = pairRoleDisplay(b, movesB);

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

  // ── NN overall synergy score ─────────────────────────────────────────────────
  {
    const features = buildFeatureVector(a, b);
    const nn = await queryNN(features); // returns 0.5 fallback if NN not yet ready
    const nnLabel = nn >= 0.75 ? 'Excelente' : nn >= 0.55 ? 'Boa' : nn >= 0.40 ? 'Moderada' : 'Fraca';
    lines.push('');
    lines.push(`Sinergia NN: ${nnLabel} (${(nn * 10).toFixed(1)}/10)`);
  }

  // ── Held item recommendations for the pair ──────────────────────────────────
  const isSupportA = movesA.has('fake_out') || movesA.has('follow_me') || movesA.has('rage_powder')
    || (a.abilities.includes('intimidate') && Math.max(a.baseStats.attack, a.baseStats.special_attack) < 85);
  const isSupportB = movesB.has('fake_out') || movesB.has('follow_me') || movesB.has('rage_powder')
    || (b.abilities.includes('intimidate') && Math.max(b.baseStats.attack, b.baseStats.special_attack) < 85);
  const deadA = speedA > 50 && speedA <= 90;
  const deadB = speedB > 50 && speedB <= 90;
  const itemsA = getTopHeldItems(a, movesA, isSupportA, deadA, engine, 2);
  const itemsB = getTopHeldItems(b, movesB, isSupportB, deadB, engine, 2);
  if (itemsA.length > 0 || itemsB.length > 0) {
    lines.push('');
    lines.push('Held items sugeridos para a dupla:');
    itemsA.forEach((i) => lines.push(`  ${nameA} → ${i.icon} ${displayName(i.item_id)} — ${i.note}`));
    itemsB.forEach((i) => lines.push(`  ${nameB} → ${i.icon} ${displayName(i.item_id)} — ${i.note}`));
  }

  return lines.join('\n');
}

async function handleSynergySuggestions(identifier: string, engine: DeterministicEngine): Promise<string> {
  const p = engine.getPokemonContext(identifier);
  if (!p) return `Bot: Pokémon "${displayName(identifier)}" não encontrado.`;

  const name = displayName(identifier);
  const { attack, special_attack: spAtk, speed } = p.baseStats;
  const mainOff = Math.max(attack, spAtk);
  const needsTR = speed <= 50;
  const isAttacker = mainOff >= 85 && (speed >= 60 || needsTR);
  // Speed dead zone: base speed 51–90 — too fast for TR naturally, too slow for Tailwind without help.
  // Options: Tailwind (doubles to 102–180, viable attacker) OR paralysis (halves to 25–45, TR viable).
  const inSpeedDeadZone = speed > 50 && speed <= 90;
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

  // True when the subject itself has a weather-setting ability — skip setter partner list/scoring
  const isSelfSetter = needs.primaryCondition !== null
    && p.abilities.includes(needs.primaryCondition)
    && WEATHER_SETTERS[needs.primaryCondition] !== undefined;

  // Detect weather setter ability independently of primaryCondition (e.g. Torkoal has drought
  // but primaryCondition anchors to trick_room due to low speed — isSelfSetter would be false)
  const selfWeatherSetterAbility = p.abilities.find((ab) => ab in WEATHER_SETTERS);

  // ── Support identity detection ─────────────────────────────────────────────
  const hasFakeOut = moveset.has('fake_out');
  const hasRedirection = moveset.has('follow_me') || moveset.has('rage_powder');
  const hasIntimidateAbility = p.abilities.includes('intimidate');
  const isSupport = hasFakeOut || hasRedirection
    || (selfWeatherSetterAbility !== undefined && mainOff < 100)  // pure weather setter
    || (hasIntimidateAbility && !isAttacker);

  // Override role label for support archetypes
  let roleDisplay = classifyCompRole(p);
  if (hasFakeOut && hasIntimidateAbility) {
    roleDisplay = 'Suporte — Fake Out + Intimidate (enabler de campo)';
  } else if (hasRedirection) {
    roleDisplay = 'Suporte — Redireção (protege parceiro de ataques direcionados)';
  } else if (hasFakeOut) {
    roleDisplay = 'Speed Control / Pivot — enabler';
  } else if (selfWeatherSetterAbility && mainOff < 100) {
    roleDisplay = `Setter de ${WEATHER_SETTERS[selfWeatherSetterAbility]} / Suporte`;
  }

  // Best STAB attacking moves — gives context for partner suggestions (terrain, etc.)
  // Only shown for attackers; filters by offensive category bias
  const offBias = attack > spAtk + 25 ? 'physical' : spAtk > attack + 25 ? 'special' : null;
  const TERRAIN_BOOST_LABEL: Record<string, string> = {
    psychic: '+30% sob Psychic Terrain', electric: '+30% sob Electric Terrain',
    grass: '+30% sob Grassy Terrain',
  };
  // (STAB_MOVE_BLACKLIST is defined at module level)
  type StabMRow = { id: string; base_power: number; category: string };
  const primaryStabMoves: string[] = [];
  if (isAttacker) {
    for (const stabType of p.types) {
      const catClause = offBias === 'physical' ? `m.category = 'physical'`
        : offBias === 'special' ? `m.category = 'special'`
        : `m.category IN ('physical', 'special')`;
      const best = engine.queryAll<StabMRow>(
        `SELECT m.id, m.base_power, m.category
         FROM moves m JOIN pokemon_moves pm ON m.id = pm.move_id
         WHERE pm.pokemon_identifier = ? AND m.type_id = ?
           AND ${catClause} AND m.base_power >= 60
         ORDER BY m.base_power DESC LIMIT 5`,
        [identifier, stabType]
      ).filter((m) => !STAB_MOVE_BLACKLIST.has(m.id)).slice(0, 2);
      for (const m of best) {
        const catTag = m.category === 'physical' ? 'fís.' : 'esp.';
        const terrain = TERRAIN_BOOST_LABEL[stabType] ?? null;
        const terrainNote = terrain ? ` — ${terrain}` : '';
        primaryStabMoves.push(`${displayName(m.id)} (${m.base_power} BP, ${catTag}, STAB ×1.5${terrainNote})`);
      }
    }
  }

  const sections: string[] = [
    `Bot: ── Parceiros competitivos para ${name} (${types}) ──`,
    `Papel: ${roleDisplay}`,
    '',
  ];

  // Passive ability highlights — always-on mechanics that define the Pokémon's identity
  if (needs.passiveInsights.length > 0) {
    needs.passiveInsights.forEach((i) => sections.push(`Mecânica: ${i}`));
    sections.push('');
  }

  // Support identity section — what this Pokémon PROVIDES to the team
  if (isSupport) {
    const supportLines: string[] = [];
    // Ability-based support (cap at most relevant)
    for (const ab of p.abilities) {
      const sa = SUPPORT_ABILITY_MAP[ab];
      if (sa) supportLines.push(`  ⚡ ${displayName(ab)} — ${sa}`);
    }
    // Move-based support (priority ordered: redirection, fake_out, sleep, tailwind, etc.)
    const SUPPORT_PRIORITY = [
      'follow_me', 'rage_powder', 'fake_out', 'spore', 'sleep_powder', 'trick_room',
      'tailwind', 'parting_shot', 'encore', 'will_o_wisp', 'thunder_wave',
      'glare', 'nuzzle', 'helping_hand', 'u_turn', 'reflect', 'light_screen', 'taunt',
    ];
    for (const moveId of SUPPORT_PRIORITY) {
      if (!moveset.has(moveId)) continue;
      const sm = SUPPORT_MOVE_MAP[moveId];
      if (sm) supportLines.push(`  ⚡ ${displayName(moveId)} — ${sm}`);
    }
    if (supportLines.length > 0) {
      sections.push(`Suporte oferecido por ${name}:`);
      supportLines.forEach((l) => sections.push(l));
      sections.push('');
    }
  }

  // 0. Needs analysis — what this Pokémon requires to be a real competitive threat
  const hasAnyNeed = needs.abilityInsights.length > 0 || needs.moveInsights.length > 0
    || (!isSupport && needs.setupMoves.length > 0)  // hide setup moves for pure supports
    || needs.frailtyLevel !== 'none'
    || needs.statusAbilityInsights.length > 0;

  if (hasAnyNeed) {
    sections.push(`Para ${name} alcançar seu potencial, precisa de:`);

    // Weather/condition dependencies
    needs.abilityInsights.forEach((i) => sections.push(`  ⚡ ${i}`));
    needs.moveInsights.forEach((i) => sections.push(`  ⚡ ${i}`));
    if (needs.hasCriticalNeed) {
      sections.push(`  ⚠ Sem essa condição: Vel ${p.baseStats.speed} é lenta demais para Tailwind e rápida demais para Trick Room`);
    } else if (inSpeedDeadZone) {
      sections.push(`  ⚠ Vel ${speed} — zona ambígua: Tailwind → ${speed * 2} (attacker rápido) | paralisia → ~${Math.round(speed / 2)} (viável sob Trick Room)`);
    }

    // Setup moves — skip for pure support Pokémon (not their primary game plan)
    if (!isSupport && needs.setupMoves.length > 0) {
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

    // Spread moves — always-available damage that hits both opponents
    if (needs.spreadMoves.length > 0) {
      sections.push(`  ◆ Golpes em área (afetam os dois inimigos):`);
      needs.spreadMoves.forEach((sm) => sections.push(`    • ${sm}`));
    }

    // Primary STAB offensive moves — context for why terrain/support partners matter
    if (primaryStabMoves.length > 0) {
      sections.push(`  ◆ Ofensiva STAB principal:`);
      primaryStabMoves.forEach((m) => sections.push(`    • ${m}`));
    }

    sections.push('');

    // Show primary condition setters as the most important partner type
    if (needs.primaryCondition && WEATHER_SETTERS[needs.primaryCondition] !== undefined) {
      const condLabel = CONDITION_LABELS[needs.primaryCondition];
      if (isSelfSetter) {
        sections.push(`  ✦ Cria ${condLabel} automaticamente via ${displayName(needs.primaryCondition)} — não precisa de setter parceiro`);
        sections.push('');
      } else {
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
  }

  // ── Held item recommendations ──────────────────────────────────────────────
  const topItems = getTopHeldItems(p, moveset, isSupport, inSpeedDeadZone, engine, 3);
  if (topItems.length > 0) {
    sections.push(`Held items sugeridos para ${name}:`);
    topItems.forEach((item) =>
      sections.push(`  ${item.icon} ${displayName(item.item_id)} — ${item.note}`)
    );
    sections.push('');
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
  // Skip when the subject already sets the weather itself
  if (needs.primaryCondition && WEATHER_SETTERS[needs.primaryCondition] !== undefined && !isSelfSetter) {
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

  // Trick Room setters (critical for slow Pokémon) — weighted by setter bulk.
  // Bulkier setters have a higher chance of surviving turn 1 to actually use TR.
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
     .forEach((r) => {
       const cp = engine.getPokemonContext(r.identifier);
       let trScore = 40;
       let survivalNote = '';
       if (cp) {
         const { hp, defense: def, special_defense: spDef } = cp.baseStats;
         const avgBulk = hp * (def + spDef) / 200; // ~0–150 for standard Pokémon
         // Bonus: 0 (avgBulk≤25) → +25 (avgBulk≥150). Ensures bulky setters outscore frail ones.
         trScore = 40 + Math.min(25, Math.round(avgBulk / 6));
         if (avgBulk >= 80) survivalNote = ' — bulk alto, alta chance de sobreviver para setar';
         else if (avgBulk < 30) survivalNote = ' — frágil, pode precisar de proteção para setar';
       }
       addScore(r.identifier, r.types, trScore,
         `seta Trick Room → ${name} age primeiro (Vel base ${p.baseStats.speed})${survivalNote}`);
     });
  }

  // Tailwind — speed support for non-TR teams.
  // Dead-zone Pokémon (Vel 51–90) benefit most: Tailwind takes them from awkward to fast.
  if (!needsTR) {
    const tailwindScore = inSpeedDeadZone ? 25 : 15;
    const tailwindNote = inSpeedDeadZone
      ? `seta Tailwind → Vel ${speed} × 2 = ${speed * 2} (zona morta → attacker rápido)`
      : `seta Tailwind → dobra a velocidade de ${name} por 3 turnos`;
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
     .forEach((r) => addScore(r.identifier, r.types, tailwindScore, tailwindNote));
  }

  // Paralysis partners for dead-zone Pokémon — halving speed enables TR viability.
  // A Pokémon at Vel 51–90 becomes Vel 25–45 under paralysis, acting first under TR.
  if (inSpeedDeadZone && isAttacker) {
    const paraSpeed = Math.round(speed / 2);
    engine.queryAll<SRow>(
      `SELECT DISTINCT p.identifier, GROUP_CONCAT(pt.type_id, '/') AS types
       FROM pokemon p JOIN pokemon_moves pm ON pm.pokemon_identifier = p.identifier
       JOIN pokemon_types pt ON p.id = pt.pokemon_id
       WHERE pm.move_id IN ('thunder_wave', 'glare', 'nuzzle')
         AND p.identifier != ?
         ${FULLY_EVOLVED_SQL}
       GROUP BY p.id LIMIT 300`,
      [identifier]
    ).filter((r) => !isNfe(r.identifier) && notOwnMega(r))
     .forEach((r) => addScore(r.identifier, r.types, 18,
       `paralisa o aliado: Vel ${speed} → ~${paraSpeed} — ${name} viável sob Trick Room`));
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
       // Trick Room is priority -7; Prankster makes it -6 — still AFTER all regular attacks.
       // Prankster's real value for TR teams is on OTHER status moves (Encore, etc.) that
       // lock or disrupt opponents BEFORE they can attack, protecting the TR setup window.
       `Prankster → Encore/suporte com +1 prioridade (age antes dos ataques, protege setup de TR)`));
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
     .forEach((r) => addScore(r.identifier, r.types, 50,
       `beneficiado pelo ${weatherLabel} criado por ${name} (stats/velocidade dobram)`));
  }

  // Fake Out support — find powerful attackers that need a free first turn
  if (hasFakeOut) {
    engine.queryAll<SRow>(
      `SELECT p2.identifier,
              (SELECT GROUP_CONCAT(type_id, '/') FROM pokemon_types WHERE pokemon_id = p2.id ORDER BY slot) AS types
       FROM pokemon p2
       WHERE p2.id NOT IN (SELECT DISTINCT from_id FROM pokemon_evolution)
         AND p2.identifier != ?
         AND p2.id IN (
           SELECT pokemon_id FROM pokemon_stats WHERE stat_id = 'attack'    AND value >= 115
           UNION
           SELECT pokemon_id FROM pokemon_stats WHERE stat_id = 'special_attack' AND value >= 115
         )
         AND p2.id IN (
           SELECT pokemon_id FROM pokemon_stats WHERE stat_id = 'speed' AND value >= 70
         )
       LIMIT 300`,
      [identifier]
    ).filter((r) => !isNfe(r.identifier) && notOwnMega(r))
     .forEach((r) => addScore(r.identifier, r.types, 35,
       `Fake Out → garante 1° turno livre para ${displayName(r.identifier)} atacar sem resposta`));
  }

  // Intimidate support — physical attackers protect the team against enemy physical threats
  if (hasIntimidateAbility) {
    engine.queryAll<SRow>(
      `SELECT p2.identifier,
              (SELECT GROUP_CONCAT(type_id, '/') FROM pokemon_types WHERE pokemon_id = p2.id ORDER BY slot) AS types
       FROM pokemon p2
       WHERE p2.id NOT IN (SELECT DISTINCT from_id FROM pokemon_evolution)
         AND p2.identifier != ?
         AND p2.id IN (
           SELECT pokemon_id FROM pokemon_stats WHERE stat_id = 'attack' AND value >= 110
         )
       LIMIT 300`,
      [identifier]
    ).filter((r) => !isNfe(r.identifier) && notOwnMega(r))
     .forEach((r) => addScore(r.identifier, r.types, 20,
       `Intimidate de ${name} → campo físico mais seguro para ${displayName(r.identifier)} atacar`));
  }

  // Redirection support — frail attackers most benefit from Rage Powder / Follow Me
  if (hasRedirection) {
    engine.queryAll<SRow>(
      `SELECT p2.identifier,
              (SELECT GROUP_CONCAT(type_id, '/') FROM pokemon_types WHERE pokemon_id = p2.id ORDER BY slot) AS types
       FROM pokemon p2
       WHERE p2.id NOT IN (SELECT DISTINCT from_id FROM pokemon_evolution)
         AND p2.identifier != ?
         AND p2.id IN (
           SELECT pokemon_id FROM pokemon_stats WHERE stat_id = 'attack'    AND value >= 115
           UNION
           SELECT pokemon_id FROM pokemon_stats WHERE stat_id = 'special_attack' AND value >= 115
         )
         AND p2.id IN (
           SELECT pokemon_id FROM pokemon_stats WHERE stat_id = 'hp' AND value < 80
         )
       LIMIT 300`,
      [identifier]
    ).filter((r) => !isNfe(r.identifier) && notOwnMega(r))
     .forEach((r) => addScore(r.identifier, r.types, 40,
       `Redireção de ${name} → ${displayName(r.identifier)} ataca sem ser alvo (frágil, precisa de cobertura)`));
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

  // ── NN synergy blend — adjust heuristic scores with learned signal ─────────
  if (nnReady) {
    await Promise.all([...candidates.entries()].map(async ([id, c]) => {
      const cp = engine.getPokemonContext(id);
      if (!cp) return;
      const features = buildFeatureVector(p, cp);
      const nn = await queryNN(features);
      c.score += (nn - 0.5) * 60; // ±30 pts
    }));
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

        sections.push(`   Vel: ${tier} | ${speedNote}`);
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
// Quiz / Didactic module
// ---------------------------------------------------------------------------

interface QuizSession {
  type: 'type_eff' | 'move_type' | 'pokemon_stats' | 'speed_ctrl';
  variant?: 'weakness' | 'resistance' | 'immunity'; // only for type_eff
  difficulty: 1 | 2 | 3;
  question: string;
  answer: string;        // lowercase, for comparison (pipe-separated for type_eff)
  answerDisplay: string; // formatted for display after reveal
  choices: string[];     // 4 display labels for multiple-choice [A, B, C, D]
  correctChoice: string; // 'A' | 'B' | 'C' | 'D'
  score: number;
  total: number;
  streak: number;
  asked: Set<string>;    // keys asked so far — avoid repeats
}

let quizSession: QuizSession | null = null;
let pendingQuizType: QuizSession['type'] | null = null; // set while waiting for difficulty choice

const ALL_TYPES = ['normal','fire','water','electric','grass','ice','fighting','poison','ground','flying','psychic','bug','rock','ghost','dragon','dark','steel','fairy'];

// Reverse map: PT label (lowercase) → EN id
const TYPE_PT_TO_EN: Record<string, string> = {};
for (const [en, pt] of Object.entries(TYPE_LABELS)) TYPE_PT_TO_EN[pt.toLowerCase()] = en;

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Removes parenthetical hints from choice text (used at medium/hard difficulty)
function stripHint(s: string): string {
  return s.replace(/\s*\(.*?\)\s*$/, '').trim();
}

// ---------------------------------------------------------------------------
// Quiz lobby and difficulty selection
// ---------------------------------------------------------------------------
function handleQuizLobby(): string {
  return [
    'Bot: ── Modo Quiz ──',
    'Escolha o tipo de quiz:',
    '[[QUIZ_MENU]]',
    'quiz tipos',
    'quiz golpes',
    'quiz pokemon',
    'quiz velocidade',
    '[[/QUIZ_MENU]]',
  ].join('\n');
}

function handleDifficultySelect(type: QuizSession['type']): string {
  pendingQuizType = type;
  const typeLabel: Record<QuizSession['type'], string> = {
    type_eff: 'Tipos', move_type: 'Golpes', pokemon_stats: 'Pokémon', speed_ctrl: 'Speed Control',
  };
  return [
    `Bot: ── Quiz ${typeLabel[type]} — Escolha a dificuldade ──`,
    '[[QUIZ_MENU]]',
    'fácil',
    'médio',
    'difícil',
    '[[/QUIZ_MENU]]',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Speed Control trivia questions
// ---------------------------------------------------------------------------
interface TriviaItem {
  key: string;
  question: string;
  correctAnswer: string;
  answerDisplay: string;
  wrongOptions: [string, string, string];
}

const SPEED_CTRL_QUESTIONS: TriviaItem[] = [
  {
    key: 'tailwind_turns',
    question: 'Quantos turnos dura o Tailwind (incluindo o turno de ativação)?',
    correctAnswer: '4 turnos',
    answerDisplay: 'Tailwind dura 4 turnos totais — incluindo o turno em que foi usado. Os aliados em campo têm a velocidade dobrada durante esse período.',
    wrongOptions: ['3 turnos', '5 turnos', '2 turnos'],
  },
  {
    key: 'tailwind_mult',
    question: 'Por quanto o Tailwind multiplica a velocidade dos aliados?',
    correctAnswer: '×2 (dobra)',
    answerDisplay: 'Tailwind dobra (×2) a velocidade de todos os aliados ativos por 4 turnos. Um Pokémon com Speed 80 passa a agir como se tivesse Speed 160.',
    wrongOptions: ['×1.5', '×3', '×1.3'],
  },
  {
    key: 'trick_room_turns',
    question: 'Quantos turnos dura o Trick Room?',
    correctAnswer: '5 turnos',
    answerDisplay: 'Trick Room dura 5 turnos (incluindo o turno de ativação). Pode ser cancelado antecipadamente re-usando o movimento antes de expirar.',
    wrongOptions: ['4 turnos', '3 turnos', '6 turnos'],
  },
  {
    key: 'trick_room_benefits',
    question: 'No Trick Room, qual Pokémon age primeiro (mesmo bracket de prioridade)?',
    correctAnswer: 'O Pokémon mais LENTO',
    answerDisplay: 'Trick Room reverte a ordem por velocidade: o mais lento age primeiro. Em empate, o que tiver MENOR speed base tem prioridade (tie-break invertido).',
    wrongOptions: ['O Pokémon mais rápido', 'O de maior nível', 'O que atacou por último'],
  },
  {
    key: 'protect_priority',
    question: 'Qual é a prioridade do Protect?',
    correctAnswer: '+4',
    answerDisplay: 'Protect tem prioridade +4 — age antes de Fake Out (+3), Extreme Speed (+2) e Quick Attack (+1). Permite bloquear Fake Out ao custo de um turno.',
    wrongOptions: ['+3', '+2', '+1'],
  },
  {
    key: 'fake_out_priority',
    question: 'Qual é a prioridade do Fake Out?',
    correctAnswer: '+3',
    answerDisplay: 'Fake Out tem prioridade +3 — age após Protect (+4) mas antes de Extreme Speed (+2) e Quick Attack (+1). Causa flinch garantido no primeiro turno do Pokémon.',
    wrongOptions: ['+1', '+2', '+4'],
  },
  {
    key: 'extreme_speed_priority',
    question: 'Qual é a prioridade do Extreme Speed?',
    correctAnswer: '+2',
    answerDisplay: 'Extreme Speed tem prioridade +2. Age antes de Quick Attack (+1) mas depois de Fake Out (+3). Disponível em Pokémon como Arcanine e Dragonite.',
    wrongOptions: ['+1', '+3', '+4'],
  },
  {
    key: 'quick_attack_priority',
    question: 'Qual é a prioridade do Quick Attack / Ataque Rápido?',
    correctAnswer: '+1',
    answerDisplay: 'Quick Attack tem prioridade +1. Mesma prioridade de Aqua Jet, Ice Shard, Bullet Punch, Mach Punch, Shadow Sneak e First Impression.',
    wrongOptions: ['+2', '+3', '0'],
  },
  {
    key: 'trick_room_priority',
    question: 'Qual é a prioridade do Trick Room?',
    correctAnswer: '-7 (age por último)',
    answerDisplay: 'Trick Room tem prioridade -7 — é um dos moves mais lentos do jogo. Um Fake Out (+3) sempre age antes. Por isso é comum proteger o setter de Trick Room.',
    wrongOptions: ['0 (normal)', '-1', '+1'],
  },
  {
    key: 'swift_swim',
    question: 'Qual habilidade dobra a velocidade sob chuva?',
    correctAnswer: 'Swift Swim (Nado Veloz)',
    answerDisplay: 'Swift Swim dobra a velocidade enquanto a chuva está ativa. Pokémon com essa habilidade no VGC: Ludicolo, Kingdra, Barraskewda, Floatzel.',
    wrongOptions: ['Drizzle (ativa a chuva)', 'Rain Dish (recupera HP)', 'Hydration (cura status)'],
  },
  {
    key: 'chlorophyll',
    question: 'Qual habilidade dobra a velocidade sob sol intenso?',
    correctAnswer: 'Chlorophyll (Clorofila)',
    answerDisplay: 'Chlorophyll dobra a velocidade sob sol intenso. Pokémon com essa habilidade: Venusaur, Lilligant, Jumpluff, Victreebel.',
    wrongOptions: ['Drought (ativa o sol)', 'Solar Power (+SpAtk no sol)', 'Leaf Guard (cura status no sol)'],
  },
  {
    key: 'sand_rush',
    question: 'Qual habilidade dobra a velocidade em tempestade de areia?',
    correctAnswer: 'Sand Rush',
    answerDisplay: 'Sand Rush dobra a velocidade e protege o usuário do dano da areia. Pokémon: Excadrill (dominante no VGC), Sandslash de Alola.',
    wrongOptions: ['Sand Stream (ativa a areia)', 'Sand Force (+dano de moves)', 'Sand Veil (+evasão na areia)'],
  },
  {
    key: 'slush_rush',
    question: 'Qual habilidade dobra a velocidade em granizo/nevasca?',
    correctAnswer: 'Slush Rush',
    answerDisplay: 'Slush Rush dobra a velocidade em granizo (Hail) ou nevasca (Snow, Gen 9+). Pokémon: Sandslash de Alola, Beartic.',
    wrongOptions: ['Snow Warning (ativa granizo)', 'Snow Cloak (+evasão)', 'Ice Body (recupera HP no granizo)'],
  },
  {
    key: 'surge_surfer',
    question: 'Qual habilidade dobra a velocidade em Electric Terrain?',
    correctAnswer: 'Surge Surfer',
    answerDisplay: 'Surge Surfer (exclusivo do Raichu de Alola) dobra a velocidade quando Electric Terrain está ativo no campo.',
    wrongOptions: ['Electric Surge (ativa Electric Terrain)', 'Hadron Engine (Miraidon)', 'Lightning Rod (atrai moves Elétricos)'],
  },
  {
    key: 'icy_wind_effect',
    question: 'Além de dano (tipo Gelo), o que o Icy Wind faz?',
    correctAnswer: 'Reduz Speed −1 em ambos os inimigos',
    answerDisplay: 'Icy Wind é spread move (Base Power 55) que reduz a velocidade em 1 estágio (−1 Speed) dos dois inimigos. Essencial em equipes de speed control.',
    wrongOptions: ['Causa congelamento', 'Reduz Defesa Especial', 'Tem prioridade +1'],
  },
  {
    key: 'bulldoze_effect',
    question: 'Além de dano (tipo Terra), o que o Bulldoze faz?',
    correctAnswer: 'Reduz Speed −1 em ambos os inimigos',
    answerDisplay: 'Bulldoze (Base Power 60, tipo Terra) atinge os dois inimigos e reduz cada um em −1 Speed. Bonus: remove Electric Terrain caso esteja ativo.',
    wrongOptions: ['Aumenta Defesa do usuário', 'Causa status burn', 'Reduz Ataque Especial'],
  },
  {
    key: 'string_shot_effect',
    question: 'Quanto String Shot reduz a Velocidade?',
    correctAnswer: '−2 Speed em ambos os inimigos (sem dano)',
    answerDisplay: 'String Shot é move de status (sem dano) que reduz −2 Speed dos dois inimigos. Usado por Ribombee e Vikavolt. Dois estágios de redução ao custo de 0 dano.',
    wrongOptions: ['−1 Speed (1 inimigo)', '−1 Speed (ambos)', '−3 Speed (1 inimigo)'],
  },
  {
    key: 'prankster_tailwind',
    question: 'Qual habilidade do Tornadus dá prioridade +1 ao Tailwind?',
    correctAnswer: 'Prankster (Faz de Conta)',
    answerDisplay: 'Prankster dá prioridade +1 a todos os moves de status, incluindo Tailwind. Assim o Tailwind do Tornadus age antes de quase todo move de ataque.',
    wrongOptions: ['Defiant (+Atk ao receber debuffs)', 'Regenerator (recupera HP ao sair)', 'Intimidate (reduz Atk do inimigo)'],
  },
  {
    key: 'electroweb_effect',
    question: 'O que Electroweb faz além de dano Elétrico?',
    correctAnswer: 'Reduz Speed −1 em ambos os inimigos',
    answerDisplay: 'Electroweb (Base Power 55, tipo Elétrico) atinge os dois inimigos e reduz cada um em −1 Speed. Usado por Regieleki, Rotom, e outros no VGC.',
    wrongOptions: ['Paralisa os inimigos', 'Reduz Ataque Especial −1', 'Tem prioridade +1'],
  },
];

function quizSpeedCtrlQuestion(session: QuizSession): { key: string; question: string; answer: string; answerDisplay: string; choices: string[]; correctChoice: string } | null {
  const unasked = SPEED_CTRL_QUESTIONS.filter((q) => !session.asked.has(q.key));
  if (unasked.length === 0) {
    session.asked.clear();
    return quizSpeedCtrlQuestion(session);
  }
  const item = unasked[Math.floor(Math.random() * unasked.length)];
  // Medium/hard: strip parenthetical hints from all options
  const process = (s: string) => session.difficulty >= 2 ? stripHint(s) : s;
  const correctProcessed = process(item.correctAnswer);
  const rawPool = [item.correctAnswer, ...item.wrongOptions];
  const pool: string[] = shuffleArray(rawPool.map(process));
  const correctIdx = pool.indexOf(correctProcessed);
  const correctChoice = String.fromCharCode(65 + correctIdx);
  return {
    key: item.key,
    question: item.question,
    answer: correctProcessed.toLowerCase(),
    answerDisplay: item.answerDisplay,
    choices: pool,
    correctChoice,
  };
}

// Harder type distractors: pick from the "opposite" relationship pool (confusing)
function typeDistractors(variant: 'weakness' | 'resistance' | 'immunity', seTypes: string[], nveTypes: string[], immuneTypes: string[], correctPool: string[], difficulty: 1 | 2 | 3): string[] {
  if (difficulty === 1) {
    return shuffleArray(ALL_TYPES.map((t) => TYPE_LABELS[t]).filter((l) => !correctPool.includes(l))).slice(0, 3);
  }
  // Medium (2): pick distractors from the RELATED but wrong pool (confusing)
  const confusingPool = variant === 'weakness'
    ? [...nveTypes, ...immuneTypes]  // types that resist the defender — easy to confuse with SE
    : variant === 'resistance'
      ? seTypes                        // types that are SE — easy to confuse with resistors
      : nveTypes;                      // types that resist — confused with immune
  const usable = confusingPool.filter((l) => !correctPool.includes(l));
  // Fill remaining from any type if not enough confusing ones
  const fallback = shuffleArray(ALL_TYPES.map((t) => TYPE_LABELS[t]).filter((l) => !correctPool.includes(l) && !usable.includes(l)));
  return [...shuffleArray(usable), ...fallback].slice(0, 3);
}

function quizTypeEffQuestion(engine: DeterministicEngine, asked: Set<string>, difficulty: 1 | 2 | 3): { key: string; question: string; answer: string; answerDisplay: string; choices: string[]; correctChoice: string } | null {
  const typeChart = engine.getTypeChart();
  type TypePools = { seTypes: string[]; nveTypes: string[]; immuneTypes: string[] };

  // Helper: compute single-type pools
  function computePools(defType: string): TypePools {
    const seTypes: string[] = [], nveTypes: string[] = [], immuneTypes: string[] = [];
    for (const atkType of ALL_TYPES) {
      const mult = typeChart.get(atkType)?.get(defType) ?? 1.0;
      if (mult >= 2.0) seTypes.push(TYPE_LABELS[atkType]);
      else if (mult === 0) immuneTypes.push(TYPE_LABELS[atkType]);
      else if (mult < 1.0) nveTypes.push(TYPE_LABELS[atkType]);
    }
    return { seTypes, nveTypes, immuneTypes };
  }

  // ── Hard (difficulty 3): dual-type combo as subject ──────────────────────────
  if (difficulty === 3) {
    // Pick variant first, then find an available dual-type combo for it
    const wKey = (t1: string, t2: string) => `${t1}+${t2}_weakness`;
    const rKey = (t1: string, t2: string) => `${t1}+${t2}_resistance`;
    const iKey = (t1: string, t2: string) => `${t1}+${t2}_immunity`;

    // Gather all unique dual-type combos from real fully-evolved Pokémon
    const seenKeys = new Set<string>();
    const dualCombos: Array<{ t1: string; t2: string; pokemon: ReturnType<typeof engine.getAllPokemon>[0] }> = [];
    for (const p of engine.getAllPokemon()) {
      if (p.types.length !== 2 || nfeIds.has(p.identifier) || p.identifier.includes('mega') || p.identifier.includes('gmax')) continue;
      const [t1, t2] = p.types;
      const k = `${t1}+${t2}`;
      if (!seenKeys.has(k)) { seenKeys.add(k); dualCombos.push({ t1, t2, pokemon: p }); }
    }

    // Weighted variant pick, filtered to combos not yet asked
    const weaknessAvailD3 = dualCombos.filter(({ t1, t2 }) => {
      const m1 = (atkType: string) => (typeChart.get(atkType)?.get(t1) ?? 1) * (typeChart.get(atkType)?.get(t2) ?? 1);
      return !asked.has(wKey(t1, t2)) && ALL_TYPES.some((a) => m1(a) >= 2);
    });
    const resistAvailD3 = dualCombos.filter(({ t1, t2 }) => {
      const m1 = (atkType: string) => (typeChart.get(atkType)?.get(t1) ?? 1) * (typeChart.get(atkType)?.get(t2) ?? 1);
      return !asked.has(rKey(t1, t2)) && ALL_TYPES.some((a) => { const m = m1(a); return m < 1 && m > 0; });
    });
    const immuneAvailD3 = dualCombos.filter(({ t1, t2 }) => {
      const m1 = (atkType: string) => (typeChart.get(atkType)?.get(t1) ?? 1) * (typeChart.get(atkType)?.get(t2) ?? 1);
      return !asked.has(iKey(t1, t2)) && ALL_TYPES.some((a) => m1(a) === 0);
    });

    if (weaknessAvailD3.length === 0 && resistAvailD3.length === 0 && immuneAvailD3.length === 0) return null;

    const variantPoolD3: ('weakness' | 'resistance' | 'immunity')[] = [];
    for (let i = 0; i < 9; i++) if (weaknessAvailD3.length > 0) variantPoolD3.push('weakness');
    for (let i = 0; i < 8; i++) if (resistAvailD3.length > 0) variantPoolD3.push('resistance');
    for (let i = 0; i < 3; i++) if (immuneAvailD3.length > 0) variantPoolD3.push('immunity');

    const variant = variantPoolD3[Math.floor(Math.random() * variantPoolD3.length)];
    const comboAvail = variant === 'weakness' ? weaknessAvailD3 : variant === 'resistance' ? resistAvailD3 : immuneAvailD3;
    const { t1, t2, pokemon: exPoke } = comboAvail[Math.floor(Math.random() * comboAvail.length)];

    const combinedMult = (atkType: string) => (typeChart.get(atkType)?.get(t1) ?? 1) * (typeChart.get(atkType)?.get(t2) ?? 1);
    const seTypesD3    = ALL_TYPES.filter((a) => combinedMult(a) >= 2).map((t) => TYPE_LABELS[t]);
    const nveTypesD3   = ALL_TYPES.filter((a) => { const m = combinedMult(a); return m < 1 && m > 0; }).map((t) => TYPE_LABELS[t]);
    const immuneTypesD3 = ALL_TYPES.filter((a) => combinedMult(a) === 0).map((t) => TYPE_LABELS[t]);

    const defComboLabel = `${TYPE_LABELS[t1]}/${TYPE_LABELS[t2]}`;
    // 50/50: abstract combo or named Pokémon example
    const useNamedExample = Math.random() < 0.5;
    const subjectLabel = useNamedExample ? `${displayName(exPoke.identifier)} (${defComboLabel})` : `tipo ${defComboLabel}`;

    let questionD3: string;
    let answerPoolD3: string[];
    let confusingPoolD3: string[];

    if (variant === 'weakness') {
      questionD3 = `Qual tipo é SUPER-EFETIVO contra ${subjectLabel}?`;
      answerPoolD3 = seTypesD3;
      confusingPoolD3 = nveTypesD3.filter((l) => !seTypesD3.includes(l)); // resistant types as distractors
    } else if (variant === 'resistance') {
      questionD3 = `Qual tipo ${subjectLabel} RESISTE?`;
      answerPoolD3 = nveTypesD3;
      confusingPoolD3 = seTypesD3.filter((l) => !nveTypesD3.includes(l)); // SE types as distractors
    } else {
      questionD3 = `Qual tipo é IMUNE a ${subjectLabel}?`;
      answerPoolD3 = immuneTypesD3;
      confusingPoolD3 = nveTypesD3.filter((l) => !immuneTypesD3.includes(l));
    }

    if (answerPoolD3.length === 0) return null; // edge case: no valid answers
    const correctLabelD3 = answerPoolD3[Math.floor(Math.random() * answerPoolD3.length)];
    const fallback = shuffleArray(ALL_TYPES.map((t) => TYPE_LABELS[t]).filter((l) => !answerPoolD3.includes(l) && !confusingPoolD3.includes(l)));
    const distractorsD3 = [...shuffleArray(confusingPoolD3), ...fallback].slice(0, 3);
    const choicesRawD3 = shuffleArray([correctLabelD3, ...distractorsD3]);
    const correctChoiceD3 = String.fromCharCode(65 + choicesRawD3.indexOf(correctLabelD3));

    const seListD3 = seTypesD3.length ? seTypesD3.join(', ') : 'Nenhum';
    const nveListD3 = nveTypesD3.length ? nveTypesD3.join(', ') : 'Nenhum';
    const immuneListD3 = immuneTypesD3.length ? immuneTypesD3.join(', ') : 'Nenhum';
    const keyD3 = variant === 'weakness' ? wKey(t1, t2) : variant === 'resistance' ? rKey(t1, t2) : iKey(t1, t2);

    const primaryLineD3 = variant === 'weakness'
      ? `SE contra ${defComboLabel}: ${seListD3}`
      : variant === 'resistance'
        ? `${defComboLabel} resiste a: ${nveListD3}`
        : `Imune a ${defComboLabel}: ${immuneListD3}`;

    return {
      key: keyD3,
      question: questionD3,
      answer: answerPoolD3.map((l) => l.toLowerCase()).join('|'),
      answerDisplay: primaryLineD3 +
        (variant !== 'weakness'   ? `\n  SE contra ${defComboLabel}: ${seListD3}` : '') +
        (variant !== 'resistance' && nveListD3   !== 'Nenhum' ? `\n  Resistidos: ${nveListD3}` : '') +
        (variant !== 'immunity'   && immuneListD3 !== 'Nenhum' ? `\n  Imune: ${immuneListD3}` : ''),
      choices: choicesRawD3,
      correctChoice: correctChoiceD3,
    };
  }

  // ── Easy/Medium (difficulty 1-2): single defending type ──────────────────────
  const typeData: Record<string, TypePools> = {};
  for (const defType of ALL_TYPES) typeData[defType] = computePools(defType);

  const weaknessAvail = ALL_TYPES.filter((d) => !asked.has(`${d}_weakness`) && typeData[d].seTypes.length > 0);
  const resistAvail   = ALL_TYPES.filter((d) => !asked.has(`${d}_resistance`) && typeData[d].nveTypes.length > 0);
  const immuneAvail   = ALL_TYPES.filter((d) => !asked.has(`${d}_immunity`) && typeData[d].immuneTypes.length > 0);

  if (weaknessAvail.length === 0 && resistAvail.length === 0 && immuneAvail.length === 0) return null;

  const variantPool: ('weakness' | 'resistance' | 'immunity')[] = [];
  for (let i = 0; i < 9; i++) if (weaknessAvail.length > 0) variantPool.push('weakness');
  for (let i = 0; i < 8; i++) if (resistAvail.length > 0) variantPool.push('resistance');
  for (let i = 0; i < 3; i++) if (immuneAvail.length > 0) variantPool.push('immunity');

  const variant = variantPool[Math.floor(Math.random() * variantPool.length)];
  const avail = variant === 'weakness' ? weaknessAvail : variant === 'resistance' ? resistAvail : immuneAvail;
  const defType = avail[Math.floor(Math.random() * avail.length)];
  const defLabel = TYPE_LABELS[defType];
  const { seTypes, nveTypes, immuneTypes } = typeData[defType];

  let question: string;
  let answerPool: string[];

  if (variant === 'weakness') {
    question = `Qual tipo é SUPER-EFETIVO (×2) contra ${defLabel}?`;
    answerPool = seTypes;
  } else if (variant === 'resistance') {
    question = `Qual tipo ${defLabel} RESISTE (×½)?`;
    answerPool = nveTypes;
  } else {
    question = `Qual tipo é completamente IMUNE a ${defLabel}?`;
    answerPool = immuneTypes;
  }

  const correctLabel = answerPool[Math.floor(Math.random() * answerPool.length)];
  const distractors = typeDistractors(variant, seTypes, nveTypes, immuneTypes, answerPool, difficulty);
  const choicesRaw = shuffleArray([correctLabel, ...distractors]);
  const correctChoice = String.fromCharCode(65 + choicesRaw.indexOf(correctLabel));

  const seList    = seTypes.length    ? seTypes.join(', ')    : 'Nenhum';
  const nveList   = nveTypes.length   ? nveTypes.join(', ')   : 'Nenhum';
  const immuneList = immuneTypes.length ? immuneTypes.join(', ') : 'Nenhum';
  const primaryLine = variant === 'weakness'
    ? `SE contra ${defLabel}: ${seList}`
    : variant === 'resistance'
      ? `${defLabel} resiste a: ${nveList}`
      : `Imune a ${defLabel}: ${immuneList}`;

  return {
    key: `${defType}_${variant}`,
    question,
    answer: answerPool.map((l) => l.toLowerCase()).join('|'),
    answerDisplay: primaryLine +
      (variant !== 'weakness'   ? `\n  SE contra ${defLabel}: ${seList}` : '') +
      (variant !== 'resistance' && nveList   !== 'Nenhum' ? `\n  Resistidos por ${defLabel}: ${nveList}` : '') +
      (variant !== 'immunity'   && immuneList !== 'Nenhum' ? `\n  Imune a ${defLabel}: ${immuneList}` : ''),
    choices: choicesRaw,
    correctChoice,
  };
}

// Types that make for harder move-type distractors (less obvious, semantically close)
const HARD_MOVE_TYPES = new Set(['ghost','fairy','steel','dragon','poison','bug','dark','ice','psychic','rock','flying','ground']);
const TYPE_SEMANTIC_NEIGHBORS: Record<string, string[]> = {
  ghost:    ['dark','psychic','normal'],
  fairy:    ['dragon','psychic','normal'],
  steel:    ['rock','ice','normal'],
  dragon:   ['fairy','flying','fire'],
  poison:   ['bug','dark','grass'],
  bug:      ['poison','grass','flying'],
  dark:     ['ghost','psychic','fighting'],
  ice:      ['steel','water','electric'],
  psychic:  ['ghost','fairy','dark'],
  rock:     ['steel','ground','ice'],
  flying:   ['dragon','normal','electric'],
  ground:   ['rock','steel','fighting'],
  fire:     ['water','rock','grass'],
  water:    ['ice','electric','grass'],
  electric: ['water','flying','steel'],
  grass:    ['poison','bug','fire'],
  fighting: ['dark','rock','normal'],
  normal:   ['fighting','ghost','electric'],
};

function quizMoveTypeQuestion(engine: DeterministicEngine, asked: Set<string>, difficulty: 1 | 2 | 3): { key: string; question: string; answer: string; answerDisplay: string; choices: string[]; correctChoice: string } | null {
  let entries = [...moveIndex.entries()].filter(([k]) => !asked.has(k) && k.length >= 4);
  if (entries.length === 0) return null;

  // Hard: prefer less obvious types
  if (difficulty === 3) {
    const hardEntries = entries.filter(([, moveId]) => {
      const mv = engine.getMove(moveId);
      return mv && HARD_MOVE_TYPES.has(mv.type_id);
    });
    if (hardEntries.length > 0) entries = hardEntries;
  }

  const shuffled = shuffleArray(entries);
  for (const [key, moveId] of shuffled) {
    const move = engine.getMove(moveId);
    if (!move) continue;
    const typeLabel = TYPE_LABELS[move.type_id] ?? move.type_id;
    const name = displayName(moveId);

    let distractors: string[];
    if (difficulty <= 2) {
      // Easy/Medium: any 3 random other types
      distractors = shuffleArray(ALL_TYPES.filter((t) => t !== move.type_id).map((t) => TYPE_LABELS[t])).slice(0, 3);
    } else {
      // Hard: use semantic neighbors as distractors (types that "feel" similar)
      const neighbors = (TYPE_SEMANTIC_NEIGHBORS[move.type_id] ?? []).map((t) => TYPE_LABELS[t]);
      const fallback = shuffleArray(ALL_TYPES.filter((t) => t !== move.type_id && !TYPE_SEMANTIC_NEIGHBORS[move.type_id]?.includes(t)).map((t) => TYPE_LABELS[t]));
      distractors = [...neighbors, ...fallback].slice(0, 3);
    }
    const choicesRaw = shuffleArray([typeLabel, ...distractors]);
    const correctChoice = String.fromCharCode(65 + choicesRaw.indexOf(typeLabel));

    return {
      key,
      question: `De que tipo é o golpe ${name}?`,
      answer: typeLabel.toLowerCase(),
      answerDisplay: `${name} → ${typeLabel}  (${move.category === 'physical' ? 'Físico' : move.category === 'special' ? 'Especial' : 'Status'}, ${move.base_power > 0 ? move.base_power + 'BP' : 'Status'})`,
      choices: choicesRaw,
      correctChoice,
    };
  }
  return null;
}

function quizPokemonStatsQuestion(engine: DeterministicEngine, asked: Set<string>, difficulty: 1 | 2 | 3): { key: string; question: string; answer: string; answerDisplay: string; choices: string[]; correctChoice: string } | null {
  const pool = engine.getAllPokemon().filter((p) => {
    const bst = Object.values(p.baseStats).reduce((a, b) => a + b, 0);
    return !nfeIds.has(p.identifier) &&
      !p.identifier.includes('mega') &&
      !p.identifier.includes('gmax') &&
      bst > 280 &&
      !asked.has(p.identifier);
  });
  if (pool.length === 0) return null;
  const p = pool[Math.floor(Math.random() * pool.length)];
  const s = p.baseStats;
  const types = p.types.map((t) => TYPE_LABELS[t] ?? t).join('/');
  const correctLabel = displayName(p.identifier);
  const pBst = Object.values(s).reduce((a, b) => a + b, 0);

  const allFe = engine.getAllPokemon().filter((o) =>
    o.identifier !== p.identifier &&
    !nfeIds.has(o.identifier) &&
    !o.identifier.includes('mega') &&
    !o.identifier.includes('gmax')
  );
  allFe.sort((a, b) => {
    const da = Math.abs(Object.values(a.baseStats).reduce((s, v) => s + v, 0) - pBst);
    const db = Math.abs(Object.values(b.baseStats).reduce((s, v) => s + v, 0) - pBst);
    return da - db;
  });

  // Window size by difficulty: 1→12 closest, 2→6 closest, 3→same type + 4 closest
  const bstWindow = difficulty === 1 ? 12 : difficulty === 2 ? 6 : 4;
  let distractorPool = shuffleArray(allFe.slice(1, bstWindow + 1));

  if (difficulty === 3 && p.types.length > 0) {
    // Prefer same primary type (hardest)
    const sameType = allFe.filter((o) => o.types[0] === p.types[0] && !distractorPool.includes(o)).slice(0, 4);
    if (sameType.length >= 2) distractorPool = shuffleArray([...sameType, ...allFe.slice(1, 4)]);
  }

  const distractors = distractorPool.slice(0, 3).map((d) => displayName(d.identifier));
  const choicesRaw = shuffleArray([correctLabel, ...distractors]);
  const correctChoice = String.fromCharCode(65 + choicesRaw.indexOf(correctLabel));

  return {
    key: p.identifier,
    question: `Qual Pokémon tem estes stats base?\n  HP ${s.hp} / Atk ${s.attack} / Def ${s.defense} / SpAtk ${s.special_attack} / SpDef ${s.special_defense} / Vel ${s.speed}\n  Tipo(s): ${types}`,
    answer: p.identifier.replace(/_/g, ' ').toLowerCase(),
    answerDisplay: correctLabel + ` (${types})`,
    choices: choicesRaw,
    correctChoice,
  };
}

function startQuizSession(type: QuizSession['type'], difficulty: 1 | 2 | 3, engine: DeterministicEngine): string {
  pendingQuizType = null;
  quizSession = { type, difficulty, question: '', answer: '', answerDisplay: '', choices: [], correctChoice: 'A', score: 0, total: 0, streak: 0, asked: new Set() };
  return nextQuizQuestion(engine);
}

function nextQuizQuestion(engine: DeterministicEngine): string {
  if (!quizSession) return 'Bot: Nenhum quiz ativo. Digite "quiz" para escolher um modo.';
  const diff = quizSession.difficulty;
  let q: ReturnType<typeof quizTypeEffQuestion> = null;
  if (quizSession.type === 'type_eff') q = quizTypeEffQuestion(engine, quizSession.asked, diff);
  else if (quizSession.type === 'move_type') q = quizMoveTypeQuestion(engine, quizSession.asked, diff);
  else if (quizSession.type === 'speed_ctrl') q = quizSpeedCtrlQuestion(quizSession);
  else q = quizPokemonStatsQuestion(engine, quizSession.asked, diff);

  if (!q) {
    // All questions exhausted — reset asked set and try again
    quizSession.asked = new Set();
    if (quizSession.type === 'type_eff') q = quizTypeEffQuestion(engine, quizSession.asked, diff);
    else if (quizSession.type === 'move_type') q = quizMoveTypeQuestion(engine, quizSession.asked, diff);
    else if (quizSession.type === 'speed_ctrl') q = quizSpeedCtrlQuestion(quizSession);
    else q = quizPokemonStatsQuestion(engine, quizSession.asked, diff);
  }
  if (!q) return endQuizSession();

  quizSession.asked.add(q.key);
  quizSession.question = q.question;
  quizSession.answer = q.answer;
  quizSession.answerDisplay = q.answerDisplay;
  quizSession.choices = q.choices;
  quizSession.correctChoice = q.correctChoice;

  const typeLabel = quizSession.type === 'type_eff' ? 'Tipos'
    : quizSession.type === 'move_type' ? 'Golpes'
    : quizSession.type === 'speed_ctrl' ? 'Speed Control'
    : 'Pokémon';
  const diffLabel = diff === 1 ? 'Fácil' : diff === 2 ? 'Médio' : 'Difícil';
  const choicesBlock = [
    '[[QUIZ_CHOICES]]',
    `A) ${q.choices[0]}`,
    `B) ${q.choices[1]}`,
    `C) ${q.choices[2]}`,
    `D) ${q.choices[3]}`,
    '[[/QUIZ_CHOICES]]',
  ].join('\n');
  return [
    `Bot: ── Quiz ${typeLabel} [${diffLabel}] — ${quizSession.score}/${quizSession.total} corretas ──`,
    q.question,
    choicesBlock,
    '(Clique em uma opção, ou "pular"/"parar")',
  ].join('\n');
}

function fuzzyMatchTypeName(userInput: string, options: string[]): boolean {
  const u = userInput.normalize('NFD').replace(/\p{M}/gu, '').trim();
  for (const opt of options) {
    const o = opt.normalize('NFD').replace(/\p{M}/gu, '');
    const threshold = Math.max(1, Math.ceil(o.length / 3));
    if (levenshtein(u, o) <= threshold) return true;
    const enId = TYPE_PT_TO_EN[opt] ?? '';
    if (enId && levenshtein(u, enId) <= threshold) return true;
  }
  return false;
}

function checkQuizAnswer(raw: string, engine: DeterministicEngine): string {
  if (!quizSession) return 'Bot: Nenhum quiz ativo.';

  const t = raw.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

  // "pular" or "skip" — reveal answer without counting
  if (/^(pular|skip|nao\s+sei|desistir|give\s+up)$/.test(t)) {
    quizSession.streak = 0;
    return [
      `Bot: Resposta: ${quizSession.answerDisplay}`,
      '',
      nextQuizQuestion(engine),
    ].join('\n');
  }

  quizSession.total++;
  let correct = false;

  // Letter choice (A/B/C/D) — always checked first when choices are available
  const cleanInput = t.trim();
  const letterIdx = 'abcd'.indexOf(cleanInput);
  if (letterIdx >= 0 && quizSession.choices.length === 4) {
    correct = cleanInput === quizSession.correctChoice.toLowerCase();
  } else if (quizSession.type === 'type_eff') {
    // Answer is pipe-separated list of valid options; user must match ANY ONE of them
    const validOptions = quizSession.answer.split('|').map((s) => s.normalize('NFD').replace(/\p{M}/gu, ''));
    const userAnswer = t.normalize('NFD').replace(/\p{M}/gu, '').trim();
    correct = validOptions.some((opt) => {
      if (opt === userAnswer) return true;
      if (opt.includes(userAnswer) || userAnswer.includes(opt)) return true;
      const enId = TYPE_PT_TO_EN[opt] ?? '';
      return enId !== '' && userAnswer === enId;
    });
    // Fuzzy fallback for typos like "foigo" → "fogo"
    if (!correct) correct = fuzzyMatchTypeName(userAnswer, quizSession.answer.split('|'));
  } else if (quizSession.type === 'move_type') {
    const correctNFD = quizSession.answer.normalize('NFD').replace(/\p{M}/gu, '');
    correct = t.includes(correctNFD) || correctNFD.includes(t);
    const enId = TYPE_PT_TO_EN[quizSession.answer];
    if (!correct && enId && t.includes(enId)) correct = true;
    if (!correct) correct = fuzzyMatchTypeName(t, [quizSession.answer]);
  } else if (quizSession.type === 'speed_ctrl') {
    // Text fallback: check against the correct answer text (letter check already handled above)
    const correctNFD = quizSession.answer.normalize('NFD').replace(/\p{M}/gu, '');
    correct = t.includes(correctNFD) || correctNFD.includes(t);
  } else {
    // pokemon_stats — accept name or partial match
    const correctNFD = quizSession.answer.normalize('NFD').replace(/\p{M}/gu, '');
    correct = t.includes(correctNFD) || correctNFD.includes(t);
    if (!correct) {
      const extracted = extractPokemonName(t);
      correct = extracted !== null && extracted === quizSession.answer.replace(/\s/g, '_');
    }
  }

  if (correct) {
    quizSession.score++;
    quizSession.streak++;
    const streakMsg = quizSession.streak >= 3 ? `  🔥 Sequência de ${quizSession.streak}!` : '';
    return [
      `Bot: ✅ Correto!${streakMsg}  (${quizSession.score}/${quizSession.total})`,
      '',
      nextQuizQuestion(engine),
    ].join('\n');
  } else {
    quizSession.streak = 0;
    return [
      `Bot: ❌ Errado. Resposta: ${quizSession.answerDisplay}`,
      `  (${quizSession.score}/${quizSession.total})`,
      '',
      nextQuizQuestion(engine),
    ].join('\n');
  }
}

function endQuizSession(): string {
  const s = quizSession;
  quizSession = null;
  pendingQuizType = null;
  if (!s) return 'Bot: Nenhum quiz ativo.';
  const pct = s.total > 0 ? Math.round((s.score / s.total) * 100) : 0;
  const grade = pct >= 90 ? '⭐⭐⭐ Excelente!' : pct >= 70 ? '⭐⭐ Bom resultado!' : pct >= 50 ? '⭐ Continue praticando!' : 'Continue estudando!';
  return `Bot: Quiz encerrado — ${s.score}/${s.total} (${pct}%)  ${grade}`;
}

// ---------------------------------------------------------------------------
// Battle Simulator Session
// ---------------------------------------------------------------------------

interface BattleSessionData {
  phase: 'team_build' | 'pick_lead' | 'battle' | 'awaiting_switch' | 'post_battle';
  buildStep: 'pokemon' | 'ability' | 'item' | 'moves' | 'evs' | 'confirm';
  currentPokemonIdx: number;
  currentBuild: Partial<BattlePokemonConfig>;
  userConfigs: BattlePokemonConfig[];
  aiConfigs: BattlePokemonConfig[];
  sim: BattleSimulator | null;
  ai: BattleAI | null;
  state: BattleState | null;
  userTeamIdx: 0 | 1;
  awaitingSwitchSlot: 0 | 1;
}

let battleSession: BattleSessionData | null = null;

function battleDisplayName(id: string): string {
  return id.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function emitBattleStatus(state: BattleState, userTeamIdx: 0 | 1): string {
  const oppTeamIdx = (1 - userTeamIdx) as 0 | 1;
  const STATUS_ABBREV: Record<string, string> = {
    healthy: 'OK', burned: 'BRN', paralyzed: 'PAR', poisoned: 'PSN',
    badly_poisoned: 'TOX', frozen: 'FRZ', asleep: 'SLP',
  };
  const fmtSlot = (p: BattlePokemon | null): string => {
    if (!p) return '(vazio)|0|1|none';
    if (p.fainted) return `${battleDisplayName(p.identifier)}|0|${p.maxHp}|KO`;
    return `${battleDisplayName(p.identifier)}|${p.currentHp}|${p.maxHp}|${STATUS_ABBREV[p.status] ?? p.status}`;
  };
  return [
    '[[BATTLE_STATUS]]',
    fmtSlot(state.teams[userTeamIdx].active[0]),
    fmtSlot(state.teams[userTeamIdx].active[1]),
    'vs',
    fmtSlot(state.teams[oppTeamIdx].active[0]),
    fmtSlot(state.teams[oppTeamIdx].active[1]),
    '[[/BATTLE_STATUS]]',
  ].join('\n');
}

function emitBattleMovesForSlot(state: BattleState, userTeamIdx: 0 | 1, slot: 0 | 1, engine: DeterministicEngine): string {
  const userTeam = state.teams[userTeamIdx];
  const poke = userTeam.active[slot];
  if (!poke || poke.fainted) return '';

  const oppTeam = state.teams[(1 - userTeamIdx) as 0 | 1];
  const opponents = (oppTeam.active as (BattlePokemon | null)[]).filter((p): p is BattlePokemon => !!p && !p.fainted);

  const options: string[] = [];
  for (const moveId of poke.config.moves) {
    if (poke.choiceLocked && poke.choiceLocked !== moveId) continue;
    if ((poke.ppRemaining[moveId] ?? 5) <= 0) continue;
    const move = engine.getMove(moveId);
    if (!move) continue;
    const isSpread = (move.tags as string[])?.some((tag) => tag === 'spread' || tag === 'target_all');
    const target = move.category === 'status' ? '' :
      isSpread ? ' → ambos' :
      opponents.length > 0 ? ` → ${battleDisplayName(opponents[0].identifier)}` : '';
    options.push(`${battleDisplayName(moveId)}${target}`);
    if (options.length >= 4) break;
  }

  const bench = userTeam.party.filter((p) => !p.fainted && !userTeam.active.includes(p));
  bench.slice(0, Math.max(0, 4 - options.length)).forEach((b) => {
    options.push(`Trocar → ${battleDisplayName(b.identifier)}`);
  });

  const block = ['[[BATTLE_MOVES]]'];
  ['A', 'B', 'C', 'D'].forEach((letter, i) => {
    if (i < options.length) block.push(`${letter}) ${options[i]}`);
  });
  block.push('[[/BATTLE_MOVES]]');
  return block.join('\n');
}

function renderBattleTurn(state: BattleState, userTeamIdx: 0 | 1, engine: DeterministicEngine): string {
  const userTeam = state.teams[userTeamIdx];
  const activePoke = userTeam.active[0];
  if (!activePoke || activePoke.fainted) return 'Bot: Nenhum Pokémon ativo no slot 1.';

  const fieldInfo: string[] = [];
  if (state.field.trickRoom) fieldInfo.push(`Trick Room [${state.field.trickRoomTurns}t]`);
  if (state.field.weather !== 'none') fieldInfo.push(`${state.field.weather} [${state.field.weatherTurns}t]`);
  if (state.field.terrain !== 'none') fieldInfo.push(`${state.field.terrain} terrain [${state.field.terrainTurns}t]`);
  if (userTeam.tailwindTurns > 0) fieldInfo.push(`Tailwind [${userTeam.tailwindTurns}t]`);
  const fieldStr = fieldInfo.length > 0 ? `Campo: ${fieldInfo.join(' | ')}\n` : '';

  return [
    `Bot: ── Turno ${state.turn + 1} ──`,
    fieldStr,
    emitBattleStatus(state, userTeamIdx),
    '',
    `${battleDisplayName(activePoke.identifier)} — escolha uma ação:`,
    emitBattleMovesForSlot(state, userTeamIdx, 0, engine),
    '(A/B/C/D ou "cancelar")',
  ].filter(Boolean).join('\n');
}

function buildAITeam(engine: DeterministicEngine): BattlePokemonConfig[] {
  type PRow = { identifier: string };
  const candidates = engine.queryAll<PRow>(
    `SELECT DISTINCT p.identifier
     FROM pokemon p
     WHERE p.identifier NOT LIKE '%_mega%'
       AND p.identifier NOT LIKE '%_gmax%'
       AND p.id NOT IN (SELECT DISTINCT from_id FROM pokemon_evolution)
       AND p.id IN (SELECT pokemon_id FROM pokemon_stats WHERE stat_id = 'hp' AND value >= 65)
     ORDER BY RANDOM() LIMIT 20`
  ).map((r) => r.identifier).filter((id) => !isLegendary(id));

  const configs: BattlePokemonConfig[] = [];
  for (const id of candidates) {
    if (configs.length >= 4) break;
    const p = engine.getPokemonContext(id);
    if (!p) continue;
    const ability = p.abilities[0] ?? 'pressure';
    type MRow = { move_id: string };
    const moves = engine.queryAll<MRow>(
      `SELECT DISTINCT pm.move_id FROM pokemon_moves pm JOIN moves m ON pm.move_id = m.id
       WHERE pm.pokemon_identifier = ? AND m.base_power > 0 ORDER BY m.base_power DESC LIMIT 4`,
      [id]
    ).map((m) => m.move_id);
    if (moves.length < 1) continue;

    const hasProtect = engine.queryAll<{ move_id: string }>(
      `SELECT move_id FROM pokemon_moves WHERE pokemon_identifier = ? AND move_id = 'protect' LIMIT 1`, [id]
    );
    if (hasProtect.length > 0 && moves.length < 4) moves.push('protect');

    const offBias = p.baseStats.attack >= p.baseStats.special_attack;
    const offStat = offBias ? 'attack' : 'special_attack';
    configs.push({
      identifier: id, ability, item: null,
      moves: moves.slice(0, 4),
      evs: { [offStat]: 252, speed: 252, hp: 4 },
      nature: (offBias ? 'adamant' : 'modest') as unknown as Nature,
    });
  }
  return configs;
}

function startBattleSimulator(engine: DeterministicEngine): string {
  const aiConfigs = buildAITeam(engine);
  if (aiConfigs.length < 4) {
    return 'Bot: Não foi possível montar o time da IA (poucos Pokémon no banco). Verifique a base de dados.';
  }
  battleSession = {
    phase: 'team_build', buildStep: 'pokemon',
    currentPokemonIdx: 0, currentBuild: {},
    userConfigs: [], aiConfigs,
    sim: null, ai: null, state: null,
    userTeamIdx: 0, awaitingSwitchSlot: 0,
  };
  return [
    'Bot: ── Simulador VGC ──',
    'Vamos montar seu time! Você escolherá 4 Pokémon.',
    '',
    'Pokémon 1/4: Qual Pokémon você quer usar?',
    '(Ex: charizard, garchomp, torkoal... | "cancelar" para sair)',
  ].join('\n');
}

function handleTeamBuildInput(raw: string, engine: DeterministicEngine): string {
  if (!battleSession || battleSession.phase !== 'team_build') return 'Bot: Erro no estado do simulador.';
  const t = raw.trim().toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

  if (/^(cancelar|cancel|sair|quit)$/.test(t)) {
    battleSession = null;
    return 'Bot: Simulador cancelado. Digite "simulador" para recomeçar.';
  }

  switch (battleSession.buildStep) {
    case 'pokemon': {
      const pokemonId = extractPokemonName(t) ?? nameIndex.get(t.replace(/\s/g, '_'));
      if (!pokemonId) return `Bot: Pokémon "${raw.trim()}" não encontrado. Tente novamente:`;
      const p = engine.getPokemonContext(pokemonId);
      if (!p) return `Bot: Pokémon "${raw.trim()}" não encontrado. Tente novamente:`;
      if (battleSession.userConfigs.some((c) => c.identifier === pokemonId))
        return `Bot: ${displayName(pokemonId)} já está no time! Escolha outro Pokémon:`;
      battleSession.currentBuild = { identifier: pokemonId };
      battleSession.buildStep = 'ability';
      const lines = [
        `Bot: ${displayName(pokemonId)} escolhido!`,
        `Qual habilidade?`,
        '[[QUIZ_MENU]]',
        ...p.abilities.slice(0, 4).map(displayName),
        '[[/QUIZ_MENU]]',
      ];
      return lines.join('\n');
    }
    case 'ability': {
      const pokemonId = battleSession.currentBuild.identifier!;
      const p = engine.getPokemonContext(pokemonId)!;
      const abilityId = extractAbilityName(t)
        ?? p.abilities.find((a) => displayName(a).toLowerCase() === t || a === t.replace(/\s/g, '_') || a.replace(/_/g, '') === t.replace(/\s/g, ''));
      if (!abilityId || !p.abilities.includes(abilityId)) {
        return `Bot: Habilidade não disponível para ${displayName(pokemonId)}. Escolha: ${p.abilities.map(displayName).join(', ')}`;
      }
      battleSession.currentBuild.ability = abilityId;
      battleSession.buildStep = 'item';
      return [
        `Bot: ${displayName(abilityId)} definida!`,
        `Item para ${displayName(pokemonId)}? (Ex: "life orb", "choice scarf", ou "nenhum")`,
      ].join('\n');
    }
    case 'item': {
      const pokemonId = battleSession.currentBuild.identifier!;
      let itemId: string | null = null;
      if (!/^(nenhum|none|sem\s*item|-|n\/a)$/.test(t)) {
        const normalized = t.replace(/\s+/g, '_');
        const itemRow = engine.queryAll<{ id: string }>('SELECT id FROM items WHERE id = ? LIMIT 1', [normalized]);
        if (itemRow.length > 0) {
          itemId = itemRow[0].id;
        } else {
          const allItems = engine.queryAll<{ id: string }>('SELECT id FROM items LIMIT 600');
          const match = allItems.find((r) =>
            r.id.replace(/_/g, '') === normalized.replace(/_/g, '') ||
            r.id.replace(/_/g, ' ') === t
          );
          itemId = match?.id ?? null;
        }
        if (!itemId) return `Bot: Item "${raw.trim()}" não encontrado. Tente novamente ou diga "nenhum":`;
      }
      battleSession.currentBuild.item = itemId;
      battleSession.buildStep = 'moves';
      return [
        `Bot: ${itemId ? displayName(itemId) : 'Sem item'} definido!`,
        `Golpes para ${displayName(pokemonId)} (1-4, separados por vírgula):`,
        `(Ex: "heat wave, protect, dragon dance, roost")`,
      ].join('\n');
    }
    case 'moves': {
      const pokemonId = battleSession.currentBuild.identifier!;
      const moveInputs = raw.split(/[,\n/]/).map((s) => s.trim().toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, '_')).filter(Boolean);
      if (moveInputs.length === 0) return 'Bot: Nenhum golpe reconhecido. Tente novamente:';
      const validMoves: string[] = [];
      const invalidMoves: string[] = [];
      for (const input of moveInputs) {
        const moveId = moveIndex.get(input) ?? moveIndex.get(input.replace(/_/g, '')) ?? extractMoveName(input.replace(/_/g, ' '));
        if (!moveId) { invalidMoves.push(input); continue; }
        if (!validMoves.includes(moveId)) validMoves.push(moveId);
        if (validMoves.length >= 4) break;
      }
      if (validMoves.length === 0) return `Bot: Nenhum golpe válido. Ex: "flamethrower, protect, dragon dance, roost"`;
      if (invalidMoves.length > 0) {
        return [
          `Bot: Não reconhecidos: ${invalidMoves.join(', ')}`,
          `Válidos: ${validMoves.map(displayName).join(', ')}`,
          `[[QUIZ_MENU]]`,
          `Usar esses golpes`,
          `Tentar novamente`,
          `[[/QUIZ_MENU]]`,
        ].join('\n');
      }
      battleSession.currentBuild.moves = validMoves;
      battleSession.buildStep = 'evs';
      return [
        `Bot: Golpes: ${validMoves.map(displayName).join(', ')}`,
        `EVs para ${displayName(pokemonId)}:`,
        '[[QUIZ_MENU]]',
        'Ofensivo (252 Atk/SpAtk + 252 Vel + 4 HP)',
        'Bulky Ofensivo (252 Atk/SpAtk + 108 Def + 148 Vel)',
        'Defensivo (252 HP + 252 Def/SpDef)',
        '[[/QUIZ_MENU]]',
      ].join('\n');
    }
    case 'evs': {
      const pokemonId = battleSession.currentBuild.identifier!;
      const p = engine.getPokemonContext(pokemonId)!;
      const offBias = p.baseStats.attack >= p.baseStats.special_attack;
      const offStat = offBias ? 'attack' : 'special_attack';
      let evs: Record<string, number>;
      if (/ofensiv/i.test(t) || /^a$/i.test(t) || /usar\s+esses/.test(t)) {
        evs = { [offStat]: 252, speed: 252, hp: 4 };
      } else if (/bulky/i.test(t) || /^b$/i.test(t)) {
        evs = { [offStat]: 252, defense: 108, speed: 148 };
      } else {
        evs = { hp: 252, defense: 252, special_defense: 4 };
      }
      battleSession.currentBuild.evs = evs;
      battleSession.currentBuild.nature = (offBias ? 'adamant' : 'modest') as unknown as Nature;
      const config: BattlePokemonConfig = {
        identifier: pokemonId,
        ability: battleSession.currentBuild.ability!,
        item: battleSession.currentBuild.item ?? null,
        moves: battleSession.currentBuild.moves!,
        evs: battleSession.currentBuild.evs,
        nature: battleSession.currentBuild.nature,
      };
      battleSession.userConfigs.push(config);
      battleSession.currentBuild = {};
      if (battleSession.userConfigs.length < 4) {
        battleSession.currentPokemonIdx++;
        battleSession.buildStep = 'pokemon';
        return [
          `Bot: ${displayName(config.identifier)} adicionado!`,
          `Pokémon ${battleSession.userConfigs.length + 1}/4: Qual Pokémon?`,
        ].join('\n');
      }
      battleSession.buildStep = 'confirm';
      const evLabel = (ev: Record<string, number>): string =>
        Object.entries(ev).map(([k, v]) => {
          const abbr: Record<string, string> = { attack: 'Atk', special_attack: 'SpAtk', defense: 'Def', special_defense: 'SpDef', speed: 'Vel', hp: 'HP' };
          return `${abbr[k] ?? k}:${v}`;
        }).join('/');
      const summary = battleSession.userConfigs.map((c, i) =>
        `${i + 1}. ${displayName(c.identifier)} | ${displayName(c.ability)} | ${c.item ? displayName(c.item) : 'sem item'}\n   ${c.moves.map(displayName).join(', ')} | EVs: ${evLabel(c.evs ?? {})}`
      );
      return [
        'Bot: ── Seu Time ──',
        ...summary,
        '',
        'Confirmar e iniciar batalha?',
        '[[QUIZ_MENU]]',
        'Sim, batalhar!',
        'Cancelar',
        '[[/QUIZ_MENU]]',
      ].join('\n');
    }
    case 'confirm': {
      if (/^(sim|yes|batalhar|confirmar|ok|s|iniciar)$/i.test(t) || t.includes('sim') || t.includes('batalhar')) {
        return initializeBattle(engine);
      }
      battleSession = null;
      return 'Bot: Simulador cancelado. Digite "simulador" para recomeçar.';
    }
    default:
      return 'Bot: Erro no simulador. Digite "cancelar" para sair.';
  }
}

function initializeBattle(engine: DeterministicEngine): string {
  if (!battleSession) return 'Bot: Erro interno.';
  const sim = new BattleSimulator(engine);
  const ai = new BattleAI(sim, engine);
  battleSession.sim = sim;
  battleSession.ai = ai;
  try {
    const state = sim.initBattle(
      { pokemon: battleSession.userConfigs } as BattleTeamConfig,
      { pokemon: battleSession.aiConfigs } as BattleTeamConfig
    );
    battleSession.state = state;
    battleSession.phase = 'pick_lead';
    const cfgs = battleSession.userConfigs;
    const leadOptions = [
      `${displayName(cfgs[0].identifier)} + ${displayName(cfgs[1].identifier)}`,
      `${displayName(cfgs[0].identifier)} + ${displayName(cfgs[2].identifier)}`,
      `${displayName(cfgs[0].identifier)} + ${displayName(cfgs[3].identifier)}`,
      `${displayName(cfgs[1].identifier)} + ${displayName(cfgs[2].identifier)}`,
    ];
    return [
      'Bot: Time pronto! Escolha os 2 Pokémon iniciais:',
      '[[QUIZ_MENU]]',
      ...leadOptions,
      '[[/QUIZ_MENU]]',
    ].join('\n');
  } catch (e) {
    battleSession = null;
    return `Bot: Erro ao iniciar batalha: ${e}. Digite "simulador" para recomeçar.`;
  }
}

function handlePickLeadInput(raw: string, engine: DeterministicEngine): string {
  if (!battleSession || battleSession.phase !== 'pick_lead' || !battleSession.state) {
    return 'Bot: Erro no estado do simulador.';
  }
  const t = raw.trim().toLowerCase();
  if (/^(cancelar|cancel)$/.test(t)) { battleSession = null; return 'Bot: Simulador cancelado.'; }

  const combos: [number, number][] = [[0, 1], [0, 2], [0, 3], [1, 2]];
  let selectedCombo: [number, number] = combos[0];
  const letterIdx = 'abcd'.indexOf(t.trim());
  if (letterIdx >= 0 && letterIdx < combos.length) {
    selectedCombo = combos[letterIdx];
  } else {
    const cfgs = battleSession.userConfigs;
    const found: number[] = [];
    for (let i = 0; i < cfgs.length; i++) {
      if (t.includes(cfgs[i].identifier.replace(/_/g, ' ')) || t.includes(cfgs[i].identifier)) found.push(i);
    }
    if (found.length >= 2) selectedCombo = [found[0], found[1]];
  }

  const [l0, l1] = selectedCombo;
  const party = battleSession.state.teams[0].party;
  const ordered = [party[l0], party[l1], ...party.filter((_, i) => i !== l0 && i !== l1)];
  battleSession.state.teams[0].party = ordered;
  battleSession.state.teams[0].active = [ordered[0] ?? null, ordered[1] ?? null];
  battleSession.phase = 'battle';

  return renderBattleTurn(battleSession.state, 0, engine);
}

function handleBattleMoveInput(raw: string, engine: DeterministicEngine): string {
  if (!battleSession || battleSession.phase !== 'battle' || !battleSession.state || !battleSession.sim || !battleSession.ai) {
    return 'Bot: Nenhuma batalha ativa.';
  }
  const t = raw.trim().toLowerCase();
  if (/^(cancelar|cancel|sair|encerrar)$/.test(t)) return endBattleSession(null, engine);

  const state = battleSession.state;
  const userTeamIdx = battleSession.userTeamIdx;
  const userTeam = state.teams[userTeamIdx];
  const activePoke = userTeam.active[0];
  if (!activePoke || activePoke.fainted) return 'Bot: Seu Pokémon desmaiou. Escolha um substituto.';

  const oppTeam = state.teams[(1 - userTeamIdx) as 0 | 1];
  const opponents = (oppTeam.active as (BattlePokemon | null)[]).filter((p): p is BattlePokemon => !!p && !p.fainted);

  // Build move options list (same order as display)
  const moveOpts: Array<{ kind: 'move'; moveId: string } | { kind: 'switch'; partyIdx: number }> = [];
  for (const moveId of activePoke.config.moves) {
    if (activePoke.choiceLocked && activePoke.choiceLocked !== moveId) continue;
    if ((activePoke.ppRemaining[moveId] ?? 5) <= 0) continue;
    if (!engine.getMove(moveId)) continue;
    moveOpts.push({ kind: 'move', moveId });
    if (moveOpts.length >= 4) break;
  }
  const bench = userTeam.party.filter((p) => !p.fainted && !userTeam.active.includes(p));
  bench.slice(0, Math.max(0, 4 - moveOpts.length)).forEach((b) => {
    moveOpts.push({ kind: 'switch', partyIdx: userTeam.party.indexOf(b) });
  });

  let selectedOpt = moveOpts[0];
  const letterIdx = 'abcd'.indexOf(t.trim());
  if (letterIdx >= 0 && letterIdx < moveOpts.length) selectedOpt = moveOpts[letterIdx];
  if (!selectedOpt) return 'Bot: Opção inválida. Escolha A, B, C ou D.';

  let userAction: BattleAction;
  if (selectedOpt.kind === 'switch') {
    userAction = { kind: 'switch', teamIdx: userTeamIdx, activeSlot: 0, partyIdx: selectedOpt.partyIdx };
  } else {
    const target = opponents[0] ?? (userTeam.active.find((p) => p && !p.fainted && p.uid !== activePoke.uid));
    if (!target) return 'Bot: Nenhum alvo disponível.';
    userAction = { kind: 'move', actorUid: activePoke.uid, moveId: selectedOpt.moveId, targetUid: target.uid };
  }

  const aiTeam0Actions = battleSession.ai.chooseActions(state, userTeamIdx);
  const slot2Action: BattleAction = aiTeam0Actions[1] ?? { kind: 'pass' };
  const aiTeam1Actions = battleSession.ai.chooseActions(state, (1 - userTeamIdx) as 0 | 1);

  state.log = [];
  let result;
  try {
    result = battleSession.sim.executeTurn(state, [userAction, slot2Action, ...aiTeam1Actions]);
  } catch (e) {
    return `Bot: Erro na batalha: ${e}`;
  }
  battleSession.state = result.state;
  const turnLog = result.state.log.length > 0 ? result.state.log.map((l) => `  ${l}`).join('\n') + '\n' : '';

  if (result.winner !== null) {
    return [turnLog, emitBattleStatus(result.state, userTeamIdx), '', endBattleSession(result.winner, engine)].filter(Boolean).join('\n');
  }

  if (result.requiresSwitch[userTeamIdx]) {
    const newBench = userTeam.party.filter((p) => !p.fainted && !userTeam.active.includes(p));
    if (newBench.length > 0) {
      battleSession.phase = 'awaiting_switch';
      battleSession.awaitingSwitchSlot = 0;
      const switchOpts = newBench.slice(0, 4).map((b) => displayName(b.identifier));
      return [
        turnLog,
        emitBattleStatus(result.state, userTeamIdx),
        '',
        'Bot: Seu Pokémon desmaiou! Escolha um substituto:',
        '[[QUIZ_MENU]]',
        ...switchOpts,
        '[[/QUIZ_MENU]]',
      ].filter(Boolean).join('\n');
    }
  }

  return [turnLog, renderBattleTurn(result.state, userTeamIdx, engine)].filter(Boolean).join('\n');
}

function handleSwitchInput(raw: string, engine: DeterministicEngine): string {
  if (!battleSession || battleSession.phase !== 'awaiting_switch' || !battleSession.state || !battleSession.sim || !battleSession.ai) {
    return 'Bot: Nenhum switch aguardando.';
  }
  const t = raw.trim().toLowerCase();
  const state = battleSession.state;
  const userTeamIdx = battleSession.userTeamIdx;
  const userTeam = state.teams[userTeamIdx];
  const bench = userTeam.party.filter((p) => !p.fainted && !userTeam.active.includes(p));

  if (bench.length === 0) {
    battleSession.phase = 'battle';
    return renderBattleTurn(state, userTeamIdx, engine);
  }

  let selectedPoke = bench[0];
  const letterIdx = 'abcd'.indexOf(t.trim());
  if (letterIdx >= 0 && letterIdx < bench.length) {
    selectedPoke = bench[letterIdx];
  } else {
    const nameMatch = bench.find((b) =>
      b.identifier.replace(/_/g, ' ').includes(t) || battleDisplayName(b.identifier).toLowerCase().includes(t)
    );
    if (nameMatch) selectedPoke = nameMatch;
  }

  const partyIdx = userTeam.party.indexOf(selectedPoke);
  const switchAction: BattleAction = { kind: 'switch', teamIdx: userTeamIdx, activeSlot: battleSession.awaitingSwitchSlot, partyIdx };
  const aiTeam1Actions = battleSession.ai.chooseActions(state, (1 - userTeamIdx) as 0 | 1);

  state.log = [];
  try {
    const result = battleSession.sim.executeTurn(state, [switchAction, ...aiTeam1Actions]);
    battleSession.state = result.state;
    const turnLog = result.state.log.map((l) => `  ${l}`).join('\n');
    if (result.winner !== null) {
      return [turnLog, endBattleSession(result.winner, engine)].filter(Boolean).join('\n');
    }
    battleSession.phase = 'battle';
    return [turnLog, renderBattleTurn(result.state, userTeamIdx, engine)].filter(Boolean).join('\n');
  } catch {
    battleSession.phase = 'battle';
    return renderBattleTurn(state, userTeamIdx, engine);
  }
}

function endBattleSession(winner: 0 | 1 | null, _engine: DeterministicEngine): string {
  const state = battleSession?.state;
  const userTeamIdx = battleSession?.userTeamIdx ?? 0;
  battleSession = null;

  if (!state || winner === null) return 'Bot: Batalha encerrada. Que mais posso analisar?';

  const won = winner === userTeamIdx;
  const resultLabel = won ? 'Vitória!' : 'Derrota.';
  const lines = [
    `Bot: ── Resultado: ${resultLabel} (Turno ${state.turn}) ──`,
    '',
    'Análise do time:',
  ];

  const userTeam = state.teams[userTeamIdx];
  for (const poke of userTeam.party) {
    const hpPct = Math.round((poke.currentHp / poke.maxHp) * 100);
    lines.push(`  • ${displayName(poke.identifier)} — ${poke.fainted ? 'desmaiou' : `${hpPct}% HP restante`}`);
  }

  lines.push('', 'Dicas:');
  const fainted = userTeam.party.filter((p) => p.fainted);
  if (fainted.length > 0) {
    lines.push(`  • ${fainted.map((p) => displayName(p.identifier)).join(', ')} desmaiaram — considere mais bulk ou Focus Sash`);
  }
  if (fainted.length === 0) lines.push('  • Nenhum desmaiou — time equilibrado!');
  if (state.field.trickRoom) lines.push('  • Trick Room estava ativo no fim — explore Pokémon lentos para aproveitar');

  lines.push('', 'Digite "simulador" para batalhar novamente!');
  return lines.join('\n');
}

// Study mode — static educational content
function handleStudyVGC(): string {
  return [
    'Bot: ── O que é VGC (Video Game Championship)? ──',
    '',
    'VGC é o formato oficial de torneios Pokémon da The Pokémon Company.',
    'É um formato de batalha Doubles (duplas): cada jogador envia 4 Pokémon e escolhe 2 por turno.',
    '',
    '── Regras básicas ──',
    '',
    'Equipe         6 Pokémon no total; 2 entram em campo simultaneamente.',
    'Nível          Todos os Pokémon nivelados para 50 automaticamente.',
    'Itens          Cada Pokémon pode segurar 1 item; sem repetição do mesmo item.',
    'Pokémon únicos Sem duplicatas de espécie nem de item na equipe.',
    'Tempo          15 min por partida; 45 s por jogada (Your Time).',
    '',
    '── Como funciona uma batalha ──',
    '',
    '1. Cada jogador escolhe 2 dos 4 Pokémon trazidos para o campo.',
    '2. Ambos os jogadores escolhem ataques simultaneamente (sem ver o do adversário).',
    '3. A ordem de ação é determinada pela Velocidade (ou Trick Room / prioridade).',
    '4. O objetivo é nocautear todos os Pokémon do adversário.',
    '',
    '── Mecânicas-chave no Doubles ──',
    '',
    'Fake Out       Flinch no 1° turno — garante turno livre ao parceiro.',
    'Spread moves   Golpes que atingem os dois alvos (Heat Wave, Earthquake, etc.).',
    'Redireção      Follow Me / Rage Powder desvia ataques single-target.',
    'Speed control  Tailwind dobra velocidade; Trick Room inverte a ordem.',
    'Intimidate     -1 Ataque em todos os inimigos ao entrar — um dos suportes mais usados.',
    '',
    'Para aprender mais: "mecânicas vgc", "papéis competitivos".',
    'Para testar seus conhecimentos: "quiz tipos", "quiz golpes", "quiz pokemon", "quiz velocidade".',
  ].join('\n');
}

function handleStudyTypes(engine: DeterministicEngine): string {
  const typeChart = engine.getTypeChart();
  const lines: string[] = ['Bot: ── Chart de Tipos — Cobertura Ofensiva ──', ''];
  for (const atkType of ALL_TYPES) {
    const byAtk = typeChart.get(atkType);
    if (!byAtk) continue;
    const se = ALL_TYPES.filter((d) => (byAtk.get(d) ?? 1) >= 2).map((d) => TYPE_LABELS[d]);
    const nve = ALL_TYPES.filter((d) => (byAtk.get(d) ?? 1) < 1 && (byAtk.get(d) ?? 1) > 0).map((d) => TYPE_LABELS[d]);
    const imm = ALL_TYPES.filter((d) => (byAtk.get(d) ?? 1) <= 0).map((d) => TYPE_LABELS[d]);
    lines.push(`${TYPE_LABELS[atkType].padEnd(10)} SE: ${se.join(', ') || '—'}`);
    if (nve.length) lines.push(`${' '.repeat(11)}NVE: ${nve.join(', ')}`);
    if (imm.length) lines.push(`${' '.repeat(11)}Imune: ${imm.join(', ')}`);
  }
  return lines.join('\n');
}

function handleStudyRoles(): string {
  return [
    'Bot: ── Papéis Competitivos no VGC ──',
    '',
    '⚔  Physical Sweeper  — Atk alto, velocidade alta. Ameaça direta com golpes físicos.',
    '   Ex: Garchomp, Urshifu, Kingambit',
    '',
    '✨  Special Sweeper  — SpAtk alto, velocidade alta. Dano em área (Heat Wave, Muddy Water).',
    '   Ex: Flutter Mane, Miraidon, Kyogre',
    '',
    '🛡  Physical Wall    — Def alta, HP alto. Aguenta dano físico e suporta o time.',
    '   Ex: Amoonguss, Incineroar, Dondozo',
    '',
    '🛡  Special Wall     — SpDef alta, HP alto. Aguenta dano especial.',
    '   Ex: Blissey, Goodra, Cresselia',
    '',
    '⚡  Lead / Setter    — Entra primeiro para criar condição (Sol, Chuva, TR, Tailwind).',
    '   Ex: Torkoal (Sol), Pelipper (Chuva), Mimikyu (TR setter), Whimsicott (Tailwind)',
    '',
    '🤝  Support/Utility  — Fake Out, Redireção, Wide Guard, Protect; habilidades como Intimidate.',
    '   Ex: Togekiss (Follow Me), Clefairy (Friend Guard), Incineroar (Intimidate)',
    '',
    'Dica: um time equilibrado tem 1-2 win conditions (sweepers) + suporte + controle de velocidade.',
  ].join('\n');
}

function handleStudyMechanics(): string {
  return [
    'Bot: ── Mecânicas de Velocidade no VGC ──',
    '',
    'Tailwind          Dobra a velocidade da equipe por 4 turnos. Quem age antes o seta.',
    'Trick Room        Inverte a ordem de ação por 5 turnos — Pokémon lentos agem primeiro.',
    'Paralisia         Reduz Vel a ~25%; pode impedir ação (30% chance).',
    'Sticky Web        -1 Vel ao entrar; não afeta Voadores ou Levitação.',
    '',
    '── Controle de Campo ──',
    '',
    'Tailwind          Suporte físico (Whimsicott, Pelipper, Tornadus). Dura 4 turnos.',
    'Electric Terrain  +30% golpes Elétricos no chão; bloqueia sono. (Miraidon, Pincurchin)',
    'Grassy Terrain    +30% Planta; recupera 1/8 HP/turno. (Rillaboom)',
    'Misty Terrain     Bloqueia status; reduz Dragão ×0.5. (Misty Surge)',
    'Psychic Terrain   +30% Psíquico; bloqueia moves prioritários. (Flutter Mane Indireto)',
    '',
    '── Redireção ──',
    '',
    'Follow Me / Rage Powder  Redireciona ataques single-target para o usuário.',
    '  • Follow Me: qualquer Pokémon; não funciona em campo de tempestade.',
    '  • Rage Powder: apenas Planta; imune a Grass-type e Overcoat.',
    '',
    '── Fake Out ──',
    '',
    'Flinch no 1° turno ao entrar em campo — garante 1 turno livre ao parceiro.',
    'Não funciona contra Inner Focus, Shield Dust, ou Pokémon que já agiram.',
    '',
    'Para testar seu conhecimento: "quiz de velocidade" — Tailwind, Trick Room, prioridade e habilidades de speed.',
  ].join('\n');
}

function handleOnboarding(): string {
  return [
    'Bot: Bem-vindo ao Pokemon VGC! Aqui esta um guia rapido para comecar:',
    '',
    'Formato VGC (Video Game Championships)',
    '  Batalhas duplas: 2 Pokemon de cada lado em campo ao mesmo tempo.',
    '  Time de 6, voce escolhe 4 na hora de batalhar.',
    '  Geralmente 1 Pokemon lendario restrito por time (depende da serie).',
    '',
    'Conceitos fundamentais',
    '  Speed control: quem age primeiro.',
    '    Tailwind  — dobra a velocidade da equipe por 4 turnos (rapidos primeiro).',
    '    Trick Room — inverte a ordem por 5 turnos (lentos agem primeiro).',
    '  Lead: os 2 Pokemon que voce manda para o campo no inicio.',
    '  Back: os 2 que ficam reserva e entram depois.',
    '  Win condition: a estrategia central do seu time.',
    '    Ex.: setup de Calm Mind + Follow Me, ou Tailwind + atacantes rapidos.',
    '',
    'Para aprender mais, pergunte:',
    '  "regras do VGC"              — formato completo',
    '  "tabela de tipos"            — efetividades tipo x tipo',
    '  "papeis competitivos"        — setter, sweeper, support, pivot',
    '  "como funciona o trick room" — mecanicas especificas',
    '  "perfil competitivo do [pokemon]" — analise de qualquer Pokemon',
    '',
    'Modos de quiz para treinar:',
    '  "quiz de tipos"              — fraquezas, resistencias e imunidades',
    '  "quiz de golpes"             — qual tipo e cada golpe',
    '  "quiz de pokemon"            — identifique o Pokemon pelos stats',
    '  "quiz de velocidade"         — Tailwind, Trick Room, prioridade e speed control',
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
  '• "quiz tipos" / "quiz golpes" / "quiz pokemon" / "quiz velocidade" (modo quiz)',
  '• "estudar tipos" / "papéis competitivos" / "mecânicas vgc" (modo estudo)',
  '• "simulador" (simulador de batalha VGC — teste seu time)',
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
  if (/\bperfil\b|\bpapel\b/.test(t)) return 'competitive_profile';
  if (/me\s+fala\s+(sobre|do|de|sobre\s+o)|me\s+explica\b|\bexplica\b|\banalisa\b|\banalise\b/.test(t)) return 'competitive_profile';
  if (/\bcomo\s+usar\b/.test(t)) return 'competitive_profile';
  // "é/e X bom" — PT-BR informal assessment (é normalizes to e via NFD)
  if (/\be\s+(o\s+|a\s+)?\w+\s+bom\b|\bdevo\s+usar\b|\bvale\s+(a\s+pena\s+)?usar\b/.test(t)) return 'competitive_profile';

  // Pair synergy (BEFORE synergy patterns — more specific; requires 2 pokémon + explicit connector)
  if (/dupla\b/.test(t) && extractTwoPokemon(t) !== null) return 'pair_synergy';
  // Natural language pair: "X e Y juntos", "X junto com Y", "X e Y funcionam juntos"
  if (/\bjunto[s]?\b/.test(t) && extractTwoPokemon(t) !== null) return 'pair_synergy';
  // EN pair patterns: "how good is X with Y", "how well does X work with Y", "X with Y" (two Pokémon)
  if (/how\s+good\s+is\b|how\s+well\s+does\b/.test(t) && extractTwoPokemon(t) !== null) return 'pair_synergy';
  if (/\bwith\b/.test(t) && extractTwoPokemon(t) !== null) return 'pair_synergy';

  // Synergy
  if (/sinergi|parceir|combina.*com|quem.*bom.*junto|quem.*junto.*com/.test(t)) return 'synergy';
  if (/com\s+quem|quem\s+vai.*bem|vai\s+bem\s+com|funciona.*junto|funciona.*com\b/.test(t)) return 'synergy';
  if (/dupla\b/.test(t)) return 'synergy';

  // Items
  if (/held.*item|item.*para|iten[s]?.*para|melhor.*item|melhor.*iten|equipamento|item.*recomend|iten[s]?.*recomend/.test(t)) return 'held_item';

  // Bad matchup analysis — user asks about threats to their own Pokémon (BEFORE counter + weak_to_type)
  if (/dificuldade.*usando|usando.*dificuldade|dif[ií]cil.*usar/.test(t)) return 'bad_matchup';
  if (/contra quem.*sofre|contra quem.*perde|quem.*derrota\b/.test(t)) return 'bad_matchup';
  if (/fraqueza(s)?\s+do\b|ponto(s)?\s+fraco(s)?\s+do\b/.test(t) && !hasTypeToken(t)) return 'bad_matchup';
  if (/counters?\s+(do|para|de)\b|o que\s+countera|quem\s+countera/.test(t)) return 'bad_matchup';
  if (/matchup\s+ruim|mau\s+matchup|bad\s+matchup/.test(t)) return 'bad_matchup';
  if (/o que\s+amea[cç]a\b|quem\s+amea[cç]a\b/.test(t)) return 'bad_matchup';

  // Type weakness queries (BEFORE counter — "quem e fraco contra X" would match counter's "quem.*contra")
  if (/fraco.*contra|fraqueza.*a |fraqueza.*ao|fraqueza.*do tipo|quem.*e.*fraco|quem.*fraco|quem.*sofre|pokemon.*fraco|fracos.*a /.test(t) && hasTypeToken(t)) return 'weak_to_type';

  // Type coverage (EN) — checked BEFORE counter to avoid "what beats dragon type" → counter
  if (/what\s+beats?\s+\w+\s+type\b|what\s+is\s+super\s+effective\s+against|what\s+type.*super\s+effective/.test(t)) return 'type_coverage';
  if (/cobertura.*tipo|tipo.*cobertura|o que.*bate.*tipo|forte.*contra.*tipo|o que.*vence.*tipo/.test(t)) return 'type_coverage';
  // Counter
  if (/quem.*bate|quem.*vence|quem.*contra|counter.*para|como.*derrotar|como.*bater/.test(t)) return 'counter';
  if (/how\s+to\s+beat\b|how\s+to\s+counter\b|what\s+counters?\b/.test(t)) return 'counter';
  if (/what\s+beats?\s+\w+(?:\s+\w+)?\?/.test(t) && !hasTypeToken(t)) return 'counter';
  if (/pokemon.*(?:do|de|com).*tipo|(?:do|de|com).*tipo.*pokemon|listar.*tipo|que.*tipo/.test(t)) return 'type_query';

  // Generation — region names map to specific generations
  if (/lend[aá]r|legend[aá]r|m[ií]tico|mythic/.test(t)) return 'legendary_query';
  if (/(ger[ae]?[cç][aã]o?|gen)\s*\d/.test(t)) return 'generation_query';
  if (/\b(kanto|johto|hoenn|sinnoh|unova|kalos|alola|galar|paldea)\b/.test(t)) return 'generation_query';

  // Evolution
  if (/evolu[çc]|como.*evol|cadeia.*evol|quando.*evol/.test(t)) return 'evolution';

  // Movelist / ability list
  if (/que.*golpe.*aprende|golpe.*aprende|movelist|moveset.*d[eo]|golpes.*do|ataques.*do|golpes.*aprende/.test(t)) return 'movelist';
  if (/habilidade.*de|ability.*de|que.*habilidade.*tem|habilidades.*do/.test(t)) return 'ability_info_pokemon';

  // VGC / Doubles format overview — must come before generic "como funciona" catch-all
  if (/\bvgc\b/.test(t) && /como|o\s+que|explica|regras?|formato|funciona|e\s+o/.test(t)) return 'study_vgc';
  if (/\bdoubles?\b/.test(t) && /como|o\s+que|regras?|formato|funciona/.test(t)) return 'study_vgc';
  if (/formato.*pokemon|pokemon.*formato|regras.*batalha|batalha.*dupla/.test(t)) return 'study_vgc';

  // Specific move or ability info
  if (/o que.*faz|para que serve|como.*funciona/.test(t)) {
    if (/speed\s*control|win\s*condi[ct]|tailwind|trick\s*room|fake\s*out|redirect|terrain|pivot\s+vgc|lead\s+vgc/.test(t)) return 'study_mechanics';
    if (/habilidade|ability|passiva/.test(t)) return 'ability_info';
    if (/golpe|move|ataque/.test(t)) return 'move_info';
    // Try ability first — avoids substring collisions (e.g. "protosynthesis" contains "synthesis")
    if (extractAbilityName(t)) return 'ability_info';
    if (extractMoveName(t)) return 'move_info';
    return 'ability_info'; // default to ability when truly ambiguous
  }
  if (/o que.*[eé]\b/.test(t)) {
    if (/speed\s*control|win\s*condi[ct]|tailwind|trick\s*room|fake\s*out|redirect|terrain|pivot\s+vgc|lead\s+vgc/.test(t)) return 'study_mechanics';
    if (/habilidade|ability/.test(t)) return 'ability_info';
    // If the text matches a known ability identifier, prefer ability_info
    if (extractAbilityName(t)) return 'ability_info';
    return 'move_info'; // assume move if no qualifier
  }

  // Generic stats/detail
  if (/info|dados|detalhe|stat|base stat|atributo/.test(t)) return 'detail';

  // Quiz
  {
    const EASY_RE = /f[aá]cil|easy|\b1\b/;
    const MED_RE = /m[eé]di[oa]?|medium|\b2\b/;
    const HARD_RE = /dif[ií]cil|hard|\b3\b/;
    if (/\bquiz\s+(de\s+)?(tipos?|type)\b/.test(t)) {
      if (HARD_RE.test(t)) return 'quiz_types_hard';
      if (MED_RE.test(t)) return 'quiz_types_med';
      if (EASY_RE.test(t)) return 'quiz_types_easy';
      return 'quiz_types';
    }
    if (/\bquiz\s+(de\s+)?(golpes?|moves?|ataques?)\b/.test(t)) {
      if (HARD_RE.test(t)) return 'quiz_moves_hard';
      if (MED_RE.test(t)) return 'quiz_moves_med';
      if (EASY_RE.test(t)) return 'quiz_moves_easy';
      return 'quiz_moves';
    }
    if (/\bquiz\s+(de\s+)?(pokemon|pokemons?)\b/.test(t)) {
      if (HARD_RE.test(t)) return 'quiz_pokemon_hard';
      if (MED_RE.test(t)) return 'quiz_pokemon_med';
      if (EASY_RE.test(t)) return 'quiz_pokemon_easy';
      return 'quiz_pokemon';
    }
    if (/\bquiz\s+(de\s+)?(velocidade|speed|controle|prioridade|tailwind|trick\s*room|mecanicas?|speed\s*ctrl)\b/.test(t)) {
      if (HARD_RE.test(t)) return 'quiz_speed_hard';
      if (MED_RE.test(t)) return 'quiz_speed_med';
      if (EASY_RE.test(t)) return 'quiz_speed_easy';
      return 'quiz_speed';
    }
  }
  if (/^\s*quiz\s*$/.test(t) || /\bmode\s+quiz\b|\bquiz\s+mode\b/.test(t)) return 'quiz_lobby';
  if (/\bquiz\b/.test(t)) return 'quiz_lobby'; // bare quiz keyword → lobby

  if (/estudar?\s+tipos?|chart\s+de\s+tipos?|tabela\s+de\s+tipos?|tipo.*efetividade/.test(t)) return 'study_types';
  if (/pap[eé]is?\s+(competitiv|vgc)|roles?\s+vgc|fun[cç][oõ]es?\s+competitiv/.test(t)) return 'study_roles';
  if (/mecanicas?\s+vgc|como\s+funciona\s+(tailwind|trick\s*room|redirect|fake\s+out|terrain)|veloc.*vgc|speed\s+control\s+vgc/.test(t)) return 'study_mechanics';
  if (/como\s+funciona(m)?\s+(o\s+|a\s+)?(meta|speed\s+control|win\s+con|setup|pivot|lead\s+vgc|back\s+vgc)/.test(t)) return 'study_mechanics';
  if (/o\s+que\s+[eé]\s+(speed\s+control|win\s+condition|tempo\s+vgc|pivot|back\s+position|support\s+vgc)/.test(t)) return 'study_mechanics';

  // Battle simulator
  if (/\b(simulad[oa]r|battle\s*sim|testar?\s+time|batalha\s+vgc|simul[au]lar?\s+batalha?|jogar\s+contra|testar?\s+equipe)\b/.test(t)) return 'battle_sim';

  // Onboarding — new player intro queries
  if (/sou\s+(um\s+)?(novo|iniciante)|novo\s+(no|ao|em|jogador|player)|nunca\s+(joguei|jogar)|como\s+come[cç]ar|por\s+onde\s+come[cç]ar/.test(t)) return 'onboarding';
  if (/me\s+explica\s+(o\s+)?(b[aá]sico|basicos?|as\s+regras|conceitos|o\s+jogo)|explica\s+(o\s+b[aá]sico|conceitos\s+b[aá]sicos)/.test(t)) return 'onboarding';
  if (/quero\s+(aprender|entender|saber)\s+(pokemon\s+competitiv|vgc|como\s+funciona\s+o\s+vgc)/.test(t)) return 'onboarding';
  if (/(?:explain|teach\s+me|i(?:'m|\s+am)\s+(?:new|a\s+beginner)|beginner|just\s+started?|never\s+played?)\s+(?:pokemon|vgc|competitive)/.test(t)) return 'onboarding';

  return 'unknown';
}

async function handleNLText(text: string, engine: DeterministicEngine): Promise<string> {
  const t = text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  let intent = detectIntent(t);

  // NLU fallback: when regex couldn't identify the intent, ask the ML classifier
  if (intent === 'unknown' && nluReady) {
    const nluResult = await queryNLU(text);
    if (nluResult.confidence >= NLU_CONFIDENCE_THRESHOLD) {
      intent = nluResult.intent;
      process.stderr.write(`[bridge] nlu fallback: "${text.slice(0, 40)}" → ${intent} (conf=${nluResult.confidence.toFixed(2)})\n`);
    }
  }

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
      return await handleSynergySuggestions(pokemonId, engine);
    case 'pair_synergy': {
      const pair = extractTwoPokemon(t);
      if (!pair) return 'Bot: Especifique dois Pokémon. Ex: "dupla Garchomp + Togekiss"';
      return await handlePairSynergy(pair[0], pair[1], engine);
    }
    case 'held_item':
      if (!pokemonId) return 'Bot: Qual Pokémon? Ex: "item para Garchomp"';
      return handleHeldItemRecommendations(pokemonId, engine);
    case 'bad_matchup':
      if (!pokemonId) return 'Bot: Qual Pokémon? Ex: "contra quem Gyarados teria dificuldade"';
      return handleBadMatchups(pokemonId, engine);
    case 'counter':
      // "trick room" is a game mechanic, not a Pokémon — fuzzy match of "room"→"rotom" is a false positive
      if (/trick\s*room/.test(t)) return 'Bot: Para bater Trick Room: use Pokémon rápidos com Taunt (bloqueia setup), Imprison (bloqueia TR), ou golpes de prioridade (Fake Out, Sucker Punch). Equipes rápidas com Tailwind também superam a janela de TR.';
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
    case 'quiz_lobby':
      return handleQuizLobby();
    case 'quiz_types':
      return handleDifficultySelect('type_eff');
    case 'quiz_moves':
      return handleDifficultySelect('move_type');
    case 'quiz_pokemon':
      return handleDifficultySelect('pokemon_stats');
    case 'quiz_speed':
      return handleDifficultySelect('speed_ctrl');
    case 'quiz_types_easy': return startQuizSession('type_eff', 1, engine);
    case 'quiz_types_med':  return startQuizSession('type_eff', 2, engine);
    case 'quiz_types_hard': return startQuizSession('type_eff', 3, engine);
    case 'quiz_moves_easy': return startQuizSession('move_type', 1, engine);
    case 'quiz_moves_med':  return startQuizSession('move_type', 2, engine);
    case 'quiz_moves_hard': return startQuizSession('move_type', 3, engine);
    case 'quiz_pokemon_easy': return startQuizSession('pokemon_stats', 1, engine);
    case 'quiz_pokemon_med':  return startQuizSession('pokemon_stats', 2, engine);
    case 'quiz_pokemon_hard': return startQuizSession('pokemon_stats', 3, engine);
    case 'quiz_speed_easy': return startQuizSession('speed_ctrl', 1, engine);
    case 'quiz_speed_med':  return startQuizSession('speed_ctrl', 2, engine);
    case 'quiz_speed_hard': return startQuizSession('speed_ctrl', 3, engine);
    case 'battle_sim':
      return startBattleSimulator(engine);
    case 'study_vgc':
      return handleStudyVGC();
    case 'study_types':
      return handleStudyTypes(engine);
    case 'study_roles':
      return handleStudyRoles();
    case 'study_mechanics':
      return handleStudyMechanics();
    case 'onboarding':
      return handleOnboarding();
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
async function handleCommand(input: string, engine: DeterministicEngine): Promise<string> {
  const raw = input.trim();
  if (raw === '__PING__') return `pong v${BRIDGE_VERSION}`;
  if (raw === '__RESET__') {
    quizSession = null;
    pendingQuizType = null;
    battleSession = null;
    return 'Bot: Estado da conversa reiniciado.';
  }

  // Battle simulator intercept — routes all input when session is active
  if (battleSession) {
    const bLower = raw.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim();
    // Allow __PING__ and JSON commands through
    if (!raw.startsWith('__') && !raw.startsWith('{')) {
      if (battleSession.phase === 'team_build') return handleTeamBuildInput(raw, engine);
      if (battleSession.phase === 'pick_lead')  return handlePickLeadInput(raw, engine);
      if (battleSession.phase === 'battle')     return handleBattleMoveInput(raw, engine);
      if (battleSession.phase === 'awaiting_switch') return handleSwitchInput(raw, engine);
      if (battleSession.phase === 'post_battle') {
        battleSession = null; // any input exits post-battle
      }
    }
    void bLower; // suppress unused warning
  }

  // Pre-session intercept — user selected a quiz type, waiting for difficulty choice
  if (pendingQuizType !== null) {
    const d = raw.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim();
    if (/^(f[aá]cil|easy|1)$/.test(d)) return startQuizSession(pendingQuizType, 1, engine);
    if (/^(m[eé]di[oa]?|medium|2)$/.test(d)) return startQuizSession(pendingQuizType, 2, engine);
    if (/^(dif[ií]cil|hard|3)$/.test(d)) return startQuizSession(pendingQuizType, 3, engine);
    if (/^(quiz|cancelar|cancel|voltar|menu)$/.test(d)) { pendingQuizType = null; return handleQuizLobby(); }
    pendingQuizType = null; // any other input — cancel pending and fall through
  }

  // Quiz intercept — when a quiz is active, route all input here first
  if (quizSession) {
    const lower = raw.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    if (/^(parar|sair|quit|stop|fim|encerrar|end|q)$/.test(lower)) {
      return endQuizSession();
    }
    if (/^(proxim|next|continuar|mais um|outr[ao]|skip|p)$/.test(lower)) {
      quizSession.streak = 0;
      return [
        `Bot: Resposta: ${quizSession.answerDisplay}`,
        '',
        nextQuizQuestion(engine),
      ].join('\n');
    }
    // Check if it looks like a new quiz/study command — let it fall through
    const tLower = lower;
    const isNewCommand = /\bquiz\b|\bestud[ao]r?\b|pap[eé]is|mecanicas?/.test(tLower);
    if (!isNewCommand) {
      return checkQuizAnswer(raw, engine);
    }
  }

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
      return JSON.stringify({ ok: true, detail: buildDetailEntry(p, engine.getTypeChart(), engine) });
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e) });
    }
  }

  if (raw === '') return 'Bot: Digite uma pergunta para continuar.';
  return await handleNLText(raw, engine);
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
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

  try {
    buildNNMoveArchetypeMap(engine);
  } catch (e) {
    process.stderr.write(`[bridge] WARN: nn move archetype map failed: ${e}\n`);
  }

  // Start Python inference processes in background — readline loop starts immediately.
  // Bridge responds to commands right away; NLU/NN activate once models are loaded.
  startNNProcess().catch((e) => process.stderr.write(`[bridge] nn start error: ${e}\n`));
  startNLUProcess().catch((e) => process.stderr.write(`[bridge] nlu start error: ${e}\n`));

  process.stderr.write(`[bridge] ready  db=${DB_PATH}\n`);

  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  let activeHandlers = 0;
  let rlClosed = false;

  function bridgeCleanup() {
    if (pyProcess) { try { pyProcess.stdin!.write(JSON.stringify({ type: 'exit' }) + '\n'); } catch { /* ignore */ } }
    engine.close();
    process.exit(0);
  }

  rl.on('line', async (line) => {
    activeHandlers++;
    try {
      writeResponse(await handleCommand(line, engine));
    } catch (e) {
      writeResponse(`Bot: Ocorreu um erro interno (${e}).`);
    } finally {
      activeHandlers--;
      if (rlClosed && activeHandlers === 0) bridgeCleanup();
    }
  });

  rl.on('close', () => {
    rlClosed = true;
    if (activeHandlers === 0) bridgeCleanup();
  });
}

main().catch((e) => {
  process.stderr.write(`[bridge] fatal: ${e}\n`);
  process.exit(1);
});
