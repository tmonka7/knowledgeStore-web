"""Fetch translation models into backend/python/models/base, once.

This is the only script that uses the network. Run it on a machine with
internet access; after that, training, translation and ONNX export read the
models from disk and never go online. The models folder can be copied as-is
to an offline machine.

    python download_models.py en-es en-zh
    python download_models.py en-ja=Helsinki-NLP/opus-mt-en-jap
    python download_models.py m2m100
    python download_models.py yolo26n yolo26n-seg whisper-tiny
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
SKIP = re.compile(r"(^\.|\.md$|^benchmark_|^flores_|tf_model\.h5$|flax_model\.msgpack$|rust_model\.ot$"
                  r"|\.onnx$|^onnx/|\.tflite$|\.npz$|\.npz\.decoder\.yml$|^vocab\.spm$)")

MULTILINGUAL = {"m2m100": "facebook/m2m100_418M"}
SPEECH = {name: f"openai/{name}" for name in ("whisper-tiny", "whisper-base", "whisper-small", "whisper-medium")}
YOLO_NAME = re.compile(r"yolo[0-9a-z]*[nsmlx](-seg)?")
YOLO_RELEASES = "https://api.github.com/repos/ultralytics/assets/releases"


def request(url, headers=None):
    headers = {"User-Agent": "knowledgeStore-model-download", **(headers or {})}
    token = os.environ.get("HF_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60)


def repo_files(repo):
    """(name, size in bytes) for every file worth downloading."""
    with request(f"{HUB}/api/models/{repo}?blobs=true") as response:
        siblings = json.load(response).get("siblings", [])
    files = {item["rfilename"]: item.get("size") for item in siblings if not SKIP.search(item["rfilename"])}
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
    if name in SPEECH:
        return fetch_repo(SPEECH[name], task="speech")
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
        files = repo_files(repo)
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
    elif multilingual:
        meta.update(multilingual=True, languages=multilingual_languages(folder))
    else:
        meta.update(source=source, target=target)
    write_meta(folder, meta)


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
                and not meta["repo"].startswith("ultralytics:"):
            try:
                sizes = {name: size for name, size in repo_files(meta["repo"]) if size is not None}
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
        elif kind == "base" and meta.get("repo"):
            fetch_repo(meta["repo"], meta.get("source"), meta.get("target"),
                       bool(meta.get("multilingual")) and meta.get("task") != "speech", meta.get("task", "translation"))
            damaged -= not model_problems(folder)
        else:
            print("         A fine-tuned model cannot be downloaded again: delete it in the app and retrain it.")
    if damaged and not repair:
        print("\nRun again with --repair to re-download the damaged files.")
    return damaged


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pairs", nargs="*",
                        help="en-es, en-ja=Helsinki-NLP/opus-mt-en-jap, m2m100, yolo26n, yolo26n-seg, whisper-tiny")
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
