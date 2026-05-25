# NN Data Conversion + SQLite Schema (Phase 1)

Last updated: 2026-05-04

## Goals
- Deterministic conversion from Prolog facts to JSONL plus a stable SQLite schema.
- Idempotent outputs: same inputs produce the same data and manifest.
- Minimal, normalized schema focused on VGC Doubles phase 1 needs.

## Inputs (current scope)
- db/generations/core/generation_*.pl (pokemon/7)
- db/catalogs/pokemon_movelists.pl (pokemon_move_list/2)
- db/catalogs/moves_catalog.pl (move_entry/11)
- db/generated/move_data_auto.pl (move_data_auto/11, move_effect/6)
- db/generated/move_markers.pl (move_marker/3)
- db/catalogs/move_tactical_catalog.pl (move_tactical_role_seed/2, move_tactical_role_expand/2)
- db/catalogs/abilities_catalog.pl (ability_entry/5)
- db/generated/ability_data_auto.pl (ability_effect/5)
- db/generated/ability_markers.pl (ability_marker/3)
- db/catalogs/items_catalog.pl (item_entry/6)
- db/generated/item_markers.pl (item_marker/3)
- db/generated/held_item_data_auto.pl (held_item_effect/6)
- db/runtime/bot_type_data.pl (type_pt/2, stat_pt/2, type_chart/3, all_types/1)

## Outputs
- .local_cache/nn_export/manifest.json
- .local_cache/nn_export/data/*.jsonl
- .local_cache/nn_export/pokefiles_nn.sqlite3 (default; override with --db-path)
- Schema reference: tools/nn/sqlite_schema.sql

## Dependencies
- Node.js
- tools/nn/package.json (better-sqlite3)
- Install from tools/nn: npm install

## Schema mapping (draft)
- pokemon
  - source: pokemon/7
- pokemon_types
  - source: pokemon/7 types list
- pokemon_abilities
  - source: pokemon/7 abilities list
- pokemon_stats
  - source: pokemon/7 stats list (attack-49 style tokens)
- pokemon_moves
  - source: pokemon_move_list/2
- moves
  - source: move_data_auto/11 (fallback: move_entry/11)
- move_tags
  - source: move_data_auto/11 tags list (fallback: move_entry/11 tags)
- move_effects
  - source: move_effect/6
- move_markers
  - source: move_marker/3
- move_tactical_role_seed
  - source: move_tactical_role_seed/2
- move_tactical_role_expand
  - source: move_tactical_role_expand/2
- abilities
  - source: ability_entry/5
- ability_effects
  - source: ability_effect/5
- ability_markers
  - source: ability_marker/3
- items
  - source: item_entry/6
- held_item_effects
  - source: held_item_effect/6
- item_markers
  - source: item_marker/3
- types
  - source: all_types/1 and type_pt/2 (if present)
- type_chart
  - source: type_chart/3
- stats
  - source: stat_pt/2 and pokemon stats list

## Idempotence rules
- A manifest stores sha256 hashes for all inputs plus a schema version.
- If hashes and schema version match, the export is skipped unless --force is used.
- Output is JSONL and SQLite with stable sorting for deterministic diffs.

## CLI usage
- node tools/nn/export_nn_data.js
- node tools/nn/export_nn_data.js --output-dir=.local_cache/nn_export --force
- node tools/nn/export_nn_data.js --db-path=.local_cache/nn_export/pokefiles_nn.sqlite3

## Notes / out of scope for phase 1
- Forms, evolutions, and lore tables are not mapped yet.
- Runtime lexicon and intent catalogs are not exported yet.
- Partitions in db/generated/partitions are not consumed yet.
