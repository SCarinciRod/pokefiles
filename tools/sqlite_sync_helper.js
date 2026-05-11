'use strict';
// Shared helper — re-syncs the SQLite DB after a generator writes a .pl file.
// Usage: require('./sqlite_sync_helper').syncIfRequested(args, dbPath?)
//
// Activated by --output=sqlite in the process args.
// Optionally accepts --db=<path> to specify the SQLite DB to update.

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXPORTER = path.join(ROOT, 'tools', 'nn', 'export_nn_data.js');

function parseOutputArgs(argv) {
  const args = Object.fromEntries(
    argv.slice(2)
      .filter((a) => a.startsWith('--'))
      .map((a) => {
        const [k, v] = a.slice(2).split('=');
        return [k, v ?? 'true'];
      })
  );
  return {
    outputSqlite: args['output'] === 'sqlite',
    dbPath: args['db'] ?? null,
  };
}

function syncSqlite(dbPath) {
  const spawnArgs = ['--force'];
  if (dbPath) spawnArgs.push(`--db-path=${dbPath}`);

  console.log(`[sqlite-sync] running export_nn_data.js --force${dbPath ? ` --db-path=${dbPath}` : ''}`);

  const result = spawnSync('node', [EXPORTER, ...spawnArgs], {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: 300_000,
  });

  if (result.status !== 0 || result.error) {
    console.error('[sqlite-sync] export_nn_data.js failed:', result.error ?? `exit code ${result.status}`);
    process.exitCode = 1;
  } else {
    console.log('[sqlite-sync] SQLite sync complete.');
  }
}

function syncIfRequested() {
  const { outputSqlite, dbPath } = parseOutputArgs(process.argv);
  if (outputSqlite) {
    syncSqlite(dbPath);
  }
}

module.exports = { syncIfRequested, syncSqlite, parseOutputArgs };
