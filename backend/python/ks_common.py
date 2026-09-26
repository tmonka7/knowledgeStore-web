"""Shared pieces of the translation scripts run by the API.

Every script here talks to the Node side the same way: one JSON object per
line on stdout ({"event": ..., ...}), which the API turns into job progress.
Anything else — warnings, tracebacks — goes to stderr and ends up in the job
log. A script that fails emits an "error" event and exits non-zero.
"""
import json
import os
import sys
import zipfile

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


WEIGHT_FILES = ("model.safetensors", "pytorch_model.bin")


def weights_problem(path):
    """Why a weights file cannot be whole, or "" when it looks intact.

    Reads only a few bytes, so it is cheap even for gigabyte files. A download
    or copy that stops early loses the end of the file, which these formats
    make detectable:
    - a current pytorch_model.bin is a zip archive whose directory sits at the
      very end — losing it is PyTorch's "failed finding central directory";
    - model.safetensors starts with a header giving every tensor's offsets.
    Older checkpoints (many Opus-MT ones) are a bare pickle stream instead,
    which has no such marker; for those only the recorded size can tell.
    """
    size = os.path.getsize(path)
    if path.endswith(".bin"):
        with open(path, "rb") as handle:
            magic = handle.read(4)
        if magic.startswith(b"PK"):
            if not zipfile.is_zipfile(path):
                return f"cut off: its zip directory is missing ({size:,} bytes)"
        elif not magic.startswith(b"\x80"):
            return f"not a PyTorch checkpoint ({size:,} bytes)"
    elif path.endswith(".safetensors"):
        with open(path, "rb") as handle:
            head = handle.read(8)
            if len(head) < 8:
                return f"cut off ({size:,} bytes)"
            header_length = int.from_bytes(head, "little")
            if header_length > min(size - 8, 100_000_000):
                return "its header is damaged"
            try:
                header = json.loads(handle.read(header_length))
            except ValueError:
                return "its header is damaged"
        end = max((entry["data_offsets"][1] for key, entry in header.items() if key != "__metadata__"), default=0)
        if 8 + header_length + end != size:
            return f"cut off ({size:,} of {8 + header_length + end:,} bytes)"
    return ""


def model_problems(model_dir):
    """Every reason the model in model_dir cannot load, as readable strings."""
    expected = read_meta(model_dir).get("files", {})
    names = set(os.listdir(model_dir)) if os.path.isdir(model_dir) else set()
    problems = []
    if not any(name in names for name in WEIGHT_FILES):
        problems.append("the weights file is missing")
    for name, size in expected.items():
        if name in names and os.path.getsize(os.path.join(model_dir, name)) != size:
            problems.append(f"{name} is {os.path.getsize(os.path.join(model_dir, name)):,} bytes, expected {size:,}")
        elif name not in names:
            problems.append(f"{name} is missing")
    for name in sorted(names):
        if name.endswith((".bin", ".safetensors")) and name not in expected:
            problem = weights_problem(os.path.join(model_dir, name))
            if problem:
                problems.append(f"{name} is {problem}")
    return problems


def check_model(model_dir):
    """Stop with a clear message, before loading, if a model's files are damaged."""
    problems = model_problems(model_dir)
    if not problems:
        return
    meta = read_meta(model_dir)
    if meta.get("kind") == "finetuned":
        fix = "Delete it and train it again."
    else:
        fix = "Repair it with: python backend/python/download_models.py --verify --repair"
    fail(f"The model {meta.get('name') or os.path.basename(model_dir)} is damaged: {'; '.join(problems)}. "
         f"This happens when a download or a copy of the models folder is interrupted. {fix}")


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


# Dataset codes that differ from the ones M2M100 / NLLB-style models use.
LANGUAGE_ALIASES = {"jp": "ja", "jpn": "ja", "kor": "ko", "zho": "zh", "chi": "zh", "eng": "en", "spa": "es"}


def is_multilingual(tokenizer):
    """M2M100-style tokenizers pick languages with codes; Marian ones do not."""
    return hasattr(tokenizer, "get_lang_id") or bool(getattr(tokenizer, "lang_code_to_id", None))


def model_language(tokenizer, code):
    """A dataset language code ("ko", "zh-Hans", "jp") as the model's code ("ko")."""
    supported = set(getattr(tokenizer, "lang_code_to_id", {}) or {})
    for candidate in (code, code.replace("-", "_"), code.split("-")[0].split("_")[0].lower()):
        candidate = LANGUAGE_ALIASES.get(candidate, candidate)
        if not supported or candidate in supported:
            return candidate
    fail(f'This model has no language "{code}".')


def setup_languages(tokenizer, model, source, target):
    """Point a multilingual model at source -> target; a no-op for Marian.

    Returns the extra generate() arguments: a multilingual model is told which
    language to write by forcing its first generated token. The same setting
    goes into the model's generation config, so a fine-tuned model saved
    afterwards translates into `target` without being told.
    """
    if not is_multilingual(tokenizer):
        return {}
    tokenizer.src_lang = model_language(tokenizer, source)
    tokenizer.tgt_lang = model_language(tokenizer, target)
    forced = tokenizer.get_lang_id(tokenizer.tgt_lang)
    if getattr(model, "generation_config", None) is not None:
        model.generation_config.forced_bos_token_id = forced
    return {"forced_bos_token_id": forced}


def pick_device():
    import torch
    if torch.cuda.is_available():
        return torch.device("cuda")
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")
