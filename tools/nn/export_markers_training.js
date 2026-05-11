'use strict';
// Exports move/ability/item marker triplets as supervised training examples.
// Reads move_markers, ability_markers, item_markers from SQLite (no Prolog).
//
// Each row becomes: { entity_type, entity_id, marker, value_type, value }
// The NN learns to predict marker values from entity context and marker name.
//
// Output: .local_cache/nn_export/training/markers_training.jsonl
//
// Run: node export_markers_training.js [--output-dir=<path>]

const path = require('path');
const fs = require('fs');

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
// Helpers
// ---------------------------------------------------------------------------
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function resolveValue(row) {
  if (row.value_type === 'number') return row.value_number;
  if (row.value_type === 'bool')   return row.value_bool === 1 || row.value_bool === true;
  return row.value_text;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[markers_training] SQLite not found: ${DB_PATH}`);
    process.exit(1);
  }

  ensureDir(OUTPUT_DIR);

  const engine = new DeterministicEngine(DB_PATH);
  const timestamp = new Date().toISOString();
  const lines = [];

  const TABLE_MAP = [
    { table: 'move_markers',    entity_type: 'move',    id_col: 'move_id' },
    { table: 'ability_markers', entity_type: 'ability', id_col: 'ability_id' },
    { table: 'item_markers',    entity_type: 'item',    id_col: 'item_id' },
  ];

  for (const { table, entity_type, id_col } of TABLE_MAP) {
    const rows = engine.queryAll(`SELECT * FROM ${table} ORDER BY ${id_col}, marker`);
    console.log(`[markers_training] ${table}: ${rows.length} rows`);

    for (const row of rows) {
      const value = resolveValue(row);
      if (value === null || value === undefined) continue;

      lines.push(JSON.stringify({
        source_rule: `markers/${entity_type}`,
        export_time: timestamp,
        input: {
          entity_type,
          entity_id: row[id_col],
          marker: row.marker,
        },
        output: {
          value_type: row.value_type,
          value,
        },
      }));
    }
  }

  engine.close();

  const outPath = path.join(OUTPUT_DIR, 'markers_training.jsonl');
  fs.writeFileSync(outPath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');

  console.log(`[markers_training] written ${lines.length} examples → ${outPath}`);
}

main();
