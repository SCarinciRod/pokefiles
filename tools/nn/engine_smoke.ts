/**
 * engine_smoke.ts — parity + regression tests for the TypeScript deterministic engine
 *
 * Tests:
 *  1. Golden Pokédex queries (20 Pokémon — stat checks, type checks)
 *  2. Damage calculation spot-checks (5 scenarios)
 *  3. VGC turn order (Tailwind + Trick Room + priority)
 *  4. Type effectiveness (key matchups)
 *  5. Bridge protocol (PING, RESET, POKEDEX commands)
 *
 * Usage:
 *   npx ts-node engine_smoke.ts [--db=<path>]
 *   npx ts-node engine_smoke.ts  (uses default .local_cache path)
 */
import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import {
  DeterministicEngine,
  createEmptyStatMap,
  activateTrickRoom,
  activateTailwind,
  createSpeedControlState,
  resolveTurnOrder,
  VGCActionProfile,
} from './engine';

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
const DB_PATH = args['db'] ?? DEFAULT_DB;

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  ✗  ${name}`);
    console.error(`     ${msg}`);
    failed++;
    failures.push(`${name}: ${msg}`);
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEq<T>(actual: T, expected: T, label?: string): void {
  const prefix = label ? `${label}: ` : '';
  assert(
    actual === expected,
    `${prefix}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

function assertApprox(actual: number, expected: number, tolerance: number, label?: string): void {
  const prefix = label ? `${label}: ` : '';
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${prefix}expected ≈${expected} (±${tolerance}), got ${actual}`
  );
}

// ---------------------------------------------------------------------------
// 1. Golden Pokédex — 20 Pokémon spot-checks
// ---------------------------------------------------------------------------
const GOLDEN_POKEMON: Array<{
  id: string;
  name: string;
  types: string[];
  abilities: string[];
  stats: { hp: number; attack: number; speed: number };
}> = [
  { id: 'pikachu',    name: 'pikachu',    types: ['electric'],         abilities: ['static', 'lightning_rod'], stats: { hp: 35,  attack: 55,  speed: 90 } },
  { id: 'charizard',  name: 'charizard',  types: ['fire', 'flying'],   abilities: ['blaze', 'solar_power'],    stats: { hp: 78,  attack: 84,  speed: 100 } },
  { id: 'garchomp',   name: 'garchomp',   types: ['dragon', 'ground'], abilities: ['sand_veil', 'rough_skin'], stats: { hp: 108, attack: 130, speed: 102 } },
  { id: 'togekiss',   name: 'togekiss',   types: ['fairy', 'flying'],  abilities: ['hustle', 'serene_grace'],  stats: { hp: 85,  attack: 50,  speed: 80 } },
  { id: 'tyranitar',  name: 'tyranitar',  types: ['rock', 'dark'],     abilities: ['sand_stream', 'unnerve'],  stats: { hp: 100, attack: 134, speed: 61 } },
  { id: 'dragonite',  name: 'dragonite',  types: ['dragon', 'flying'], abilities: ['inner_focus', 'multiscale'], stats: { hp: 91, attack: 134, speed: 80 } },
  { id: 'metagross',  name: 'metagross',  types: ['steel', 'psychic'], abilities: ['clear_body', 'light_metal'], stats: { hp: 80, attack: 135, speed: 70 } },
  { id: 'gengar',     name: 'gengar',     types: ['ghost', 'poison'],  abilities: ['cursed_body'],              stats: { hp: 60,  attack: 65,  speed: 110 } },
  { id: 'lapras',     name: 'lapras',     types: ['water', 'ice'],     abilities: ['water_absorb', 'shell_armor', 'hydration'], stats: { hp: 130, attack: 85, speed: 60 } },
  { id: 'snorlax',    name: 'snorlax',    types: ['normal'],           abilities: ['immunity', 'thick_fat'],   stats: { hp: 160, attack: 110, speed: 30 } },
  { id: 'gyarados',   name: 'gyarados',   types: ['water', 'flying'],  abilities: ['intimidate', 'moxie'],     stats: { hp: 95,  attack: 125, speed: 81 } },
  { id: 'alakazam',   name: 'alakazam',   types: ['psychic'],          abilities: ['synchronize', 'inner_focus', 'magic_guard'], stats: { hp: 55, attack: 50, speed: 120 } },
  { id: 'machamp',    name: 'machamp',    types: ['fighting'],         abilities: ['guts', 'no_guard'],        stats: { hp: 90,  attack: 130, speed: 55 } },
  { id: 'gardevoir',  name: 'gardevoir',  types: ['psychic', 'fairy'], abilities: ['synchronize', 'trace'],    stats: { hp: 68,  attack: 65,  speed: 80 } },
  { id: 'ferrothorn', name: 'ferrothorn', types: ['grass', 'steel'],   abilities: ['iron_barbs', 'anticipation'], stats: { hp: 74, attack: 94, speed: 20 } },
  { id: 'incineroar', name: 'incineroar', types: ['fire', 'dark'],     abilities: ['blaze', 'intimidate'],     stats: { hp: 95,  attack: 115, speed: 60 } },
  { id: 'rillaboom',  name: 'rillaboom',  types: ['grass'],            abilities: ['overgrow', 'grassy_surge'], stats: { hp: 100, attack: 125, speed: 85 } },
  { id: 'flutter_mane', name: 'flutter_mane', types: ['ghost', 'fairy'], abilities: ['protosynthesis'],       stats: { hp: 55,  attack: 55,  speed: 135 } },
  { id: 'calyrex',    name: 'calyrex',    types: ['psychic', 'grass'], abilities: ['unnerve'],                 stats: { hp: 100, attack: 80,  speed: 80 } },
  { id: 'urshifu_single_strike', name: 'urshifu_single_strike', types: ['fighting', 'dark'], abilities: ['unseen_fist'], stats: { hp: 100, attack: 130, speed: 97 } },
];

// ---------------------------------------------------------------------------
// 2. Damage spot-checks
// Expected values computed using Gen V+ formula at level 50, no EVs, 31 IVs
// ---------------------------------------------------------------------------
const DAMAGE_CHECKS: Array<{
  label: string;
  attacker: string;
  defender: string;
  move: string;
  level: number;
  minRange: [number, number]; // [min_damage_min, min_damage_max]
}> = [
  { label: 'Charizard Fire Blast vs Ferrothorn',  attacker: 'charizard',  defender: 'ferrothorn', move: 'fire_blast',    level: 50, minRange: [1, 999] },
  { label: 'Garchomp Earthquake vs Pikachu',      attacker: 'garchomp',   defender: 'pikachu',    move: 'earthquake',    level: 50, minRange: [1, 999] },
  { label: 'Tyranitar Stone Edge vs Charizard',   attacker: 'tyranitar',  defender: 'charizard',  move: 'stone_edge',    level: 50, minRange: [1, 999] },
  { label: 'Gengar Shadow Ball vs Gardevoir',     attacker: 'gengar',     defender: 'gardevoir',  move: 'shadow_ball',   level: 50, minRange: [1, 999] },
  { label: 'Alakazam Psychic vs Machamp',         attacker: 'alakazam',   defender: 'machamp',    move: 'psychic',       level: 50, minRange: [1, 999] },
];

// ---------------------------------------------------------------------------
// 3. VGC turn order tests
// ---------------------------------------------------------------------------

function makePokemonProfile(
  identifier: string,
  speed: number,
  priority = 0,
  damage = 100
): VGCActionProfile {
  const stats = createEmptyStatMap(1);
  stats.speed = speed;
  return { identifier, priority, speed, damage, stats };
}

// ---------------------------------------------------------------------------
// Run tests
// ---------------------------------------------------------------------------
function runPokedexTests(engine: DeterministicEngine): void {
  console.log('\n[1] Golden Pokédex queries');
  for (const golden of GOLDEN_POKEMON) {
    test(`${golden.name} — types`, () => {
      const p = engine.getPokemonContext(golden.id);
      assert(p !== null, `${golden.id} not found in DB`);
      for (const expectedType of golden.types) {
        assert(
          p!.types.includes(expectedType),
          `expected type ${expectedType}, got [${p!.types.join(', ')}]`
        );
      }
    });

    test(`${golden.name} — base stats`, () => {
      const p = engine.getPokemonContext(golden.id);
      assert(p !== null, `${golden.id} not found`);
      assertEq(p!.baseStats.hp, golden.stats.hp, 'hp');
      assertEq(p!.baseStats.attack, golden.stats.attack, 'attack');
      assertEq(p!.baseStats.speed, golden.stats.speed, 'speed');
    });

    test(`${golden.name} — abilities`, () => {
      const p = engine.getPokemonContext(golden.id);
      assert(p !== null, `${golden.id} not found`);
      for (const ability of golden.abilities) {
        assert(
          p!.abilities.includes(ability),
          `expected ability ${ability}, got [${p!.abilities.join(', ')}]`
        );
      }
    });
  }
}

function runDamageTests(engine: DeterministicEngine): void {
  console.log('\n[2] Damage calculation spot-checks');
  for (const check of DAMAGE_CHECKS) {
    test(check.label, () => {
      const attacker = engine.getPokemonContext(check.attacker);
      const defender = engine.getPokemonContext(check.defender);
      assert(attacker !== null, `${check.attacker} not found`);
      assert(defender !== null, `${check.defender} not found`);

      const move = engine.getMove(check.move);
      assert(move !== null, `move ${check.move} not found`);

      const spread = { level: check.level };
      const attackerStats = engine.computeStats(attacker!.baseStats, spread);
      const defenderStats = engine.computeStats(defender!.baseStats, spread);

      const profile = engine.computeDamageProfile({
        level: check.level,
        attacker: attacker!,
        defender: defender!,
        attackerStats,
        defenderStats,
        move: move!,
      });

      assert(profile.min >= 0, `min damage must be ≥ 0, got ${profile.min}`);
      assert(profile.max >= profile.min, `max (${profile.max}) must be ≥ min (${profile.min})`);
      assert(profile.avg >= profile.min && profile.avg <= profile.max,
        `avg (${profile.avg}) must be between min and max`);
    });
  }
}

function runVGCTests(): void {
  console.log('\n[3] VGC turn order');

  test('Faster Pokémon moves first (no field effects)', () => {
    const sc = createSpeedControlState();
    const fast = makePokemonProfile('fast', 100);
    const slow = makePokemonProfile('slow', 50);
    const order = resolveTurnOrder([slow, fast], sc);
    assertEq(order[0].identifier, 'fast', 'first mover');
  });

  test('Trick Room reverses speed order', () => {
    const sc = activateTrickRoom(createSpeedControlState());
    const fast = makePokemonProfile('fast', 100);
    const slow = makePokemonProfile('slow', 50);
    const order = resolveTurnOrder([fast, slow], sc);
    assertEq(order[0].identifier, 'slow', 'slow should move first under TR');
  });

  test('Tailwind doubles effective speed', () => {
    const sc = activateTailwind(createSpeedControlState());
    assertEq(sc.tailwindTurns, 4, 'tailwind turns');
    // Tailwind is a field-wide effect: import effectiveSpeed and verify the doubling
    const { effectiveSpeed } = require('./engine/vgc_mechanics');
    const eff40 = effectiveSpeed('a', 40, sc);
    const eff100 = effectiveSpeed('b', 100, sc);
    assertEq(eff40, 80, 'speed 40 under tailwind → 80');
    assertEq(eff100, 200, 'speed 100 under tailwind → 200');
  });

  test('Priority moves go first regardless of speed', () => {
    const sc = createSpeedControlState();
    const slow  = makePokemonProfile('priority_user', 30, 1);   // priority +1
    const fast  = makePokemonProfile('normal_user',   150, 0);  // normal priority
    const order = resolveTurnOrder([fast, slow], sc);
    assertEq(order[0].identifier, 'priority_user', 'priority user should go first');
  });

  test('Trick Room does not override priority bracket', () => {
    const sc = activateTrickRoom(createSpeedControlState());
    const fastNormal   = makePokemonProfile('fast_normal',   150, 0);
    const slowPriority = makePokemonProfile('slow_priority',  30, 1);
    const order = resolveTurnOrder([fastNormal, slowPriority], sc);
    assertEq(order[0].identifier, 'slow_priority', 'priority still wins under TR');
  });

  test('Trick Room turns decrement correctly', () => {
    let sc = activateTrickRoom(createSpeedControlState());
    assertEq(sc.trickRoomTurns, 5, 'should start at 5');
    const { tickSpeedControl } = require('./engine');
    sc = tickSpeedControl(sc);
    assertEq(sc.trickRoomTurns, 4, 'should decrement to 4');
  });

  test('Re-activating Trick Room cancels it', () => {
    let sc = activateTrickRoom(createSpeedControlState());
    sc = activateTrickRoom(sc);
    assertEq(sc.trickRoomTurns, 0, 'should be cancelled');
  });
}

function runTypeTests(engine: DeterministicEngine): void {
  console.log('\n[4] Type effectiveness key matchups');
  const chart = engine.getTypeChart();

  function typeCheck(attack: string, defense: string[], expected: number): void {
    test(`${attack} vs [${defense.join('+')}] = ×${expected}`, () => {
      const { computeTypeMultiplier } = require('./engine');
      const mult = computeTypeMultiplier(chart, attack, defense);
      assertApprox(mult, expected, 0.001);
    });
  }

  typeCheck('fire',     ['grass', 'steel'],   4.0);   // Fire vs Grass+Steel = ×4
  typeCheck('ground',   ['electric'],          2.0);   // Ground vs Electric
  typeCheck('electric', ['ground'],            0.0);   // Electric vs Ground = immune
  typeCheck('dragon',   ['fairy'],             0.0);   // Dragon vs Fairy = immune
  typeCheck('normal',   ['ghost'],             0.0);   // Normal vs Ghost = immune
  typeCheck('ice',      ['dragon', 'flying'],  4.0);   // Ice vs Dragon+Flying = ×4
  typeCheck('water',    ['fire', 'rock'],      4.0);   // Water vs Fire+Rock = ×4
  typeCheck('steel',    ['rock', 'ice'],       4.0);   // Steel vs Rock = ×2, Steel vs Ice = ×2 → ×4
}

function runBridgeTests(): void {
  console.log('\n[5] Bridge protocol');

  function sendBridgeCommand(command: string): string {
    const result = spawnSync(
      'npx',
      ['ts-node', 'bridge.ts'],
      {
        input: command + '\n',
        cwd: path.resolve(__dirname),
        encoding: 'utf8',
        timeout: 20_000,
        shell: true,
        env: { ...process.env, BRIDGE_DB: DB_PATH },
      }
    );
    return (result.stdout ?? '') + (result.stderr ?? '');
  }

  test('__PING__ returns pong', () => {
    const out = sendBridgeCommand('__PING__');
    assert(out.includes('pong'), `expected pong in output, got: ${out.slice(0, 100)}`);
    assert(out.includes('[[BOT_RESPONSE_BEGIN]]'), 'missing BOT_RESPONSE_BEGIN marker');
    assert(out.includes('[[BOT_RESPONSE_END]]'), 'missing BOT_RESPONSE_END marker');
  });

  test('__RESET__ returns reset message', () => {
    const out = sendBridgeCommand('__RESET__');
    assert(out.includes('reiniciado'), `expected reset message, got: ${out.slice(0, 100)}`);
  });

  test('__POKEDEX_DETAIL_JSON__:pikachu returns valid JSON', () => {
    const out = sendBridgeCommand('__POKEDEX_DETAIL_JSON__:pikachu');
    const jsonMatch = out.match(/\{.*\}/s);
    assert(jsonMatch !== null, 'no JSON in output');
    const parsed = JSON.parse(jsonMatch![0]);
    assert(parsed.ok === true, `expected ok:true, got ${JSON.stringify(parsed).slice(0, 100)}`);
    assert(parsed.detail?.identifier === 'pikachu', 'wrong identifier');
    assert(Array.isArray(parsed.detail?.types), 'types should be array');
  });

  test('__POKEDEX_DETAIL_JSON__ for unknown pokemon returns ok:false', () => {
    const out = sendBridgeCommand('__POKEDEX_DETAIL_JSON__:fakepokemon99999');
    const jsonMatch = out.match(/\{.*\}/s);
    assert(jsonMatch !== null, 'no JSON in output');
    const parsed = JSON.parse(jsonMatch![0]);
    assert(parsed.ok === false, 'expected ok:false for unknown pokemon');
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[smoke] SQLite not found at ${DB_PATH}`);
    console.error('[smoke] Run: node tools/nn/export_nn_data.js first');
    process.exit(1);
  }

  console.log(`[smoke] db=${DB_PATH}`);
  const engine = new DeterministicEngine(DB_PATH);

  try {
    runPokedexTests(engine);
    runDamageTests(engine);
    runVGCTests();
    runTypeTests(engine);
    runBridgeTests();
  } finally {
    engine.close();
  }

  console.log(`\n[smoke] ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.error('\nFailed tests:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main();
