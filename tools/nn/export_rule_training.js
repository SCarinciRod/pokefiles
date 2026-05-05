'use strict';
// Exports Prolog engine rules as supervised training examples (JSONL).
// Each rule category produces a separate .jsonl file under:
//   .local_cache/nn_export/training/
//
// Run: node export_rule_training.js [--output-dir=<path>] [--max-per-target=<n>]
//
// The script spawns SWI-Prolog once per category and streams JSONL lines
// from stdout. Prolog side must have training_export.pl loaded.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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

  writeManifest(results);

  const total = Object.values(results).reduce((s, n) => s + Math.max(0, n), 0);
  console.log(`\nTotal training lines: ${total}`);
}

main();
