'use strict';
// Exports stat calculation training examples.
// For each Pokémon in the SQLite DB: 3 EV spreads × Level 50 → calculated stats.
// No Prolog required — uses calculateStats() from mechanics.ts.
//
// Output: .local_cache/nn_export/training/stat_training.jsonl
//
// Run: node export_stat_training.js [--output-dir=<path>]

const path = require('path');
const fs = require('fs');

require('ts-node').register({ project: path.join(__dirname, 'tsconfig.json') });
const { DeterministicEngine, calculateStats } = require('./engine');

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
// EV spreads to generate examples for
// ---------------------------------------------------------------------------
const SPREADS = [
  {
    label: 'max_offensive_physical',
    evs: { attack: 252, speed: 252, hp: 4 },
    nature: { plus: 'attack', minus: 'special_attack' },
    ivs: {},
  },
  {
    label: 'max_offensive_special',
    evs: { special_attack: 252, speed: 252, hp: 4 },
    nature: { plus: 'special_attack', minus: 'attack' },
    ivs: {},
  },
  {
    label: 'max_defensive_physical',
    evs: { hp: 252, defense: 252, special_defense: 4 },
    nature: { plus: 'defense', minus: 'special_attack' },
    ivs: {},
  },
  {
    label: 'max_defensive_special',
    evs: { hp: 252, special_defense: 252, defense: 4 },
    nature: { plus: 'special_defense', minus: 'attack' },
    ivs: {},
  },
  {
    label: 'max_speed_neutral',
    evs: { speed: 252, hp: 128, defense: 128 },
    nature: { plus: 'neutral', minus: 'neutral' },
    ivs: {},
  },
  {
    label: 'zero_evs_neutral',
    evs: {},
    nature: { plus: 'neutral', minus: 'neutral' },
    ivs: {},
  },
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
    console.error(`[stat_training] SQLite not found: ${DB_PATH}`);
    process.exit(1);
  }

  ensureDir(OUTPUT_DIR);

  const engine = new DeterministicEngine(DB_PATH);
  const allPokemon = engine.getAllPokemon();
  engine.close();

  const timestamp = new Date().toISOString();
  const lines = [];

  for (const pokemon of allPokemon) {
    for (const spread of SPREADS) {
      const fullSpread = {
        level: LEVEL,
        evs: spread.evs,
        ivs: spread.ivs,
        nature: spread.nature,
      };

      const calculated = calculateStats(pokemon.baseStats, fullSpread);

      const example = {
        source_rule: 'stat_formula/gen5plus',
        export_time: timestamp,
        input: {
          pokemon_id: pokemon.identifier,
          types: pokemon.types,
          base_stats: pokemon.baseStats,
          spread_label: spread.label,
          level: LEVEL,
          evs: spread.evs,
          ivs: spread.ivs,
          nature: spread.nature,
        },
        output: {
          calculated_stats: calculated,
          bst: Object.values(pokemon.baseStats).reduce((s, v) => s + v, 0),
          offensive_peak: Math.max(calculated.attack, calculated.special_attack),
          bulk_average: Math.round((calculated.hp + calculated.defense + calculated.special_defense) / 3),
        },
      };

      lines.push(JSON.stringify(example));
    }
  }

  const outPath = path.join(OUTPUT_DIR, 'stat_training.jsonl');
  fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');

  console.log(`[stat_training] written ${lines.length} examples (${allPokemon.length} pokemon × ${SPREADS.length} spreads) → ${outPath}`);
}

main();
