PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value_text TEXT,
  value_number REAL
);

CREATE TABLE IF NOT EXISTS types (
  id TEXT PRIMARY KEY,
  pt_label TEXT
);

CREATE TABLE IF NOT EXISTS type_chart (
  attack_type TEXT NOT NULL,
  defense_type TEXT NOT NULL,
  multiplier REAL NOT NULL,
  PRIMARY KEY (attack_type, defense_type),
  FOREIGN KEY (attack_type) REFERENCES types(id),
  FOREIGN KEY (defense_type) REFERENCES types(id)
);

CREATE TABLE IF NOT EXISTS stats (
  id TEXT PRIMARY KEY,
  pt_label TEXT
);

CREATE TABLE IF NOT EXISTS pokemon (
  id INTEGER PRIMARY KEY,
  identifier TEXT NOT NULL UNIQUE,
  height_dm INTEGER NOT NULL,
  weight_hg INTEGER NOT NULL,
  source_generation INTEGER
);

CREATE TABLE IF NOT EXISTS pokemon_types (
  pokemon_id INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  type_id TEXT NOT NULL,
  PRIMARY KEY (pokemon_id, slot),
  FOREIGN KEY (pokemon_id) REFERENCES pokemon(id),
  FOREIGN KEY (type_id) REFERENCES types(id)
);

CREATE TABLE IF NOT EXISTS pokemon_abilities (
  pokemon_id INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  ability_id TEXT NOT NULL,
  PRIMARY KEY (pokemon_id, slot),
  FOREIGN KEY (pokemon_id) REFERENCES pokemon(id),
  FOREIGN KEY (ability_id) REFERENCES abilities(id)
);

CREATE TABLE IF NOT EXISTS pokemon_stats (
  pokemon_id INTEGER NOT NULL,
  stat_id TEXT NOT NULL,
  value INTEGER NOT NULL,
  PRIMARY KEY (pokemon_id, stat_id),
  FOREIGN KEY (pokemon_id) REFERENCES pokemon(id),
  FOREIGN KEY (stat_id) REFERENCES stats(id)
);

CREATE TABLE IF NOT EXISTS pokemon_moves (
  pokemon_identifier TEXT NOT NULL,
  pokemon_id INTEGER,
  move_id TEXT NOT NULL,
  PRIMARY KEY (pokemon_identifier, move_id),
  FOREIGN KEY (pokemon_identifier) REFERENCES pokemon(identifier),
  FOREIGN KEY (pokemon_id) REFERENCES pokemon(id),
  FOREIGN KEY (move_id) REFERENCES moves(id)
);

CREATE TABLE IF NOT EXISTS moves (
  id TEXT PRIMARY KEY,
  type_id TEXT NOT NULL,
  category TEXT NOT NULL,
  base_power INTEGER NOT NULL,
  accuracy INTEGER NOT NULL,
  pp INTEGER NOT NULL,
  effect_chance INTEGER,
  ailment TEXT,
  effect_category TEXT,
  description TEXT NOT NULL,
  FOREIGN KEY (type_id) REFERENCES types(id)
);

CREATE TABLE IF NOT EXISTS move_tags (
  move_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (move_id, tag),
  FOREIGN KEY (move_id) REFERENCES moves(id)
);

CREATE TABLE IF NOT EXISTS move_effects (
  move_id TEXT NOT NULL,
  category TEXT NOT NULL,
  trigger TEXT NOT NULL,
  model_json TEXT NOT NULL,
  description TEXT NOT NULL,
  confidence REAL,
  PRIMARY KEY (move_id, category, trigger),
  FOREIGN KEY (move_id) REFERENCES moves(id)
);

CREATE TABLE IF NOT EXISTS move_markers (
  move_id TEXT NOT NULL,
  marker TEXT NOT NULL,
  value_type TEXT NOT NULL,
  value_text TEXT NOT NULL,
  value_number REAL,
  value_bool INTEGER,
  PRIMARY KEY (move_id, marker, value_type, value_text),
  FOREIGN KEY (move_id) REFERENCES moves(id)
);

CREATE TABLE IF NOT EXISTS move_tactical_role_seed (
  move_id TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (move_id, role)
);

CREATE TABLE IF NOT EXISTS move_tactical_role_expand (
  role TEXT NOT NULL,
  expanded_role TEXT NOT NULL,
  PRIMARY KEY (role, expanded_role)
);

CREATE TABLE IF NOT EXISTS abilities (
  id TEXT PRIMARY KEY,
  generation TEXT,
  is_main_series INTEGER NOT NULL,
  short_effect TEXT,
  effect TEXT
);

CREATE TABLE IF NOT EXISTS ability_effects (
  ability_id TEXT NOT NULL,
  category TEXT NOT NULL,
  trigger TEXT NOT NULL,
  model_json TEXT NOT NULL,
  description TEXT NOT NULL,
  PRIMARY KEY (ability_id, category, trigger),
  FOREIGN KEY (ability_id) REFERENCES abilities(id)
);

CREATE TABLE IF NOT EXISTS ability_markers (
  ability_id TEXT NOT NULL,
  marker TEXT NOT NULL,
  value_type TEXT NOT NULL,
  value_text TEXT NOT NULL,
  value_number REAL,
  value_bool INTEGER,
  PRIMARY KEY (ability_id, marker, value_type, value_text),
  FOREIGN KEY (ability_id) REFERENCES abilities(id)
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  category TEXT,
  cost INTEGER NOT NULL,
  fling_power INTEGER NOT NULL,
  fling_effect TEXT,
  description TEXT
);

CREATE TABLE IF NOT EXISTS item_markers (
  item_id TEXT NOT NULL,
  marker TEXT NOT NULL,
  value_type TEXT NOT NULL,
  value_text TEXT NOT NULL,
  value_number REAL,
  value_bool INTEGER,
  PRIMARY KEY (item_id, marker, value_type, value_text),
  FOREIGN KEY (item_id) REFERENCES items(id)
);

CREATE TABLE IF NOT EXISTS held_item_effects (
  item_id TEXT NOT NULL,
  category TEXT NOT NULL,
  trigger TEXT NOT NULL,
  model_json TEXT NOT NULL,
  description TEXT NOT NULL,
  confidence REAL,
  PRIMARY KEY (item_id, category, trigger),
  FOREIGN KEY (item_id) REFERENCES items(id)
);

CREATE INDEX IF NOT EXISTS idx_pokemon_identifier ON pokemon(identifier);
CREATE INDEX IF NOT EXISTS idx_pokemon_types_type ON pokemon_types(type_id);
CREATE INDEX IF NOT EXISTS idx_pokemon_moves_move ON pokemon_moves(move_id);
CREATE INDEX IF NOT EXISTS idx_moves_type ON moves(type_id);
CREATE INDEX IF NOT EXISTS idx_move_tags_tag ON move_tags(tag);
CREATE INDEX IF NOT EXISTS idx_ability_markers_marker ON ability_markers(marker);
CREATE INDEX IF NOT EXISTS idx_item_markers_marker ON item_markers(marker);
CREATE INDEX IF NOT EXISTS idx_move_markers_marker ON move_markers(marker);
CREATE INDEX IF NOT EXISTS idx_type_chart_attack ON type_chart(attack_type);
CREATE INDEX IF NOT EXISTS idx_type_chart_defense ON type_chart(defense_type);
