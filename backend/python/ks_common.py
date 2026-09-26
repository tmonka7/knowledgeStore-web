"""Shared pieces of the translation scripts run by the API.

Every script here talks to the Node side the same way: one JSON object per
line on stdout ({"event": ..., ...}), which the API turns into job progress.
Anything else — warnings, tracebacks — goes to stderr and ends up in the job
log. A script that fails emits an "error" event and exits non-zero.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.environ.get("TRANSLATION_MODELS_DIR") or os.path.join(HERE, "models")
META_FILE = "ks-model.json"


def go_offline():
    """Never touch the network: every model is read from MODELS_DIR.

    Set before transformers is imported, which reads these once at import.
    """
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


def emit(event, **data):
    print(json.dumps({"event": event, **data}, ensure_ascii=False), flush=True)


def fail(message, code=1):
    emit("error", message=message)
    sys.exit(code)


def read_meta(model_dir):
    try:
        with open(os.path.join(model_dir, META_FILE), encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return {}


def write_meta(model_dir, meta):
    with open(os.path.join(model_dir, META_FILE), "w", encoding="utf-8") as handle:
        json.dump(meta, handle, ensure_ascii=False, indent=2)


def load_pairs(dataset_path, source, target):
    """(source, target) sentence pairs from a dataset.jsonl, blanks skipped."""
    pairs = []
    with open(dataset_path, encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            texts = json.loads(line).get("translation", {})
            src = (texts.get(source) or "").strip()
            tgt = (texts.get(target) or "").strip()
            if src and tgt:
                pairs.append((src, tgt))
    return pairs


def pick_device():
    import torch
    if torch.cuda.is_available():
        return torch.device("cuda")
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")
