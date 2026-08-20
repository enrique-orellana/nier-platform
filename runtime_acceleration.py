"""Runtime device selection for optional NVIDIA acceleration."""

from __future__ import annotations

import os
from functools import lru_cache


@lru_cache(maxsize=1)
def cuda_available() -> bool:
    """Return whether the installed PyTorch runtime can see a CUDA device."""
    try:
        import torch

        return bool(torch.cuda.is_available())
    except Exception:
        return False


def preferred_device() -> str:
    """Select CUDA when available, while keeping an explicit CPU fallback."""
    requested = os.environ.get("OPENSHORTS_DEVICE", "auto").strip().lower()
    if requested == "cpu":
        return "cpu"
    if requested == "cuda":
        return "cuda" if cuda_available() else "cpu"
    return "cuda" if cuda_available() else "cpu"
