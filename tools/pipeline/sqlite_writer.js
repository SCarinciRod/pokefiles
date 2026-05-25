'use strict';
// Shared SQLite write helper for all generator tools.
// Provides openDb() — opens (or creates) the DB with the schema applied.
// Also exports normalizeMarkerValue() used by marker generators.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA_PATH = path.join(__dirname, '..', 'nn', 'sqlite_schema.sql');
const DEFAULT_DB = path.join(ROOT, '.local_cache', 'nn_export', 'pokefiles_nn.sqlite3');

function resolveDbPath() {
  const args = Object.fromEntries(
    process.argv.slice(2)
      .filter((a) => a.startsWith('--'))
      .map((a) => {
        const [k, v] = a.slice(2).split('=');
        return [k, v ?? 'true'];
      })
  );
  return path.resolve(args['db'] ?? process.env['BRIDGE_DB'] ?? DEFAULT_DB);
}

function openDb(dbPath) {
  const resolved = dbPath ?? resolveDbPath();
  const Database = require(path.join(__dirname, '..', 'nn', 'node_modules', 'better-sqlite3'));
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  if (fs.existsSync(SCHEMA_PATH)) {
    db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  }
  // Must come after schema exec — schema contains PRAGMA foreign_keys = ON.
  // Generators write tables in any order, so FK checks must be off.
  db.pragma('foreign_keys = OFF');
  return db;
}

function normalizeMarkerValue(value) {
  if (value === null || value === undefined) {
    return { value_type: 'null', value_text: 'null', value_number: null, value_bool: null };
  }
  if (typeof value === 'boolean') {
    return { value_type: 'bool', value_text: value ? 'true' : 'false', value_number: null, value_bool: value ? 1 : 0 };
  }
  if (typeof value === 'number') {
    return { value_type: 'number', value_text: String(value), value_number: value, value_bool: null };
  }
  return { value_type: 'text', value_text: String(value), value_number: null, value_bool: null };
}

function parseStoredMarkerValue(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?[0-9]+(?:\.[0-9]+)?$/.test(raw)) return Number(raw);
  return raw;
}

// Read all markers for a given entity table into Map<entityId, Map<marker, Set<rawString>>>.
// Used by data_auto generators that need the marker map without going through .pl files.
function loadMarkersFromDb(db, table, idCol) {
  const rows = db.prepare(`SELECT ${idCol}, marker, value_type, value_text, value_number, value_bool FROM ${table} ORDER BY ${idCol}, marker`).all();
  const result = new Map();
  for (const row of rows) {
    const entityId = row[idCol];
    if (!result.has(entityId)) result.set(entityId, new Map());
    const markers = result.get(entityId);
    if (!markers.has(row.marker)) markers.set(row.marker, new Set());
    const raw = row.value_type === 'number'
      ? String(row.value_number)
      : row.value_type === 'bool'
        ? (row.value_bool === 1 ? 'true' : 'false')
        : row.value_text;
    markers.get(row.marker).add(raw);
  }
  return result;
}

module.exports = { resolveDbPath, openDb, normalizeMarkerValue, parseStoredMarkerValue, loadMarkersFromDb, DEFAULT_DB };
