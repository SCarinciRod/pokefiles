"""Loads JSONL training data exported by export_rule_training.js."""
import json
from pathlib import Path
from typing import Any


def load_jsonl(path: str | Path) -> list[dict[str, Any]]:
    path = Path(path)
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip().startswith("{")]


def load_intent_examples(training_dir: str | Path) -> list[dict[str, Any]]:
    return load_jsonl(Path(training_dir) / "intent_training.jsonl")


def load_counter_pairs(training_dir: str | Path) -> list[dict[str, Any]]:
    return load_jsonl(Path(training_dir) / "counter_training.jsonl")


def load_doubles_synergy(training_dir: str | Path) -> list[dict[str, Any]]:
    return load_jsonl(Path(training_dir) / "doubles_synergy_training.jsonl")


def load_held_item(training_dir: str | Path) -> list[dict[str, Any]]:
    return load_jsonl(Path(training_dir) / "held_item_training.jsonl")


def load_role(training_dir: str | Path) -> list[dict[str, Any]]:
    return load_jsonl(Path(training_dir) / "role_training.jsonl")


def load_matchup(training_dir: str | Path) -> list[dict[str, Any]]:
    return load_jsonl(Path(training_dir) / "matchup_training.jsonl")


def load_ranking(training_dir: str | Path) -> list[dict[str, Any]]:
    return load_jsonl(Path(training_dir) / "ranking_training.jsonl")


def load_all_strategy(training_dir: str | Path) -> list[dict[str, Any]]:
    """Loads all strategy-relevant training data (counter + synergy + held_item + role)."""
    return (
        load_counter_pairs(training_dir)
        + load_doubles_synergy(training_dir)
        + load_held_item(training_dir)
        + load_role(training_dir)
    )
