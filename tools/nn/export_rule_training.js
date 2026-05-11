'use strict';
// Exports Prolog engine rules as supervised training examples (JSONL).
// Each rule category produces a separate .jsonl file under:
//   .local_cache/nn_export/training/
//
// Run: node export_rule_training.js [--output-dir=<path>] [--max-per-target=<n>]
//
// The script spawns SWI-Prolog once per category and streams JSONL lines
// from stdout. Prolog side must have training_export.pl loaded.
//
// Speed tier category uses DeterministicEngine + vgc_mechanics (no Prolog).

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

require('ts-node').register({ project: path.join(__dirname, 'tsconfig.json') });

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

const OUTPUT_DIR = path.resolve(args['output-dir'] ?? path.join(__dirname, '../../.local_cache/nn_export/training'));
const MAX_PER_TARGET = parseInt(args['max-per-target'] ?? '20', 10);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function swipl(goal, timeoutMs = 300_000) {
  const result = spawnSync(
    'swipl',
    ['-q', '-g', goal, '-g', 'halt', path.join(PROJECT_ROOT, 'prolog/training_export.pl')],
    {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 256 * 1024 * 1024,
    }
  );
  return result;
}

function writeLines(outPath, lines) {
  fs.writeFileSync(outPath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
}

function parseJsonlLines(stdout) {
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'));
}

// ---------------------------------------------------------------------------
// Category: counter pairs (already implemented in training_export.pl)
// ---------------------------------------------------------------------------
function exportCounterPairs() {
  const outPath = path.join(OUTPUT_DIR, 'counter_training.jsonl');
  console.log('[counter] exporting...');

  const goal = `export_counter_dataset('${outPath.replace(/\\/g, '/')}', ${MAX_PER_TARGET})`;
  const result = swipl(goal);

  if (result.status !== 0 || result.error) {
    console.error('[counter] FAILED:', result.stderr?.slice(0, 500) ?? result.error);
    return 0;
  }

  const lines = parseJsonlLines(result.stdout);
  if (lines.length === 0) {
    // training_export.pl writes directly to file; count existing lines
    try {
      const written = fs.readFileSync(outPath, 'utf8').split('\n').filter((l) => l.trim().startsWith('{')).length;
      console.log(`[counter] done — ${written} lines`);
      return written;
    } catch {
      console.log('[counter] done (file written by Prolog, count unavailable)');
      return -1;
    }
  }

  writeLines(outPath, lines);
  console.log(`[counter] done — ${lines.length} lines`);
  return lines.length;
}

// ---------------------------------------------------------------------------
// Category: doubles synergy pairs
// ---------------------------------------------------------------------------
function exportDoublesSynergy() {
  const outPath = path.join(OUTPUT_DIR, 'doubles_synergy_training.jsonl');
  console.log('[doubles_synergy] exporting...');

  const goal = `export_doubles_synergy_dataset('${outPath.replace(/\\/g, '/')}', ${MAX_PER_TARGET})`;
  const result = swipl(goal, 600_000);

  if (result.status !== 0 || result.error) {
    console.error('[doubles_synergy] FAILED:', result.stderr?.slice(0, 500) ?? result.error);
    return 0;
  }

  try {
    const written = fs.readFileSync(outPath, 'utf8').split('\n').filter((l) => l.trim().startsWith('{')).length;
    console.log(`[doubles_synergy] done — ${written} lines`);
    return written;
  } catch {
    console.log('[doubles_synergy] done (file written by Prolog)');
    return -1;
  }
}

// ---------------------------------------------------------------------------
// Category: held item recommendations
// ---------------------------------------------------------------------------
function exportHeldItemTraining() {
  const outPath = path.join(OUTPUT_DIR, 'held_item_training.jsonl');
  console.log('[held_item] exporting...');

  const goal = `export_held_item_dataset('${outPath.replace(/\\/g, '/')}', ${MAX_PER_TARGET})`;
  const result = swipl(goal, 600_000);

  if (result.status !== 0 || result.error) {
    console.error('[held_item] FAILED:', result.stderr?.slice(0, 500) ?? result.error);
    return 0;
  }

  try {
    const written = fs.readFileSync(outPath, 'utf8').split('\n').filter((l) => l.trim().startsWith('{')).length;
    console.log(`[held_item] done — ${written} lines`);
    return written;
  } catch {
    console.log('[held_item] done (file written by Prolog)');
    return -1;
  }
}

// ---------------------------------------------------------------------------
// Category: role labels
// ---------------------------------------------------------------------------
function exportRoleTraining() {
  const outPath = path.join(OUTPUT_DIR, 'role_training.jsonl');
  console.log('[role] exporting...');

  const goal = `export_role_dataset('${outPath.replace(/\\/g, '/')}')`;
  const result = swipl(goal, 300_000);

  if (result.status !== 0 || result.error) {
    console.error('[role] FAILED:', result.stderr?.slice(0, 500) ?? result.error);
    return 0;
  }

  try {
    const written = fs.readFileSync(outPath, 'utf8').split('\n').filter((l) => l.trim().startsWith('{')).length;
    console.log(`[role] done — ${written} lines`);
    return written;
  } catch {
    console.log('[role] done (file written by Prolog)');
    return -1;
  }
}

// ---------------------------------------------------------------------------
// Category: matchup pressure
// ---------------------------------------------------------------------------
function exportMatchupTraining() {
  const outPath = path.join(OUTPUT_DIR, 'matchup_training.jsonl');
  console.log('[matchup] exporting...');

  const goal = `export_matchup_dataset('${outPath.replace(/\\/g, '/')}', ${MAX_PER_TARGET})`;
  const result = swipl(goal, 600_000);

  if (result.status !== 0 || result.error) {
    console.error('[matchup] FAILED:', result.stderr?.slice(0, 500) ?? result.error);
    return 0;
  }

  try {
    const written = fs.readFileSync(outPath, 'utf8').split('\n').filter((l) => l.trim().startsWith('{')).length;
    console.log(`[matchup] done — ${written} lines`);
    return written;
  } catch {
    console.log('[matchup] done (file written by Prolog)');
    return -1;
  }
}

// ---------------------------------------------------------------------------
// Category: ranking metrics (reuse existing export from training_export.pl)
// ---------------------------------------------------------------------------
function exportRankingTraining() {
  const outPath = path.join(OUTPUT_DIR, 'ranking_training.jsonl');
  console.log('[ranking] exporting...');

  const goal = `export_ranking_metrics('${outPath.replace(/\\/g, '/')}', all)`;
  const result = swipl(goal, 300_000);

  if (result.status !== 0 || result.error) {
    console.error('[ranking] FAILED:', result.stderr?.slice(0, 500) ?? result.error);
    return 0;
  }

  try {
    const written = fs.readFileSync(outPath, 'utf8').split('\n').filter((l) => l.trim().startsWith('{')).length;
    console.log(`[ranking] done — ${written} lines`);
    return written;
  } catch {
    console.log('[ranking] done (file written by Prolog)');
    return -1;
  }
}

// ---------------------------------------------------------------------------
// Category: speed tier (pure TypeScript, no Prolog)
// Generates turn-order examples under normal / tailwind / trick room field states.
// Samples ~40 pokemon across speed tiers + priority move interaction.
// ---------------------------------------------------------------------------
function exportSpeedTierTraining() {
  const outPath = path.join(OUTPUT_DIR, 'speed_tier_training.jsonl');
  console.log('[speed_tier] exporting...');

  const DEFAULT_DB = path.resolve(__dirname, '../../.local_cache/nn_export/pokefiles_nn.sqlite3');
  const DB_PATH = process.env['BRIDGE_DB'] ?? DEFAULT_DB;

  if (!fs.existsSync(DB_PATH)) {
    console.error(`[speed_tier] SQLite not found: ${DB_PATH}`);
    return 0;
  }

  const { DeterministicEngine } = require('./engine');
  const { compareVGCActionOrder, createSpeedControlState, activateTailwind, activateTrickRoom } = require('./engine/vgc_mechanics');

  const engine = new DeterministicEngine(DB_PATH);
  const allPokemon = engine.getAllPokemon();

  // Sample 40 pokemon spread across speed tiers
  allPokemon.sort((a, b) => b.baseStats.speed - a.baseStats.speed);
  const buckets = [
    allPokemon.filter((p) => p.baseStats.speed >= 120).slice(0, 10),
    allPokemon.filter((p) => p.baseStats.speed >= 90 && p.baseStats.speed < 120).slice(0, 10),
    allPokemon.filter((p) => p.baseStats.speed >= 60 && p.baseStats.speed < 90).slice(0, 10),
    allPokemon.filter((p) => p.baseStats.speed < 60).slice(0, 10),
  ];
  const sample = buckets.flat();

  const FIELD_STATES = [
    { label: 'normal',      state: createSpeedControlState() },
    { label: 'tailwind',    state: activateTailwind(createSpeedControlState()) },
    { label: 'trick_room',  state: activateTrickRoom(createSpeedControlState()) },
  ];

  const timestamp = new Date().toISOString();
  const lines = [];

  for (let i = 0; i < sample.length; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      const pa = sample[i];
      const pb = sample[j];
      const statsA = engine.computeStats(pa.baseStats, { level: 50 });
      const statsB = engine.computeStats(pb.baseStats, { level: 50 });

      for (const { label, state } of FIELD_STATES) {
        // Normal move vs normal move (priority 0)
        const profileA = { identifier: pa.identifier, stats: statsA, priority: 0, damage: 0 };
        const profileB = { identifier: pb.identifier, stats: statsB, priority: 0, damage: 0 };
        const order = compareVGCActionOrder(profileA, profileB, state);
        const speedA = statsA.speed;
        const speedB = statsB.speed;
        const effA = label === 'tailwind' ? speedA * 2 : speedA;
        const effB = label === 'tailwind' ? speedB * 2 : speedB;
        const reason = effA === effB ? 'speed_tie'
          : label === 'trick_room' ? 'lower_speed_trick_room'
          : 'higher_speed';

        lines.push(JSON.stringify({
          source_rule: 'speed_tier/vgc',
          export_time: timestamp,
          input: {
            pokemon_a: pa.identifier,
            speed_a: speedA,
            priority_a: 0,
            pokemon_b: pb.identifier,
            speed_b: speedB,
            priority_b: 0,
            field: label,
          },
          output: {
            first: order === 'first' ? pa.identifier : pb.identifier,
            reason,
          },
        }));
      }

      // Priority move interaction: priority +1 always goes first regardless of speed
      const fastA = statsA.speed > statsB.speed ? pa : pb;
      const slowB = statsA.speed > statsB.speed ? pb : pa;
      const fastStats = statsA.speed > statsB.speed ? statsA : statsB;
      const slowStats = statsA.speed > statsB.speed ? statsB : statsA;

      if (fastStats.speed !== slowStats.speed) {
        const priorityProfile = { identifier: slowB.identifier, stats: slowStats, priority: 1, damage: 0 };
        const normalProfile  = { identifier: fastA.identifier, stats: fastStats, priority: 0, damage: 0 };
        const prioOrder = compareVGCActionOrder(priorityProfile, normalProfile, createSpeedControlState());

        lines.push(JSON.stringify({
          source_rule: 'speed_tier/vgc',
          export_time: timestamp,
          input: {
            pokemon_a: slowB.identifier,
            speed_a: slowStats.speed,
            priority_a: 1,
            pokemon_b: fastA.identifier,
            speed_b: fastStats.speed,
            priority_b: 0,
            field: 'normal',
          },
          output: {
            first: prioOrder === 'first' ? slowB.identifier : fastA.identifier,
            reason: 'higher_priority',
          },
        }));
      }
    }
  }

  engine.close();

  fs.writeFileSync(outPath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
  console.log(`[speed_tier] done — ${lines.length} lines → ${outPath}`);
  return lines.length;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------
function writeManifest(results) {
  const manifest = {
    export_time: new Date().toISOString(),
    output_dir: OUTPUT_DIR,
    max_per_target: MAX_PER_TARGET,
    categories: results,
  };
  const manifestPath = path.join(OUTPUT_DIR, 'training_manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`\nManifest written: ${manifestPath}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  ensureDir(OUTPUT_DIR);
  console.log(`Output dir: ${OUTPUT_DIR}`);
  console.log(`Max per target: ${MAX_PER_TARGET}\n`);

  const results = {};
  results.counter = exportCounterPairs();
  results.doubles_synergy = exportDoublesSynergy();
  results.held_item = exportHeldItemTraining();
  results.role = exportRoleTraining();
  results.matchup = exportMatchupTraining();
  results.ranking = exportRankingTraining();
  results.speed_tier = exportSpeedTierTraining();

  writeManifest(results);

  const total = Object.values(results).reduce((s, n) => s + Math.max(0, n), 0);
  console.log(`\nTotal training lines: ${total}`);
}

main();
