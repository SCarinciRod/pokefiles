"""Async inference server for the strategy LightGBM model.

Protocol (JSON-lines over stdin/stdout):
  Startup:  prints {"type": "ready"} when model is loaded.
  Request:  {"id": "x", "features": [...94 floats...]}
  Response: {"id": "x", "score": 0.73}
  Batch:    {"id": "x", "type": "batch", "records": [{"pair_id": "...", "features": [...94...]}, ...]}
  B.Resp:   {"id": "x", "scores": [{"pair_id": "...", "score": 0.73}, ...]}
  Shutdown: {"type": "exit"} or EOF on stdin

Run standalone:
    python tools/nn/train/strategy/infer_strategy.py
"""
from __future__ import annotations

import json
import os
import pickle
import sys
import warnings
from pathlib import Path

import numpy as np
warnings.filterwarnings('ignore', category=UserWarning)

# ---------------------------------------------------------------------------
# Model path
# ---------------------------------------------------------------------------
_HERE = Path(__file__).parent
_PROJECT_ROOT = (_HERE / ".." / ".." / ".." / "..").resolve()
_strategy_dir_env = os.environ.get('STRATEGY_MODEL_DIR')
_strategy_dir = Path(_strategy_dir_env) if _strategy_dir_env else (_PROJECT_ROOT / ".local_cache" / "nn_models" / "strategy")
MODEL_PATH = _strategy_dir / "strategy_lgbm.pkl"


def _load_model():
    if not MODEL_PATH.exists():
        sys.stderr.write(f"[infer] model not found: {MODEL_PATH}\n")
        sys.stderr.flush()
        sys.exit(1)
    with open(MODEL_PATH, "rb") as f:
        model = pickle.load(f)
    sys.stderr.write(f"[infer] model loaded from {MODEL_PATH}\n")
    sys.stderr.flush()
    return model


# ---------------------------------------------------------------------------
# Main server loop
# ---------------------------------------------------------------------------
def main() -> None:
    model = _load_model()

    # Signal readiness to the bridge
    print(json.dumps({"type": "ready"}), flush=True)

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        try:
            req = json.loads(line)
        except json.JSONDecodeError as exc:
            sys.stderr.write(f"[infer] json parse error: {exc}\n")
            sys.stderr.flush()
            continue

        req_type = req.get("type")

        # Graceful shutdown
        if req_type == "exit":
            break

        req_id = req.get("id", "")

        # Batch mode: many pairs at once
        if req_type == "batch":
            records = req.get("records", [])
            if not records:
                print(json.dumps({"id": req_id, "scores": []}), flush=True)
                continue
            try:
                X = np.array([r["features"] for r in records], dtype=np.float32)
                raw_scores = model.predict(X)
                # Clamp to [0, 1]
                raw_scores = np.clip(raw_scores, 0.0, 1.0)
                result = [
                    {"pair_id": records[i]["pair_id"], "score": float(raw_scores[i])}
                    for i in range(len(records))
                ]
                print(json.dumps({"id": req_id, "scores": result}), flush=True)
            except Exception as exc:
                sys.stderr.write(f"[infer] batch error: {exc}\n")
                sys.stderr.flush()
                print(json.dumps({"id": req_id, "scores": []}), flush=True)
            continue

        # Single inference
        features = req.get("features")
        if features is None:
            continue
        try:
            X = np.array([features], dtype=np.float32)
            score = float(np.clip(model.predict(X)[0], 0.0, 1.0))
            print(json.dumps({"id": req_id, "score": score}), flush=True)
        except Exception as exc:
            sys.stderr.write(f"[infer] predict error: {exc}\n")
            sys.stderr.flush()
            print(json.dumps({"id": req_id, "score": 0.5}), flush=True)


if __name__ == "__main__":
    main()
