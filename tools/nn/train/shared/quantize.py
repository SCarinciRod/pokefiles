"""Post-training quantization helpers (INT8 via PyTorch dynamic quantization)."""
from pathlib import Path

import torch
import torch.nn as nn


def quantize_dynamic(model: nn.Module, output_path: str | Path) -> nn.Module:
    """Applies dynamic INT8 quantization and saves to output_path."""
    quantized = torch.quantization.quantize_dynamic(
        model,
        {nn.Linear},
        dtype=torch.qint8,
    )
    torch.save(quantized.state_dict(), output_path)
    return quantized


def model_size_mb(path: str | Path) -> float:
    return Path(path).stat().st_size / (1024 * 1024)
