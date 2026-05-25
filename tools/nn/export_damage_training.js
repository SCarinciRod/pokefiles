'use strict';
// Exports damage calculation training examples using the TypeScript DeterministicEngine.
// No Prolog required — uses SQLite + Gen V+ formula implemented in mechanics.ts.
//
// Output: .local_cache/nn_export/training/damage_training.jsonl
//
// Run: node export_damage_training.js [--output-dir=<path>]

const path = require('path');
const fs = require('fs');

// We use ts-node/register to import the TypeScript engine from JS
require('ts-node').register({ project: path.join(__dirname, 'tsconfig.json') });
const { DeterministicEngine } = require('./engine');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k, v ?? 'true'];
    })
);

const OUTPUT_DIR = path.resolve(
  args['output-dir'] ?? path.join(__dirname, '../../.local_cache/nn_export/training')
);
const DEFAULT_DB = path.resolve(__dirname, '../../.local_cache/nn_export/pokefiles_nn.sqlite3');
const DB_PATH = process.env['BRIDGE_DB'] ?? args['db'] ?? DEFAULT_DB;

// ---------------------------------------------------------------------------
// Scenario definitions
// Each scenario: attacker × defender × move × optional EVs
// Covers: STAB, super-effective, neutral, double-weak, immune check
// ---------------------------------------------------------------------------
const SCENARIOS = [
  // STAB + super-effective (should hit very hard)
  { attacker: 'charizard',  defender: 'ferrothorn', move: 'fire_blast',    label: 'stab+super_eff' },
  { attacker: 'charizard',  defender: 'gyarados',   move: 'thunderbolt',   label: 'no_stab+super_eff' },
  { attacker: 'garchomp',   defender: 'pikachu',    move: 'earthquake',    label: 'stab+super_eff' },
  { attacker: 'garchomp',   defender: 'togekiss',   move: 'dragon_claw',   label: 'stab+neutral' },
  { attacker: 'tyranitar',  defender: 'charizard',  move: 'stone_edge',    label: 'stab+double_weak' },
  { attacker: 'tyranitar',  defender: 'gardevoir',  move: 'crunch',        label: 'stab+super_eff' },
  { attacker: 'gengar',     defender: 'gardevoir',  move: 'shadow_ball',   label: 'stab+super_eff' },
  { attacker: 'gengar',     defender: 'snorlax',    move: 'sludge_bomb',   label: 'stab+neutral' },
  { attacker: 'alakazam',   defender: 'machamp',    move: 'psychic',       label: 'stab+super_eff' },
  { attacker: 'alakazam',   defender: 'tyranitar',  move: 'focus_blast',   label: 'no_stab+neutral' },
  { attacker: 'dragonite',  defender: 'ferrothorn', move: 'fire_punch',    label: 'no_stab+super_eff' },
  { attacker: 'dragonite',  defender: 'gardevoir',  move: 'outrage',       label: 'stab+neutral' },
  { attacker: 'metagross',  defender: 'togekiss',   move: 'meteor_mash',   label: 'stab+super_eff' },
  { attacker: 'metagross',  defender: 'charizard',  move: 'zen_headbutt',  label: 'stab+neutral' },
  { attacker: 'togekiss',   defender: 'garchomp',   move: 'dazzling_gleam', label: 'stab+double_weak' },
  { attacker: 'lapras',     defender: 'garchomp',   move: 'ice_beam',      label: 'no_stab+double_weak' },
  { attacker: 'rillaboom',  defender: 'gyarados',   move: 'wood_hammer',   label: 'stab+super_eff' },
  { attacker: 'incineroar', defender: 'ferrothorn', move: 'flare_blitz',   label: 'stab+super_eff' },
  { attacker: 'flutter_mane', defender: 'garchomp', move: 'moonblast',     label: 'stab+double_weak' },
  { attacker: 'flutter_mane', defender: 'tyranitar', move: 'shadow_ball',  label: 'stab+super_eff' },
  // Physical vs Special attacker comparison
  { attacker: 'machamp',    defender: 'tyranitar',  move: 'close_combat',  label: 'stab+super_eff' },
  { attacker: 'gardevoir',  defender: 'garchomp',   move: 'moonblast',     label: 'stab+super_eff' },
  // Neutral matchups
  { attacker: 'snorlax',    defender: 'snorlax',    move: 'return',        label: 'stab+neutral' },
  { attacker: 'gyarados',   defender: 'incineroar', move: 'waterfall',     label: 'stab+super_eff' },
];

const LEVEL = 50;

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[damage_training] SQLite not found: ${DB_PATH}`);
    process.exit(1);
  }

  ensureDir(OUTPUT_DIR);

  const engine = new DeterministicEngine(DB_PATH);
  const timestamp = new Date().toISOString();
  const lines = [];
  let skipped = 0;

  for (const scenario of SCENARIOS) {
    const attacker = engine.getPokemonContext(scenario.attacker);
    const defender = engine.getPokemonContext(scenario.defender);
    const move = engine.getMove(scenario.move);

    if (!attacker) { console.warn(`[damage_training] skip: attacker ${scenario.attacker} not found`); skipped++; continue; }
    if (!defender) { console.warn(`[damage_training] skip: defender ${scenario.defender} not found`); skipped++; continue; }
    if (!move)     { console.warn(`[damage_training] skip: move ${scenario.move} not found`); skipped++; continue; }
    if (move.category === 'status' || move.base_power <= 0) { skipped++; continue; }

    const attackerStats = engine.computeStats(attacker.baseStats, { level: LEVEL });
    const defenderStats = engine.computeStats(defender.baseStats, { level: LEVEL });

    const profile = engine.computeDamageProfile({
      level: LEVEL,
      attacker,
      defender,
      attackerStats,
      defenderStats,
      move,
    });

    // Also include the type multiplier and stab flag for richer training
    const { computeTypeMultiplier, computeStab } = require('./engine');
    const typeChart = engine.getTypeChart();
    const typeMult = computeTypeMultiplier(typeChart, move.type_id, defender.types);
    const stab = computeStab(move.type_id, attacker.types);

    const defenderHp = engine.computeStats(defender.baseStats, { level: LEVEL }).hp;
    const minPercent = Math.round((profile.min / defenderHp) * 1000) / 10;
    const avgPercent = Math.round((profile.avg / defenderHp) * 1000) / 10;
    const maxPercent = Math.round((profile.max / defenderHp) * 1000) / 10;

    const example = {
      source_rule: 'damage_formula/gen5plus',
      export_time: timestamp,
      label: scenario.label,
      input: {
        attacker_id: scenario.attacker,
        attacker_types: attacker.types,
        defender_id: scenario.defender,
        defender_types: defender.types,
        move_id: scenario.move,
        move_type: move.type_id,
        move_category: move.category,
        base_power: move.base_power,
        level: LEVEL,
        attacker_stats: attackerStats,
        defender_stats: defenderStats,
      },
      output: {
        damage_min: profile.min,
        damage_avg: profile.avg,
        damage_max: profile.max,
        pct_min: minPercent,
        pct_avg: avgPercent,
        pct_max: maxPercent,
        type_multiplier: typeMult,
        stab: stab,
        is_super_effective: typeMult > 1,
        is_resisted: typeMult < 1 && typeMult > 0,
        is_immune: typeMult === 0,
        ohko: profile.min >= defenderHp,
      },
    };

    lines.push(JSON.stringify(example));
  }

  engine.close();

  const outPath = path.join(OUTPUT_DIR, 'damage_training.jsonl');
  fs.writeFileSync(outPath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');

  console.log(`[damage_training] written ${lines.length} examples (${skipped} skipped) → ${outPath}`);
}

main();
