"""Model validation: schema checks and invariant assertions."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import json


def assert_intent_labels(examples: list[dict[str, Any]], label_set: set[str]) -> None:
    unknown = {ex["intent"] for ex in examples} - label_set
    if unknown:
        raise ValueError(f"Unknown intent labels in training data: {unknown}")


def assert_no_empty_texts(examples: list[dict[str, Any]]) -> None:
    empties = [i for i, ex in enumerate(examples) if not ex.get("text", "").strip()]
    if empties:
        raise ValueError(f"Empty text at indices: {empties[:10]}")


def assert_model_file_exists(path: str | Path) -> None:
    if not Path(path).exists():
        raise FileNotFoundError(f"Model file not found: {path}")


def assert_model_size_under(path: str | Path, max_mb: float) -> None:
    size_mb = Path(path).stat().st_size / (1024 * 1024)
    if size_mb > max_mb:
        raise ValueError(f"Model at {path} is {size_mb:.1f} MB, exceeds limit {max_mb} MB")


def validate_nlu_dataset(examples: list[dict[str, Any]], label_set: set[str]) -> None:
    assert_no_empty_texts(examples)
    assert_intent_labels(examples, label_set)


def validate_nlu_output(output_path: str | Path, max_mb: float = 100.0) -> None:
    assert_model_file_exists(output_path)
    assert_model_size_under(output_path, max_mb)
