"""Loads SQLite data exported by export_nn_data.js."""
import sqlite3
from pathlib import Path
from typing import Any


def get_db_path(data_dir: str | Path) -> Path:
    data_dir = Path(data_dir)
    candidates = list(data_dir.glob("*.sqlite3")) + list(data_dir.glob("*.db"))
    if not candidates:
        raise FileNotFoundError(f"No SQLite file in {data_dir}")
    return candidates[0]


def load_pokemon(db_path: str | Path) -> list[dict[str, Any]]:
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT p.id, p.identifier, p.source_generation, "
            "       GROUP_CONCAT(DISTINCT pt.type_id) AS types, "
            "       ps_hp.value AS hp, ps_atk.value AS attack, "
            "       ps_def.value AS defense, ps_spa.value AS special_attack, "
            "       ps_spd.value AS special_defense, ps_spe.value AS speed "
            "FROM pokemon p "
            "LEFT JOIN pokemon_types pt ON pt.pokemon_id = p.id "
            "LEFT JOIN pokemon_stats ps_hp  ON ps_hp.pokemon_id  = p.id AND ps_hp.stat_id  = 'hp' "
            "LEFT JOIN pokemon_stats ps_atk ON ps_atk.pokemon_id = p.id AND ps_atk.stat_id = 'attack' "
            "LEFT JOIN pokemon_stats ps_def ON ps_def.pokemon_id = p.id AND ps_def.stat_id = 'defense' "
            "LEFT JOIN pokemon_stats ps_spa ON ps_spa.pokemon_id = p.id AND ps_spa.stat_id = 'special_attack' "
            "LEFT JOIN pokemon_stats ps_spd ON ps_spd.pokemon_id = p.id AND ps_spd.stat_id = 'special_defense' "
            "LEFT JOIN pokemon_stats ps_spe ON ps_spe.pokemon_id = p.id AND ps_spe.stat_id = 'speed' "
            "GROUP BY p.id ORDER BY p.id"
        ).fetchall()
    return [dict(r) for r in rows]


def load_type_chart(db_path: str | Path) -> dict[str, dict[str, float]]:
    chart: dict[str, dict[str, float]] = {}
    with sqlite3.connect(db_path) as conn:
        for row in conn.execute("SELECT attack_type, defense_type, multiplier FROM type_chart"):
            chart.setdefault(row[0], {})[row[1]] = row[2]
    return chart


def load_pokemon_abilities(db_path: str | Path) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    with sqlite3.connect(db_path) as conn:
        for row in conn.execute(
            "SELECT p.identifier, pa.ability_id FROM pokemon p "
            "JOIN pokemon_abilities pa ON pa.pokemon_id = p.id ORDER BY pa.slot"
        ):
            result.setdefault(row[0], []).append(row[1])
    return result
