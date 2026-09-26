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


def _finite(value):
    """NaN and infinity as None: JSON has no NaN, and the API's parser rejects it."""
    if isinstance(value, float) and value != value or value in (float("inf"), float("-inf")):
        return None
    if isinstance(value, dict):
        return {key: _finite(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_finite(item) for item in value]
    return value


def go_offline_yolo():
    """Keep Ultralytics from reaching the network, before it is imported.

    Left alone it checks for updates, downloads fonts to draw plots, and
    pip-installs packages it finds missing (onnx, onnxslim) — none of which
    works, or should happen, on an offline server. Its settings file goes in
    the models folder rather than the user profile.
    """
    go_offline()
    os.environ["YOLO_OFFLINE"] = "1"
    os.environ["YOLO_AUTOINSTALL"] = "false"
    os.environ.setdefault("YOLO_VERBOSE", "false")
    # Ultralytics only uses this folder if it already exists and is writable;
    # otherwise it silently falls back to the user profile.
    config_dir = os.environ.setdefault("YOLO_CONFIG_DIR", os.path.join(MODELS_DIR, ".ultralytics"))
    os.makedirs(config_dir, exist_ok=True)


def yolo_weights(model_dir):
    """The .pt file in a YOLO model folder."""
    names = sorted(name for name in os.listdir(model_dir) if name.endswith(".pt"))
    if not names:
        fail(f"There is no .pt weights file in {model_dir}.")
    return os.path.join(model_dir, "model.pt" if "model.pt" in names else names[0])


def emit(event, **data):
    print(json.dumps({"event": event, **_finite(data)}, ensure_ascii=False), flush=True)


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

# Bytes per element of the storage classes a legacy torch.save names.
LEGACY_ELEMENT_SIZES = {
    "DoubleStorage": 8, "FloatStorage": 4, "HalfStorage": 2, "BFloat16Storage": 2, "LongStorage": 8,
    "IntStorage": 4, "ShortStorage": 2, "CharStorage": 1, "ByteStorage": 1, "BoolStorage": 1,
}


def legacy_checkpoint_size(path):
    """How long a legacy (pre-zip) torch.save file must be, or None if unknown.

    That format is: a few small pickles (magic number, protocol, system info),
    the model pickle, the list of storage keys, then each storage's raw bytes
    preceded by an 8-byte element count. The model pickle names every
    storage's type and element count, so the full length follows from the
    first few kilobytes — without torch, and offline.

    The pickle is read with an unpickler that builds nothing real: every class
    it names becomes an inert stand-in, so no code from the file can run.
    """
    import pickle
    from collections import OrderedDict

    class Inert:
        def __init__(self, *args, **kwargs):
            pass

        def __call__(self, *args, **kwargs):
            return Inert()

        def __setstate__(self, state):
            pass

        def __setitem__(self, key, value):
            pass

    storages = {}

    class Reader(pickle.Unpickler):
        def find_class(self, module, name):
            if module == "collections" and name == "OrderedDict":
                return OrderedDict
            if module.startswith("torch") and name.endswith("Storage"):
                return type(name, (Inert,), {"storage_name": name})
            return Inert

        def persistent_load(self, pid):
            # ("storage", storage_type, key, location, element_count, view_metadata)
            if isinstance(pid, tuple) and len(pid) >= 5 and pid[0] == "storage":
                element_size = LEGACY_ELEMENT_SIZES.get(getattr(pid[1], "storage_name", ""))
                if element_size is None:
                    raise ValueError(f"unknown storage type {pid[1]!r}")
                storages[pid[2]] = pid[4] * element_size
            return Inert()

    try:
        with open(path, "rb") as handle:
            for _ in range(3):  # magic number, protocol version, system info
                Reader(handle).load()
            Reader(handle).load()
            keys = Reader(handle).load()
            offset = handle.tell()
        return offset + sum(8 + storages[key] for key in keys)
    except (EOFError, pickle.UnpicklingError):
        return -1  # The file ends inside its own index: certainly cut off.
    except Exception:  # noqa: BLE001 — an unfamiliar variant; do not guess
        return None


def weights_problem(path):
    """Why a weights file cannot be whole, or "" when it looks intact.

    Reads only a few bytes, so it is cheap even for gigabyte files. A download
    or copy that stops early loses the end of the file, which these formats
    make detectable:
    - a current pytorch_model.bin is a zip archive whose directory sits at the
      very end — losing it is PyTorch's "failed finding central directory";
    - model.safetensors starts with a header giving every tensor's offsets.
    - an older checkpoint (many Opus-MT ones) is a bare pickle stream whose
      index gives every tensor's size — see legacy_checkpoint_size — which is
      PyTorch's "unexpected EOF, expected N more bytes" when it falls short.
    """
    size = os.path.getsize(path)
    if path.endswith((".bin", ".pt")):
        with open(path, "rb") as handle:
            magic = handle.read(4)
        if magic.startswith(b"PK"):
            if not zipfile.is_zipfile(path):
                return f"cut off: its zip directory is missing ({size:,} bytes)"
        elif magic.startswith(b"\x80"):
            expected = legacy_checkpoint_size(path)
            if expected == -1:
                return f"cut off ({size:,} bytes)"
            if expected is not None and expected != size:
                return f"cut off ({size:,} of {expected:,} bytes)"
        else:
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
    if not any(name in names or name.endswith(".pt") for name in WEIGHT_FILES) \
            and not any(name.endswith(".pt") for name in names):
        problems.append("the weights file is missing")
    for name, size in expected.items():
        if name in names and os.path.getsize(os.path.join(model_dir, name)) != size:
            problems.append(f"{name} is {os.path.getsize(os.path.join(model_dir, name)):,} bytes, expected {size:,}")
        elif name not in names:
            problems.append(f"{name} is missing")
    for name in sorted(names):
        if name.endswith((".bin", ".pt", ".safetensors")) and name not in expected:
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
