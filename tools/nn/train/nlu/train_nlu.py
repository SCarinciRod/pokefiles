"""Fine-tunes a multilingual sentence-transformer for intent classification.

Base model: paraphrase-multilingual-MiniLM-L12-v2 (~90 MB, supports PT-BR natively)
Architecture: sentence-transformer encoder → mean pooling → linear classifier

Usage:
    python nlu/train_nlu.py [--config=../config.yaml]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import yaml
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sentence_transformers import SentenceTransformer
from torch.utils.data import DataLoader, Dataset
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).parent.parent))
from shared.rule_data_loader import load_intent_examples
from shared.validate_model import validate_nlu_dataset


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------
class IntentDataset(Dataset):
    def __init__(self, texts: list[str], labels: list[int]):
        self.texts = texts
        self.labels = labels

    def __len__(self) -> int:
        return len(self.texts)

    def __getitem__(self, idx: int) -> tuple[str, int]:
        return self.texts[idx], self.labels[idx]


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------
class NLUClassifier(nn.Module):
    def __init__(self, encoder_dim: int, num_classes: int, dropout: float = 0.1):
        super().__init__()
        self.classifier = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(encoder_dim, num_classes),
        )

    def forward(self, embeddings: torch.Tensor) -> torch.Tensor:
        return self.classifier(embeddings)


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------
def encode_batch(encoder: SentenceTransformer, texts: list[str], batch_size: int = 64) -> np.ndarray:
    return encoder.encode(texts, batch_size=batch_size, show_progress_bar=False, convert_to_numpy=True)


def train_epoch(
    model: NLUClassifier,
    optimizer: torch.optim.Optimizer,
    criterion: nn.Module,
    embeddings: torch.Tensor,
    labels: torch.Tensor,
    batch_size: int,
    device: torch.device,
) -> float:
    model.train()
    indices = torch.randperm(len(embeddings))
    total_loss = 0.0
    for start in range(0, len(embeddings), batch_size):
        batch_idx = indices[start : start + batch_size]
        x = embeddings[batch_idx].to(device)
        y = labels[batch_idx].to(device)
        optimizer.zero_grad()
        logits = model(x)
        loss = criterion(logits, y)
        loss.backward()
        optimizer.step()
        total_loss += loss.item() * len(batch_idx)
    return total_loss / len(embeddings)


@torch.no_grad()
def evaluate(
    model: NLUClassifier,
    embeddings: torch.Tensor,
    labels: torch.Tensor,
    device: torch.device,
) -> float:
    model.eval()
    logits = model(embeddings.to(device))
    preds = logits.argmax(dim=-1).cpu()
    return (preds == labels).float().mean().item()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main(config_path: str) -> None:
    with open(config_path) as f:
        cfg = yaml.safe_load(f)

    nlu_cfg = cfg["nlu"]
    training_dir = Path(config_path).parent / cfg["paths"]["training_dir"]
    output_dir = Path(config_path).parent / nlu_cfg["output_dir"]
    output_dir.mkdir(parents=True, exist_ok=True)

    # Load data
    examples = load_intent_examples(training_dir)
    if not examples:
        raise RuntimeError(f"No intent training data found in {training_dir}")

    label_encoder = LabelEncoder()
    texts = [ex["text"] for ex in examples]
    raw_labels = [ex["intent"] for ex in examples]
    labels = label_encoder.fit_transform(raw_labels)
    label_set = set(raw_labels)

    validate_nlu_dataset(examples, label_set)
    print(f"[train_nlu] {len(examples)} examples, {len(label_encoder.classes_)} intents")

    # Train/eval split
    X_train, X_val, y_train, y_val = train_test_split(
        texts, labels, test_size=nlu_cfg["eval_split"], random_state=42, stratify=labels
    )

    # Encoder
    encoder = SentenceTransformer(nlu_cfg["base_model"])
    encoder.max_seq_length = nlu_cfg["max_seq_length"]

    print("[train_nlu] encoding training data...")
    train_emb = torch.tensor(encode_batch(encoder, X_train, nlu_cfg["batch_size"]))
    val_emb = torch.tensor(encode_batch(encoder, X_val, nlu_cfg["batch_size"]))
    y_train_t = torch.tensor(y_train, dtype=torch.long)
    y_val_t = torch.tensor(y_val, dtype=torch.long)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    encoder_dim = train_emb.shape[1]
    num_classes = len(label_encoder.classes_)

    model = NLUClassifier(encoder_dim, num_classes).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=nlu_cfg["learning_rate"])
    criterion = nn.CrossEntropyLoss()

    best_acc = 0.0
    best_state = None

    for epoch in range(1, nlu_cfg["epochs"] + 1):
        loss = train_epoch(model, optimizer, criterion, train_emb, y_train_t,
                           nlu_cfg["batch_size"], device)
        acc = evaluate(model, val_emb, y_val_t, device)
        print(f"[train_nlu] epoch {epoch:02d}  loss={loss:.4f}  val_acc={acc:.4f}")
        if acc > best_acc:
            best_acc = acc
            best_state = {k: v.clone() for k, v in model.state_dict().items()}

    print(f"[train_nlu] best val_acc={best_acc:.4f} (target={nlu_cfg['target_accuracy']})")
    if best_acc < nlu_cfg["target_accuracy"]:
        print("[train_nlu] WARNING: target accuracy not reached — consider more data or epochs")

    # Save
    model.load_state_dict(best_state)
    torch.save(model.state_dict(), output_dir / "classifier.pt")

    # Save label mapping
    label_map = {i: cls for i, cls in enumerate(label_encoder.classes_)}
    with open(output_dir / "label_map.json", "w") as f:
        json.dump(label_map, f, indent=2, ensure_ascii=False)

    # Save encoder
    encoder.save(str(output_dir / "encoder"))

    # Save metadata
    meta = {
        "base_model": nlu_cfg["base_model"],
        "encoder_dim": encoder_dim,
        "num_classes": num_classes,
        "best_val_acc": best_acc,
        "intents": list(label_encoder.classes_),
    }
    with open(output_dir / "meta.json", "w") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    print(f"[train_nlu] model saved to {output_dir}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=str(Path(__file__).parent.parent / "config.yaml"))
    args = parser.parse_args()
    main(args.config)
