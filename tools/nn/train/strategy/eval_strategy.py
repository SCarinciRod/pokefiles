"""Evaluates the strategy scorer against the full held-out set.

Usage:
    python strategy/eval_strategy.py [--config=../config.yaml] [--model=lgbm|mlp]
"""
from __future__ import annotations

import argparse
import json
import pickle
import sys
from pathlib import Path

import numpy as np
import yaml

sys.path.insert(0, str(Path(__file__).parent.parent))
from shared.rule_data_loader import load_all_strategy
from train_strategy import build_dataset, ndcg_at_k


def main(config_path: str, model_type: str = "lgbm") -> bool:
    with open(config_path) as f:
        cfg = yaml.safe_load(f)

    strategy_cfg = cfg["strategy"]
    training_dir = Path(config_path).parent / cfg["paths"]["training_dir"]
    output_dir = Path(config_path).parent / strategy_cfg["output_dir"]

    meta_path = output_dir / "meta.json"
    if not meta_path.exists():
        raise FileNotFoundError(f"No trained model found at {output_dir} — run train_strategy.py first")

    with open(meta_path) as f:
        meta = json.load(f)

    records = load_all_strategy(training_dir)
    X, y = build_dataset(records)

    from sklearn.model_selection import train_test_split
    _, X_val, _, y_val = train_test_split(X, y, test_size=strategy_cfg["eval_split"], random_state=42)

    if model_type == "lgbm":
        with open(output_dir / "strategy_lgbm.pkl", "rb") as f:
            model = pickle.load(f)
        preds = model.predict(X_val)

    elif model_type == "mlp":
        import torch
        import torch.nn as nn
        from train_strategy import ALL_TYPES, ALL_ROLES

        # Rebuild model architecture
        mlp_cfg = cfg["strategy"]["mlp"]
        dims = [X_val.shape[1]] + mlp_cfg["hidden_dims"] + [1]
        layers = []
        for i in range(len(dims) - 1):
            layers.append(nn.Linear(dims[i], dims[i + 1]))
            if i < len(dims) - 2:
                layers += [nn.ReLU(), nn.Dropout(mlp_cfg["dropout"])]
        model = nn.Sequential(*layers)
        model.load_state_dict(torch.load(output_dir / "strategy_mlp.pt", map_location="cpu", weights_only=True))
        model.eval()
        with torch.no_grad():
            preds = model(torch.tensor(X_val)).squeeze(1).numpy()
    else:
        raise ValueError(f"Unknown model type: {model_type}")

    ndcg = ndcg_at_k(y_val, preds, k=10)
    target = strategy_cfg["target_ndcg"]
    status = "PASS" if ndcg >= target else "FAIL"

    print(f"[eval_strategy] {status} — NDCG@10={ndcg:.4f}  target={target}  val_size={len(y_val)}")

    # Score distribution
    buckets = [0] * 5
    for s in y_val:
        buckets[min(4, int(s * 5))] += 1
    print("[eval_strategy] score distribution (0–1):")
    for i, count in enumerate(buckets):
        lo, hi = i * 0.2, (i + 1) * 0.2
        print(f"  [{lo:.1f}–{hi:.1f}]  {count}")

    return ndcg >= target


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=str(Path(__file__).parent.parent / "config.yaml"))
    parser.add_argument("--model", default="lgbm", choices=["lgbm", "mlp"])
    args = parser.parse_args()
    ok = main(args.config, args.model)
    sys.exit(0 if ok else 1)
