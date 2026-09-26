"""Fetch translation models into backend/python/models/base, once.

This is the only script that uses the network. Run it on a machine with
internet access; after that, training, translation and ONNX export read the
models from disk and never go online. The models folder can be copied as-is
to an offline machine.

    python download_models.py en-es en-zh
    python download_models.py en-ja=Helsinki-NLP/opus-mt-en-jap
    python download_models.py m2m100
    python download_models.py --list

A plain "src-tgt" means Helsinki-NLP/opus-mt-src-tgt, a small model for one
direction. Use "src-tgt=repo" when the repository's language codes differ from
the ones your datasets use (Opus-MT calls Japanese "jap", for example).

"m2m100" fetches facebook/m2m100_418M (MIT licence, about 1.9 GB): a single
multilingual model that translates between any two of 100 languages. It is
the fallback for pairs Opus-MT has no working model for, such as en-ko.
"multi=<repo>" fetches another model of the same family.

Only the standard library is used, so this runs before `pip install`.
"""
import argparse
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.request

from ks_common import META_FILE, MODELS_DIR, read_meta, write_meta

HUB = os.environ.get("HF_ENDPOINT", "https://huggingface.co").rstrip("/")
BASE_DIR = os.path.join(MODELS_DIR, "base")

# Other frameworks' copies of the same weights, benchmark outputs, and
# repository clutter.
SKIP = re.compile(r"(^\.|\.md$|^benchmark_|tf_model\.h5$|flax_model\.msgpack$|rust_model\.ot$|\.onnx$|^onnx/)")


def request(url):
    headers = {"User-Agent": "knowledgeStore-model-download"}
    token = os.environ.get("HF_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60)


def repo_files(repo):
    with request(f"{HUB}/api/models/{repo}") as response:
        files = [item["rfilename"] for item in json.load(response).get("siblings", [])]
    files = [name for name in files if not SKIP.search(name)]
    # The same weights twice is only a bigger download: prefer safetensors.
    if "model.safetensors" in files and "pytorch_model.bin" in files:
        files.remove("pytorch_model.bin")
    return files


def fetch(repo, name, target):
    part = f"{target}.part"
    with request(f"{HUB}/{repo}/resolve/main/{name}") as response, open(part, "wb") as out:
        total = int(response.headers.get("Content-Length") or 0)
        done = 0
        last = 0.0
        while True:
            chunk = response.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)
            done += len(chunk)
            if total and time.time() - last > 0.5:
                last = time.time()
                print(f"\r    {name}: {done * 100 // total:3d}% of {total / 1e6:.0f} MB", end="", flush=True)
    os.replace(part, target)
    print(f"\r    {name}: done{' ' * 30}")


MULTILINGUAL = {"m2m100": "facebook/m2m100_418M"}


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
    if name in MULTILINGUAL or name == "multi":
        return fetch_repo(repo or MULTILINGUAL.get(name, ""), multilingual=True)
    pair = name
    match = re.fullmatch(r"([A-Za-z]{2,3}(?:_[A-Za-z]+)?)-([A-Za-z]{2,3}(?:_[A-Za-z]+)?)", pair)
    if not match:
        raise SystemExit(f'"{spec}" is not a pair like en-es or en-ja=Helsinki-NLP/opus-mt-en-jap')
    source, target = match.groups()
    return fetch_repo(repo or f"Helsinki-NLP/opus-mt-{source}-{target}", source=source, target=target)


def fetch_repo(repo, source=None, target=None, multilingual=False):
    if not repo:
        raise SystemExit('"multi" needs a repository, e.g. multi=facebook/m2m100_1.2B')
    folder = os.path.join(BASE_DIR, repo.split("/")[-1])
    if read_meta(folder).get("complete"):
        print(f"{repo}: already downloaded")
        return

    print(f"{repo} -> {folder}")
    staging = f"{folder}.downloading"
    os.makedirs(staging, exist_ok=True)
    try:
        for name in repo_files(repo):
            destination = os.path.join(staging, name)
            os.makedirs(os.path.dirname(destination), exist_ok=True)
            if os.path.exists(destination):
                continue  # Resuming an interrupted download.
            fetch(repo, name, destination)
    except urllib.error.HTTPError as error:
        raise SystemExit(f"{repo}: HTTP {error.code}. Check the pair exists at {HUB}/{repo}") from error

    meta = {
        "id": os.path.basename(folder),
        "kind": "base",
        "name": repo,
        "repo": repo,
        "complete": True,
        "downloadedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if multilingual:
        meta.update(multilingual=True, languages=multilingual_languages(staging))
    else:
        meta.update(source=source, target=target)
    write_meta(staging, meta)
    if os.path.exists(folder):
        shutil.rmtree(folder)
    os.replace(staging, folder)


def list_models():
    for kind in ("base", "finetuned"):
        root = os.path.join(MODELS_DIR, kind)
        for name in sorted(os.listdir(root)) if os.path.isdir(root) else []:
            meta = read_meta(os.path.join(root, name))
            if meta:
                pair = (f"{len(meta.get('languages', []))} languages" if meta.get("multilingual")
                        else f"{meta.get('source')}->{meta.get('target')}")
                print(f"{kind:9} {pair:14} {meta.get('name', name)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pairs", nargs="*", help="en-es, en-ja=Helsinki-NLP/opus-mt-en-jap, or m2m100")
    parser.add_argument("--list", action="store_true", help="show the models already on disk")
    args = parser.parse_args()

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
