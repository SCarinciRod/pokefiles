"""Evaluates the trained NLU classifier against the golden set.

Usage:
    python nlu/eval_nlu.py [--config=../config.yaml]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch
from sentence_transformers import SentenceTransformer

sys.path.insert(0, str(Path(__file__).parent.parent))
from shared.rule_data_loader import load_intent_examples

# Inline classifier definition (must match train_nlu.py)
import torch.nn as nn


class NLUClassifier(nn.Module):
    def __init__(self, encoder_dim: int, num_classes: int):
        super().__init__()
        self.classifier = nn.Sequential(
            nn.Dropout(0.1),
            nn.Linear(encoder_dim, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.classifier(x)


def main(config_path: str) -> None:
    import yaml
    with open(config_path) as f:
        cfg = yaml.safe_load(f)

    nlu_cfg = cfg["nlu"]
    training_dir = Path(config_path).parent / cfg["paths"]["training_dir"]
    model_dir = Path(config_path).parent / nlu_cfg["output_dir"]

    meta_path = model_dir / "meta.json"
    if not meta_path.exists():
        raise FileNotFoundError(f"Model not found at {model_dir} — run train_nlu.py first")

    with open(meta_path) as f:
        meta = json.load(f)

    label_map_inv = {cls: i for i, cls in enumerate(meta["intents"])}

    examples = load_intent_examples(training_dir)
    golden = [ex for ex in examples if ex.get("source") == "golden_set" and ex.get("confidence", 0) >= 1.0]
    if not golden:
        print("[eval_nlu] No golden set examples found — using all examples")
        golden = examples

    texts = [ex["text"] for ex in golden]
    true_labels = torch.tensor([label_map_inv.get(ex["intent"], -1) for ex in golden], dtype=torch.long)
    valid_mask = true_labels >= 0
    texts = [t for t, v in zip(texts, valid_mask) if v]
    true_labels = true_labels[valid_mask]

    encoder = SentenceTransformer(str(model_dir / "encoder"))
    encoder.max_seq_length = nlu_cfg["max_seq_length"]
    embeddings = torch.tensor(
        encoder.encode(texts, batch_size=nlu_cfg["batch_size"], show_progress_bar=False, convert_to_numpy=True)
    )

    model = NLUClassifier(meta["encoder_dim"], meta["num_classes"])
    model.load_state_dict(torch.load(model_dir / "classifier.pt", map_location="cpu", weights_only=True))
    model.eval()

    with torch.no_grad():
        logits = model(embeddings)
        preds = logits.argmax(dim=-1)

    accuracy = (preds == true_labels).float().mean().item()
    print(f"[eval_nlu] golden_set_size={len(texts)}  accuracy={accuracy:.4f}")

    # Per-intent breakdown
    from collections import defaultdict
    intent_correct: dict[str, int] = defaultdict(int)
    intent_total: dict[str, int] = defaultdict(int)
    for ex, p in zip(golden, preds.tolist()):
        intent = ex["intent"]
        intent_total[intent] += 1
        if meta["intents"][p] == intent:
            intent_correct[intent] += 1

    print("\n[eval_nlu] Per-intent accuracy:")
    for intent in sorted(intent_total):
        tot = intent_total[intent]
        acc = intent_correct[intent] / tot if tot else 0.0
        flag = " ⚠" if acc < 0.9 else ""
        print(f"  {intent:<35}  {acc:.2f}  ({intent_correct[intent]}/{tot}){flag}")

    target = nlu_cfg["target_accuracy"]
    status = "PASS" if accuracy >= target else "FAIL"
    print(f"\n[eval_nlu] {status} — accuracy={accuracy:.4f} target={target}")
    return accuracy >= target


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=str(Path(__file__).parent.parent / "config.yaml"))
    args = parser.parse_args()
    ok = main(args.config)
    sys.exit(0 if ok else 1)
