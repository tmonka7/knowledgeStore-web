"""Fetch translation models into backend/python/models/base, once.

This is the only script that uses the network. Run it on a machine with
internet access; after that, training, translation and ONNX export read the
models from disk and never go online. The models folder can be copied as-is
to an offline machine.

    python download_models.py en-es en-zh
    python download_models.py en-ja=Helsinki-NLP/opus-mt-en-jap
    python download_models.py m2m100
    python download_models.py yolo26n yolo26n-seg whisper-tiny
    python download_models.py paddleocr
    python download_models.py supertonic-3
    python download_models.py --list
    python download_models.py --verify [--repair]

A plain "src-tgt" means Helsinki-NLP/opus-mt-src-tgt, a small model for one
direction. Use "src-tgt=repo" when the repository's language codes differ from
the ones your datasets use (Opus-MT calls Japanese "jap", for example).

"m2m100" fetches facebook/m2m100_418M (MIT licence, about 1.9 GB): a single
multilingual model that translates between any two of 100 languages. It is
the fallback for pairs Opus-MT has no working model for, such as en-ko.
"multi=<repo>" fetches another model of the same family.

For the YOLO and Speech to Text tools: "yolo26n" / "yolo26n-seg" (or any other
Ultralytics weights name, e.g. "yolo11s") fetch detection / segmentation
weights from Ultralytics' GitHub releases (AGPL-3.0), and "whisper-tiny" (or
whisper-base, whisper-small) fetches OpenAI's Whisper speech-recognition model.

For Speaker recognition: "ecapa" fetches SpeechBrain's ECAPA-TDNN speaker
embedding model (speechbrain/spkrec-ecapa-voxceleb, Apache-2.0, about 90 MB).

For OCR (PaddleOCR 3, Apache-2.0): "paddleocr" fetches the PP-OCRv5 mobile
models, about 90 MB — text detection, the text-line orientation classifier,
recognition for Chinese and Japanese (one model, which reads English too),
English, Korean and Russian, and the layout and table-structure models that
keep a page's titles, tables and figures. "paddleocr-server" adds the larger
server detection, Chinese/Japanese recognition and layout models (about
300 MB), which are more accurate and slower.
With the mobile models comes an ONNX copy of each (about 65 MB, converted by
RapidOCR from the same weights, from ModelScope): with onnxruntime installed,
OCR runs on ONNX Runtime, which reads the same text several times faster on a
CPU than Paddle. If ModelScope cannot be reached, OCR works without them.

For Text to Speech: "supertonic-3" fetches Supertone's Supertonic 3
(Supertone/supertonic-3, OpenRAIL-M, about 400 MB): four ONNX models and ten
preset voices, which read 31 languages aloud, run with onnxruntime.

For Voice recognition (whisper.cpp, run through pywhispercpp): "ggml-tiny",
"ggml-tiny.en", "ggml-base", "ggml-base.en" (also ggml-small[.en]) fetch the
whisper.cpp model files from ggerganov/whisper.cpp (MIT). The ".en" ones
understand English only, a little better than the multilingual ones.

Every file is checked against the size the hub reports, and an interrupted
download resumes where it stopped. --verify checks the models already on disk
(offline) — after copying the folder to another machine, for instance — and
--repair re-downloads just the files that are damaged.

Only the standard library is used, so this runs before `pip install`.
"""
import argparse
import http.client
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

from ks_common import MODELS_DIR, model_problems, read_meta, weights_problem, write_meta

HUB = os.environ.get("HF_ENDPOINT", "https://huggingface.co").rstrip("/")
BASE_DIR = os.path.join(MODELS_DIR, "base")
ATTEMPTS = 5

# Other frameworks' copies of the same weights (TensorFlow, Flax, Rust, ONNX,
# TFLite, Marian's own .npz), benchmark and test-set outputs, and repository
# clutter. vocab.spm duplicates source.spm/target.spm, which are what is read.
SKIP = re.compile(r"(^\.|\.md$|^benchmark_|^flores_|^example\d*\.(wav|flac)$|tf_model\.h5$|flax_model\.msgpack$|rust_model\.ot$"
                  r"|\.onnx$|^onnx/|\.tflite$|\.npz$|\.npz\.decoder\.yml$|^vocab\.spm$)")

# Text to Speech models are ONNX only: everything but the samples and pictures.
SYNTHESIS_SKIP = re.compile(r"(^\.|\.md$|^audio_samples/|^img/)")

MULTILINGUAL = {"m2m100": "facebook/m2m100_418M"}
SPEECH = {name: f"openai/{name}" for name in ("whisper-tiny", "whisper-base", "whisper-small", "whisper-medium")}
SPEAKER = {"ecapa": "speechbrain/spkrec-ecapa-voxceleb"}
SYNTHESIS = {"supertonic-3": "Supertone/supertonic-3"}
# PaddleOCR models, each its own repository under PaddlePaddle/: its role in
# the pipeline and, for recognition, the languages it reads. The
# Chinese model reads Japanese and English as well.
OCR_MODELS = {
    "PP-OCRv5_mobile_det": {"ocrRole": "det", "variant": "mobile"},
    "PP-OCRv5_server_det": {"ocrRole": "det", "variant": "server"},
    "PP-LCNet_x1_0_textline_ori": {"ocrRole": "textline"},
    "PP-OCRv5_mobile_rec": {"ocrRole": "rec", "variant": "mobile", "languages": ["zh", "ja", "en"]},
    "PP-OCRv5_server_rec": {"ocrRole": "rec", "variant": "server", "languages": ["zh", "ja", "en"]},
    "en_PP-OCRv5_mobile_rec": {"ocrRole": "rec", "variant": "mobile", "languages": ["en"]},
    "korean_PP-OCRv5_mobile_rec": {"ocrRole": "rec", "variant": "mobile", "languages": ["ko", "en"]},
    "eslav_PP-OCRv5_mobile_rec": {"ocrRole": "rec", "variant": "mobile", "languages": ["ru", "en"]},
    # Layout: where the titles, paragraphs, tables and figures of a page are,
    # and the structure (rows, columns, merged cells) of each table.
    "PP-DocLayout-M": {"ocrRole": "layout", "variant": "mobile"},
    "PP-DocLayout_plus-L": {"ocrRole": "layout", "variant": "server"},
    "SLANet_plus": {"ocrRole": "table"},
}
OCR_SETS = {
    "paddleocr": ["PP-OCRv5_mobile_det", "PP-LCNet_x1_0_textline_ori", "PP-OCRv5_mobile_rec",
                  "en_PP-OCRv5_mobile_rec", "korean_PP-OCRv5_mobile_rec", "eslav_PP-OCRv5_mobile_rec",
                  "PP-DocLayout-M", "SLANet_plus"],
    "paddleocr-server": ["PP-OCRv5_server_det", "PP-OCRv5_server_rec", "PP-DocLayout_plus-L"],
}
# ONNX copies of the PaddleOCR models: RapidOCR's conversions of the same
# weights (Apache-2.0), at fixed versions, so each file's size is known. Each
# is saved as inference.onnx beside the model's inference.yml, which is where
# PaddleOCR's ONNX Runtime engine looks for it; they read exactly the same
# text as the Paddle models. PP-DocLayout has no conversion; it stays on Paddle.
OCR_ONNX_HOST = "https://www.modelscope.cn/models/RapidAI"
OCR_ONNX = {
    "PP-OCRv5_mobile_det": ("RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/det/ch_PP-OCRv5_det_mobile.onnx", 4819576),
    "PP-LCNet_x1_0_textline_ori": ("RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/cls/ch_PP-LCNet_x1_0_textline_ori_cls_server.onnx",
                                   6776876),
    "PP-OCRv5_mobile_rec": ("RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/rec/ch_PP-OCRv5_rec_mobile.onnx", 16631306),
    "en_PP-OCRv5_mobile_rec": ("RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/rec/en_PP-OCRv5_rec_mobile.onnx", 7872351),
    "korean_PP-OCRv5_mobile_rec": ("RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/rec/korean_PP-OCRv5_rec_mobile.onnx", 13488748),
    "eslav_PP-OCRv5_mobile_rec": ("RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/rec/eslav_PP-OCRv5_rec_mobile.onnx", 7911802),
    "SLANet_plus": ("RapidTable/resolve/v2.0.0/slanet-plus.onnx", 7758305),
}
YOLO_NAME = re.compile(r"yolo[0-9a-z]*[nsmlx](-seg)?")
GGML_REPO = "ggerganov/whisper.cpp"
GGML_NAME = re.compile(r"ggml-(tiny|base|small|medium)(\.en)?")
YOLO_RELEASES = "https://api.github.com/repos/ultralytics/assets/releases"


def request(url, headers=None):
    headers = {"User-Agent": "knowledgeStore-model-download", **(headers or {})}
    token = os.environ.get("HF_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60)


def repo_files(repo, skip=SKIP):
    """(name, size in bytes) for every file worth downloading."""
    with request(f"{HUB}/api/models/{repo}?blobs=true") as response:
        siblings = json.load(response).get("siblings", [])
    files = {item["rfilename"]: item.get("size") for item in siblings if not skip.search(item["rfilename"])}
    # The same weights twice is only a bigger download: prefer safetensors.
    if "model.safetensors" in files and "pytorch_model.bin" in files:
        del files["pytorch_model.bin"]
    return sorted(files.items())


def fetch(repo, name, target, expected):
    return fetch_url(f"{HUB}/{repo}/resolve/main/{name}", name, target, expected)


def fetch_url(url, name, target, expected):
    """Download one file to `target`, resuming and retrying until it is whole.

    urllib does not raise when a connection drops mid-file — the body simply
    ends early — so the length is checked explicitly. Without that check a
    cut-off pytorch_model.bin was saved as if complete, and failed much later
    with "PytorchStreamReader failed … central directory".
    """
    part = f"{target}.part"
    for attempt in range(1, ATTEMPTS + 1):
        have = os.path.getsize(part) if os.path.exists(part) else 0
        if expected and have > expected:
            os.remove(part)
            have = 0
        try:
            if not expected or have < expected:
                headers = {"Range": f"bytes={have}-"} if have else {}
                with request(url, headers) as response:
                    if have and response.status != 206:
                        have = 0  # The server ignored the range: start over.
                    total = expected or (have + int(response.headers.get("Content-Length") or 0))
                    done = have
                    last = 0.0
                    with open(part, "ab" if have else "wb") as out:
                        while True:
                            chunk = response.read(1 << 20)
                            if not chunk:
                                break
                            out.write(chunk)
                            done += len(chunk)
                            if total and time.time() - last > 0.5:
                                last = time.time()
                                print(f"\r    {name}: {done * 100 // total:3d}% of {total / 1e6:.0f} MB",
                                      end="", flush=True)
        except (urllib.error.URLError, http.client.HTTPException, ConnectionError, TimeoutError, OSError) as error:
            if isinstance(error, urllib.error.HTTPError) and error.code in (401, 403, 404):
                raise
            print(f"\r    {name}: connection lost ({error}); retrying {attempt}/{ATTEMPTS}")
            time.sleep(min(30, 2 ** attempt))
            continue

        size = os.path.getsize(part)
        if expected and size != expected:
            print(f"\r    {name}: stopped at {size:,} of {expected:,} bytes; resuming {attempt}/{ATTEMPTS}")
            continue
        os.replace(part, target)
        problem = weights_problem(target) if target.endswith((".bin", ".pt", ".safetensors")) else ""
        if problem:
            os.remove(target)
            raise SystemExit(f"{name}: the downloaded file is {problem}. Run the command again.")
        print(f"\r    {name}: done{' ' * 40}")
        return
    raise SystemExit(f"{name}: the download kept stopping early. Run the same command again to resume it.")


def multilingual_languages(folder):
    """Language codes a multilingual model declares, from its "__ko__" tokens."""
    try:
        with open(os.path.join(folder, "special_tokens_map.json"), encoding="utf-8") as handle:
            tokens = json.load(handle).get("additional_special_tokens", [])
    except (OSError, ValueError):
        return []
    return [token.strip("_") for token in tokens if isinstance(token, str) and re.fullmatch(r"__\w+__", token)]


def download(spec):
    name, _, repo = spec.partition("=")
    if YOLO_NAME.fullmatch(name):
        return fetch_yolo(name)
    if GGML_NAME.fullmatch(name):
        return fetch_ggml(name)
    if name in SPEECH:
        return fetch_repo(SPEECH[name], task="speech")
    if name in SPEAKER:
        return fetch_repo(SPEAKER[name], task="speaker")
    if name in SYNTHESIS:
        return fetch_repo(SYNTHESIS[name], task="synthesis")
    if name in OCR_SETS or name in OCR_MODELS:
        for model in OCR_SETS.get(name, [name]):
            fetch_repo(f"PaddlePaddle/{model}", task="ocr")
            fetch_ocr_onnx(model)
        return None
    if name in MULTILINGUAL or name == "multi":
        return fetch_repo(repo or MULTILINGUAL.get(name, ""), multilingual=True)
    match = re.fullmatch(r"([A-Za-z]{2,3}(?:_[A-Za-z]+)?)-([A-Za-z]{2,3}(?:_[A-Za-z]+)?)", name)
    if not match:
        raise SystemExit(f'"{spec}" is not a pair like en-es, en-ja=Helsinki-NLP/opus-mt-en-jap, or m2m100')
    source, target = match.groups()
    return fetch_repo(repo or f"Helsinki-NLP/opus-mt-{source}-{target}", source=source, target=target)


def yolo_asset(name):
    """(download URL, size) of <name>.pt in Ultralytics' asset releases, newest first."""
    with request(f"{YOLO_RELEASES}?per_page=20") as response:
        releases = json.load(response)
    for release in releases:
        for asset in release.get("assets", []):
            if asset.get("name") == f"{name}.pt":
                return asset["browser_download_url"], asset.get("size")
    raise SystemExit(f"{name}.pt is not in Ultralytics' recent releases. Check the name, e.g. yolo26n or yolo11s-seg.")


def fetch_yolo(name):
    """Ultralytics weights: one .pt file, for detection or (-seg) segmentation."""
    folder = os.path.join(BASE_DIR, name)
    meta = read_meta(folder)
    if meta.get("complete") and meta.get("files") and not model_problems(folder):
        print(f"{name}: already downloaded and intact")
        return
    url, size = yolo_asset(name)
    print(f"{name} -> {folder}")
    os.makedirs(folder, exist_ok=True)
    destination = os.path.join(folder, f"{name}.pt")
    if not (os.path.exists(destination) and os.path.getsize(destination) == size and not weights_problem(destination)):
        fetch_url(url, f"{name}.pt", destination, size)
    write_meta(folder, {
        **meta,
        "id": name,
        "kind": "base",
        "task": "detection",
        "yoloTask": "segment" if name.endswith("-seg") else "detect",
        "name": f"Ultralytics {name}",
        "repo": f"ultralytics:{name}",
        "licence": "AGPL-3.0",
        "complete": True,
        "files": {f"{name}.pt": size},
        "downloadedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })


def fetch_ggml(name):
    """A whisper.cpp model: one ggml-*.bin file, for the Voice recognition tab."""
    folder = os.path.join(BASE_DIR, name)
    meta = read_meta(folder)
    if meta.get("complete") and meta.get("files") and not model_problems(folder):
        print(f"{name}: already downloaded and intact")
        return
    file = f"{name}.bin"
    try:
        size = dict(repo_files(GGML_REPO)).get(file)
    except urllib.error.HTTPError as error:
        raise SystemExit(f"{GGML_REPO}: HTTP {error.code}") from error
    if size is None:
        raise SystemExit(f"{file} is not in {HUB}/{GGML_REPO}. Try ggml-tiny, ggml-base, ggml-tiny.en or ggml-base.en.")
    print(f"{name} -> {folder}")
    os.makedirs(folder, exist_ok=True)
    destination = os.path.join(folder, file)
    if not (os.path.exists(destination) and os.path.getsize(destination) == size and not weights_problem(destination)):
        fetch(GGML_REPO, file, destination, size)
    size_name = name.split("-", 1)[1].split(".")[0]
    write_meta(folder, {
        **meta,
        "id": name,
        "kind": "base",
        "task": "recognition",
        "engine": "whisper.cpp",
        "name": f"whisper.cpp {size_name}{' (English)' if name.endswith('.en') else ''}",
        "file": file,
        "englishOnly": name.endswith(".en"),
        "repo": f"whisper.cpp:{name}",
        "licence": "MIT",
        "complete": True,
        "files": {file: size},
        "downloadedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })


def fetch_repo(repo, source=None, target=None, multilingual=False, task="translation"):
    """Download a repository, or bring an existing copy back to whole.

    Files already on disk with the right size are kept, so re-running this is
    how a damaged or interrupted model is repaired. The model only appears in
    the app once ks-model.json is written, after every file checks out.
    """
    if not repo:
        raise SystemExit('"multi" needs a repository, e.g. multi=facebook/m2m100_1.2B')
    folder = os.path.join(BASE_DIR, repo.split("/")[-1])
    meta = read_meta(folder)
    if meta.get("complete") and meta.get("files") and not model_problems(folder):
        print(f"{repo}: already downloaded and intact")
        return

    try:
        files = repo_files(repo, SYNTHESIS_SKIP if task == "synthesis" else SKIP)
    except urllib.error.HTTPError as error:
        raise SystemExit(f"{repo}: HTTP {error.code}. Check that it exists at {HUB}/{repo}") from error

    print(f"{repo} -> {folder}")
    os.makedirs(folder, exist_ok=True)
    for name, size in files:
        destination = os.path.join(folder, name)
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        if os.path.exists(destination) and (size is None or os.path.getsize(destination) == size):
            if not (destination.endswith((".bin", ".pt", ".safetensors")) and weights_problem(destination)):
                print(f"    {name}: already here")
                continue
        fetch(repo, name, destination, size)

    meta = {
        **meta,
        "id": os.path.basename(folder),
        "kind": "base",
        "task": task,
        "name": repo,
        "repo": repo,
        "complete": True,
        "files": {name: size for name, size in files if size is not None},
        "downloadedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if task == "speech":
        meta.update(multilingual=True)  # Whisper: the language is chosen per dataset.
    elif task == "speaker":
        meta.update(engine="speechbrain", architecture="ECAPA-TDNN", licence="Apache-2.0")
    elif task == "synthesis":
        meta.update(engine="supertonic", licence="OpenRAIL-M")
    elif task == "ocr":
        meta.update(engine="paddleocr", licence="Apache-2.0", **OCR_MODELS.get(os.path.basename(folder), {}))
    elif multilingual:
        meta.update(multilingual=True, languages=multilingual_languages(folder))
    else:
        meta.update(source=source, target=target)
    write_meta(folder, meta)


def fetch_ocr_onnx(model):
    """Add the ONNX copy of a downloaded PaddleOCR model, if there is one.

    Optional: OCR runs on Paddle without it, so a failure is a warning.
    """
    if model not in OCR_ONNX:
        return
    folder = os.path.join(BASE_DIR, model)
    meta = read_meta(folder)
    if not meta.get("complete"):
        return
    path, size = OCR_ONNX[model]
    target = os.path.join(folder, "inference.onnx")
    if os.path.exists(target) and os.path.getsize(target) == size:
        print("    inference.onnx: already here")
    else:
        try:
            fetch_url(f"{OCR_ONNX_HOST}/{path}", "inference.onnx", target, size)
        except (urllib.error.URLError, http.client.HTTPException, OSError, SystemExit) as error:
            print(f"    inference.onnx: not downloaded ({error}); OCR with {model} will run on Paddle, more slowly")
            return
    write_meta(folder, {**meta, "files": {**meta.get("files", {}), "inference.onnx": size}, "onnx": True})


def each_model():
    for kind in ("base", "finetuned"):
        root = os.path.join(MODELS_DIR, kind)
        for name in sorted(os.listdir(root)) if os.path.isdir(root) else []:
            folder = os.path.join(root, name)
            meta = read_meta(folder)
            if meta and os.path.isdir(folder):
                yield kind, folder, meta


def describe(meta):
    task = meta.get("task", "translation")
    if task == "detection":
        return f"yolo {meta.get('yoloTask', 'detect')}"
    if task == "speech":
        return f"speech {meta.get('language', 'any')}"
    if task == "recognition":
        return "whisper.cpp" + (" en" if meta.get("englishOnly") else "")
    if task == "speaker":
        return "speaker"
    if task == "synthesis":
        return "text to speech"
    if task == "ocr":
        return f"ocr {meta.get('ocrRole', '')} {','.join(meta.get('languages', []))}".strip()
    if meta.get("multilingual") and not meta.get("source"):
        return f"{len(meta.get('languages', []))} languages"
    return f"{meta.get('source')}->{meta.get('target')}"


def list_models():
    for kind, folder, meta in each_model():
        print(f"{kind:9} {describe(meta):14} {meta.get('name', os.path.basename(folder))}")


def verify(repair):
    """Check every model on disk; with repair, re-download what is damaged."""
    damaged = 0
    for kind, folder, meta in each_model():
        problems = model_problems(folder)
        label = meta.get("name", os.path.basename(folder))
        note = ""
        # Downloads made before sizes were recorded: ask the hub, when it can
        # be reached, and record the answer so later checks work offline.
        if not problems and kind == "base" and not meta.get("files") and meta.get("repo") \
                and not meta["repo"].startswith(("ultralytics:", "whisper.cpp:")):
            try:
                skip = SYNTHESIS_SKIP if meta.get("task") == "synthesis" else SKIP
                sizes = {name: size for name, size in repo_files(meta["repo"], skip) if size is not None}
            except (urllib.error.URLError, http.client.HTTPException, OSError, ValueError):
                note = " (file sizes not checked: no sizes recorded and the hub is unreachable)"
            else:
                write_meta(folder, {**meta, "files": sizes})
                problems = model_problems(folder)
        if not problems:
            print(f"ok       {label}{note}")
            continue
        damaged += 1
        print(f"DAMAGED  {label}: {'; '.join(problems)}")
        if not repair:
            continue
        if kind == "base" and str(meta.get("repo", "")).startswith("ultralytics:"):
            fetch_yolo(meta["repo"].split(":", 1)[1])
            damaged -= not model_problems(folder)
        elif kind == "base" and str(meta.get("repo", "")).startswith("whisper.cpp:"):
            fetch_ggml(meta["repo"].split(":", 1)[1])
            damaged -= not model_problems(folder)
        elif kind == "base" and meta.get("repo"):
            fetch_repo(meta["repo"], meta.get("source"), meta.get("target"),
                       bool(meta.get("multilingual")) and meta.get("task") != "speech", meta.get("task", "translation"))
            if meta.get("task") == "ocr":
                fetch_ocr_onnx(os.path.basename(folder))
            damaged -= not model_problems(folder)
        else:
            print("         A fine-tuned model cannot be downloaded again: delete it in the app and retrain it.")
    if damaged and not repair:
        print("\nRun again with --repair to re-download the damaged files.")
    return damaged


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pairs", nargs="*",
                        help="en-es, en-ja=Helsinki-NLP/opus-mt-en-jap, m2m100, yolo26n, yolo26n-seg, whisper-tiny, "
                             "ggml-tiny, ggml-base, ecapa, paddleocr, paddleocr-server, supertonic-3")
    parser.add_argument("--list", action="store_true", help="show the models already on disk")
    parser.add_argument("--verify", action="store_true", help="check the models on disk for damaged files")
    parser.add_argument("--repair", action="store_true", help="with --verify: re-download damaged files")
    args = parser.parse_args()

    if args.verify:
        sys.exit(1 if verify(args.repair) else 0)
    if args.list or not args.pairs:
        list_models()
        if not args.pairs:
            return
    os.makedirs(BASE_DIR, exist_ok=True)
    for spec in args.pairs:
        download(spec)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit("\nInterrupted. Run it again to resume.")
