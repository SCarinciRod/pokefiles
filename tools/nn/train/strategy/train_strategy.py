"""Trains the strategy scorer: counter + synergy + held item + role.

Two-stage approach:
  1. LightGBM baseline (fast, interpretable, strong out-of-the-box)
  2. MLP fine-tune on top of tabular features (optional, --model=mlp)

Input features per pair: types (one-hot), base stats, roles, synergy markers.
Output: continuous score (normalized 0–1).

Usage:
    python strategy/train_strategy.py [--config=../config.yaml] [--model=lgbm|mlp]
"""
from __future__ import annotations

import argparse
import json
import pickle
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

sys.path.insert(0, str(Path(__file__).parent.parent))
from shared.rule_data_loader import load_all_strategy, load_counter_pairs

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
ALL_TYPES = [
    "normal", "fire", "water", "electric", "grass", "ice",
    "fighting", "poison", "ground", "flying", "psychic", "bug",
    "rock", "ghost", "dragon", "dark", "steel", "fairy",
]

# V2 roles — mirrors ROLE_THRESHOLDS in export_synergy_training_ts.js
ALL_ROLES = [
    "physical_sweeper", "special_sweeper", "physical_wall",
    "special_wall", "tank", "lead", "support_utility",
]

# Feature sizes for V2 (94D total per synergy pair)
_TYPES_DIM = 18
_STATS_DIM = 6
_ROLE_DIM = len(ALL_ROLES)   # 7
_ABILITY_DIM = 8
_MOVE_DIM = 8
SYNERGY_FEATURE_DIM = (_TYPES_DIM + _STATS_DIM + _ROLE_DIM + _ABILITY_DIM + _MOVE_DIM) * 2  # 94


# ---------------------------------------------------------------------------
# Feature extraction
# ---------------------------------------------------------------------------
def type_onehot(types_raw: str | list | None) -> list[float]:
    if isinstance(types_raw, str):
        types = [t.strip() for t in types_raw.split(",") if t.strip()]
    elif isinstance(types_raw, list):
        types = types_raw
    else:
        types = []
    return [1.0 if t in types else 0.0 for t in ALL_TYPES]


def stat_features(row: dict, prefix: str) -> list[float]:
    stats = ["hp", "attack", "defense", "special_attack", "special_defense", "speed"]
    return [float(row.get(f"{prefix}_{s}", row.get(s, 50))) / 255.0 for s in stats]


def extract_counter_features(record: dict) -> tuple[list[float], float]:
    inp = record.get("input", {})
    out = record.get("output", {})

    target_types = type_onehot(inp.get("target_types") or inp.get("types_a"))
    counter_types = type_onehot(inp.get("candidate_types") or inp.get("types_b"))

    attack_pressure = float(out.get("attack_pressure", 0.0))
    defense_pressure = float(out.get("defense_pressure", 0.0))
    score = float(out.get("score", attack_pressure * 0.6 + defense_pressure * 0.4))
    score_norm = min(1.0, max(0.0, score / 1000.0)) if score > 1.0 else score

    feat = target_types + counter_types + [attack_pressure, defense_pressure]
    return feat, score_norm


def normalize_stats(stats_raw) -> list[float]:
    """Normalize a 6-element stat list [hp,atk,def,spa,spd,spe] to [0,1] by dividing by 255."""
    if stats_raw is None:
        return [50.0 / 255.0] * _STATS_DIM
    if isinstance(stats_raw, dict):
        order = ["hp", "attack", "defense", "special_attack", "special_defense", "speed"]
        stats_raw = [float(stats_raw.get(k, 50)) for k in order]
    return [min(1.0, max(0.0, float(v) / 255.0)) for v in stats_raw[:_STATS_DIM]]


def role_onehot(role: str | None) -> list[float]:
    vec = [0.0] * _ROLE_DIM
    if role and role in ALL_ROLES:
        vec[ALL_ROLES.index(role)] = 1.0
    else:
        vec[-1] = 1.0  # default: support_utility
    return vec


def extract_synergy_features(record: dict) -> tuple[list[float], float]:
    """Build 94D feature vector for a synergy pair (V2)."""
    inp = record.get("input", {})
    out = record.get("output", {})

    score = float(out.get("score", 0.0))
    score_norm = min(1.0, max(0.0, score / 1000.0)) if score > 1.0 else score

    types_a = type_onehot(inp.get("types_a"))                          # 18
    types_b = type_onehot(inp.get("types_b"))                          # 18
    stats_a = normalize_stats(inp.get("stats_a"))                      # 6
    stats_b = normalize_stats(inp.get("stats_b"))                      # 6
    role_a  = role_onehot(inp.get("role_a"))                           # 7
    role_b  = role_onehot(inp.get("role_b"))                           # 7
    ab_a    = [float(v) for v in (inp.get("abilities_a") or [0]*8)][:8] # 8
    ab_b    = [float(v) for v in (inp.get("abilities_b") or [0]*8)][:8] # 8
    mv_a    = [float(v) for v in (inp.get("moves_a")    or [0]*8)][:8]  # 8
    mv_b    = [float(v) for v in (inp.get("moves_b")    or [0]*8)][:8]  # 8

    # Pad to exactly _ABILITY_DIM / _MOVE_DIM in case shorter lists arrive
    while len(ab_a) < _ABILITY_DIM: ab_a.append(0.0)
    while len(ab_b) < _ABILITY_DIM: ab_b.append(0.0)
    while len(mv_a) < _MOVE_DIM:    mv_a.append(0.0)
    while len(mv_b) < _MOVE_DIM:    mv_b.append(0.0)

    feat = types_a + types_b + stats_a + stats_b + role_a + role_b + ab_a + ab_b + mv_a + mv_b
    # 18+18+6+6+7+7+8+8+8+8 = 94
    return feat, score_norm


def extract_held_item_features(record: dict) -> tuple[list[float], float]:
    inp = record.get("input", {})
    out = record.get("output", {})

    types = type_onehot(inp.get("types"))
    score = float(out.get("score", 0.0))
    score_norm = min(1.0, max(0.0, score / 1000.0)) if score > 1.0 else score

    feat = types + [0.0] * 18 + [0.0, score_norm]
    return feat, score_norm


def extract_role_features(record: dict) -> tuple[list[float], float]:
    inp = record.get("input", {})
    out = record.get("output", {})

    types = type_onehot(inp.get("types"))
    bs = inp.get("base_stats", {})
    stats = [
        float(bs.get("hp", 50)) / 255.0,
        float(bs.get("attack", 50)) / 255.0,
        float(bs.get("defense", 50)) / 255.0,
        float(bs.get("special_attack", 50)) / 255.0,
        float(bs.get("special_defense", 50)) / 255.0,
        float(bs.get("speed", 50)) / 255.0,
    ]
    role = out.get("role", "balanced")
    role_idx = ALL_ROLES.index(role) / (len(ALL_ROLES) - 1) if role in ALL_ROLES else 0.5

    feat = types + [0.0] * 18 + stats + [role_idx, 0.0]
    # Pad to standard length (18+18+2 = 38)
    feat = feat[:38]
    while len(feat) < 38:
        feat.append(0.0)
    return feat, role_idx


def build_dataset(records: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """Build dataset from all records, padding/truncating each to SYNERGY_FEATURE_DIM (94)."""
    features, scores = [], []
    for rec in records:
        source = rec.get("source_rule", "")
        try:
            if "counter" in source or "matchup" in source:
                f, s = extract_counter_features(rec)
            elif "synergy" in source or "doubles" in source:
                f, s = extract_synergy_features(rec)
            elif "held_item" in source:
                f, s = extract_held_item_features(rec)
            elif "role" in source:
                f, s = extract_role_features(rec)
            else:
                f, s = extract_counter_features(rec)

            # Pad or truncate to SYNERGY_FEATURE_DIM so all samples share the same shape
            if len(f) < SYNERGY_FEATURE_DIM:
                f = f + [0.0] * (SYNERGY_FEATURE_DIM - len(f))
            elif len(f) > SYNERGY_FEATURE_DIM:
                f = f[:SYNERGY_FEATURE_DIM]

            features.append(f)
            scores.append(s)
        except Exception:
            continue

    return np.array(features, dtype=np.float32), np.array(scores, dtype=np.float32)


# ---------------------------------------------------------------------------
# LightGBM model
# ---------------------------------------------------------------------------
def train_lgbm(X_train, y_train, X_val, y_val, cfg: dict):
    import lightgbm as lgb

    lgb_cfg = cfg["lgbm"]
    model = lgb.LGBMRegressor(
        num_leaves=lgb_cfg["num_leaves"],
        n_estimators=lgb_cfg["n_estimators"],
        learning_rate=lgb_cfg["learning_rate"],
        min_child_samples=lgb_cfg["min_child_samples"],
        subsample=lgb_cfg["subsample"],
        colsample_bytree=lgb_cfg["colsample_bytree"],
        random_state=42,
        verbose=-1,
    )
    model.fit(X_train, y_train, eval_set=[(X_val, y_val)])
    return model


# ---------------------------------------------------------------------------
# MLP model
# ---------------------------------------------------------------------------
def train_mlp(X_train, y_train, X_val, y_val, cfg: dict):
    import torch
    import torch.nn as nn

    mlp_cfg = cfg["mlp"]
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    dims = [X_train.shape[1]] + mlp_cfg["hidden_dims"] + [1]
    layers = []
    for i in range(len(dims) - 1):
        layers.append(nn.Linear(dims[i], dims[i + 1]))
        if i < len(dims) - 2:
            layers += [nn.ReLU(), nn.Dropout(mlp_cfg["dropout"])]
    model = nn.Sequential(*layers).to(device)

    optimizer = torch.optim.Adam(model.parameters(), lr=mlp_cfg["learning_rate"])
    criterion = nn.MSELoss()

    X_t = torch.tensor(X_train).to(device)
    y_t = torch.tensor(y_train).unsqueeze(1).to(device)
    X_v = torch.tensor(X_val).to(device)
    y_v = torch.tensor(y_val).unsqueeze(1).to(device)

    best_loss = float("inf")
    best_state = None

    for epoch in range(1, mlp_cfg["epochs"] + 1):
        model.train()
        optimizer.zero_grad()
        loss = criterion(model(X_t), y_t)
        loss.backward()
        optimizer.step()

        model.eval()
        with torch.no_grad():
            val_loss = criterion(model(X_v), y_v).item()
        if val_loss < best_loss:
            best_loss = val_loss
            best_state = {k: v.clone() for k, v in model.state_dict().items()}

        if epoch % 5 == 0:
            print(f"  epoch {epoch:03d}  val_loss={val_loss:.5f}")

    model.load_state_dict(best_state)
    return model


# ---------------------------------------------------------------------------
# NDCG helper
# ---------------------------------------------------------------------------
def ndcg_at_k(true_scores: np.ndarray, pred_scores: np.ndarray, k: int = 10) -> float:
    order = np.argsort(pred_scores)[::-1][:k]
    dcg = sum(true_scores[i] / np.log2(rank + 2) for rank, i in enumerate(order))
    ideal_order = np.argsort(true_scores)[::-1][:k]
    idcg = sum(true_scores[i] / np.log2(rank + 2) for rank, i in enumerate(ideal_order))
    return dcg / idcg if idcg > 0 else 0.0


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main(config_path: str, model_type: str = "lgbm") -> None:
    with open(config_path) as f:
        cfg = yaml.safe_load(f)

    strategy_cfg = cfg["strategy"]
    training_dir = Path(config_path).parent / cfg["paths"]["training_dir"]
    output_dir = Path(config_path).parent / strategy_cfg["output_dir"]
    output_dir.mkdir(parents=True, exist_ok=True)

    records = load_all_strategy(training_dir)
    if not records:
        raise RuntimeError(f"No strategy training data in {training_dir} — run export_rule_training.js first")

    print(f"[train_strategy] {len(records)} records loaded")
    X, y = build_dataset(records)
    print(f"[train_strategy] features={X.shape}  score_range=[{y.min():.3f}, {y.max():.3f}]")

    from sklearn.model_selection import train_test_split
    X_train, X_val, y_train, y_val = train_test_split(
        X, y, test_size=strategy_cfg["eval_split"], random_state=42
    )

    if model_type == "lgbm":
        print("[train_strategy] training LightGBM...")
        model = train_lgbm(X_train, y_train, X_val, y_val, strategy_cfg)
        model_path = output_dir / "strategy_lgbm.pkl"
        with open(model_path, "wb") as f:
            pickle.dump(model, f)
        preds = model.predict(X_val)

    elif model_type == "mlp":
        print("[train_strategy] training MLP...")
        model = train_mlp(X_train, y_train, X_val, y_val, strategy_cfg)
        import torch
        model_path = output_dir / "strategy_mlp.pt"
        torch.save(model.state_dict(), model_path)
        model.eval()
        import torch
        with torch.no_grad():
            preds = model(torch.tensor(X_val)).squeeze(1).numpy()

    else:
        raise ValueError(f"Unknown model type: {model_type}")

    ndcg = ndcg_at_k(y_val, preds, k=10)
    print(f"[train_strategy] val NDCG@10={ndcg:.4f} (target={strategy_cfg['target_ndcg']})")
    if ndcg < strategy_cfg["target_ndcg"]:
        print("[train_strategy] WARNING: target NDCG not reached — consider more training data")

    meta = {
        "model_type": model_type,
        "num_records": len(records),
        "feature_dim": int(X.shape[1]),
        "val_ndcg_at_10": float(ndcg),
        "model_file": str(model_path.name),
    }
    with open(output_dir / "meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    print(f"[train_strategy] saved to {output_dir}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=str(Path(__file__).parent.parent / "config.yaml"))
    parser.add_argument("--model", default="lgbm", choices=["lgbm", "mlp"])
    args = parser.parse_args()
    main(args.config, args.model)
