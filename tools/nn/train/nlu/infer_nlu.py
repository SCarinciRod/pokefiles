"""Inference server for the NLU intent classifier.

Protocol (JSON-lines over stdin/stdout):
  Startup:  prints {"type": "ready"} when model loaded.
  Request:  {"id": "x", "text": "sinergias para torkoal"}
  Response: {"id": "x", "intent": "synergy", "confidence": 0.97}
  Shutdown: {"type": "exit"} or EOF on stdin

Run standalone:
    python tools/nn/train/nlu/infer_nlu.py
"""
from __future__ import annotations

import json
import os
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")

_HERE = Path(__file__).parent
_PROJECT_ROOT = (_HERE / ".." / ".." / ".." / "..").resolve()
_model_dir_env = os.environ.get('NLU_MODEL_DIR')
MODEL_DIR = Path(_model_dir_env) if _model_dir_env else (_PROJECT_ROOT / ".local_cache" / "nn_models" / "nlu")


def _load_model():
    import torch
    import torch.nn as nn
    from sentence_transformers import SentenceTransformer

    meta_path = MODEL_DIR / "meta.json"
    if not meta_path.exists():
        sys.stderr.write(f"[infer_nlu] model not found: {meta_path}\n")
        sys.stderr.flush()
        sys.exit(1)

    with open(meta_path) as f:
        meta = json.load(f)

    with open(MODEL_DIR / "label_map.json") as f:
        label_map: dict[str, str] = json.load(f)
    int_to_label = {int(k): v for k, v in label_map.items()}

    encoder = SentenceTransformer(str(MODEL_DIR / "encoder"))
    encoder.max_seq_length = meta.get("max_seq_length", 64)

    class NLUClassifier(nn.Module):
        def __init__(self, encoder_dim: int, num_classes: int):
            super().__init__()
            self.classifier = nn.Sequential(
                nn.BatchNorm1d(encoder_dim),
                nn.Dropout(0.2),
                nn.Linear(encoder_dim, 256),
                nn.GELU(),
                nn.BatchNorm1d(256),
                nn.Dropout(0.2),
                nn.Linear(256, num_classes),
            )

        def forward(self, x):
            return self.classifier(x)

    device = torch.device("cpu")
    num_classes = meta["num_classes"]
    encoder_dim = meta["encoder_dim"]

    model = NLUClassifier(encoder_dim, num_classes).to(device)
    model.load_state_dict(torch.load(MODEL_DIR / "classifier.pt", map_location=device))
    model.eval()

    sys.stderr.write(
        f"[infer_nlu] model loaded: {num_classes} intents, "
        f"acc={meta.get('best_val_acc', '?'):.4f}\n"
    )
    sys.stderr.flush()
    return encoder, model, int_to_label, device


def predict(encoder, model, int_to_label, device, texts: list[str]):
    import torch
    import torch.nn.functional as F

    embeddings = encoder.encode(texts, batch_size=32, show_progress_bar=False, convert_to_numpy=True)
    with torch.no_grad():
        logits = model(torch.tensor(embeddings).to(device))
        probs = F.softmax(logits, dim=-1).cpu().numpy()

    results = []
    for i, prob_row in enumerate(probs):
        best_idx = int(prob_row.argmax())
        results.append({
            "intent":     int_to_label[best_idx],
            "confidence": float(prob_row[best_idx]),
        })
    return results


def main() -> None:
    encoder, model, int_to_label, device = _load_model()

    print(json.dumps({"type": "ready"}), flush=True)

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as exc:
            sys.stderr.write(f"[infer_nlu] json parse error: {exc}\n")
            sys.stderr.flush()
            continue

        if req.get("type") == "exit":
            break

        req_id = req.get("id", "")
        text = req.get("text", "")

        if not text:
            print(json.dumps({"id": req_id, "intent": "unknown", "confidence": 0.0}), flush=True)
            continue

        try:
            results = predict(encoder, model, int_to_label, device, [text])
            r = results[0]
            print(json.dumps({"id": req_id, "intent": r["intent"], "confidence": r["confidence"]}), flush=True)
        except Exception as exc:
            sys.stderr.write(f"[infer_nlu] predict error: {exc}\n")
            sys.stderr.flush()
            print(json.dumps({"id": req_id, "intent": "unknown", "confidence": 0.0}), flush=True)


if __name__ == "__main__":
    main()
