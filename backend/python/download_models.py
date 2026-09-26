"""Fetch Opus-MT translation models into backend/python/models/base, once.

This is the only script that uses the network. Run it on a machine with
internet access; after that, training, translation and ONNX export read the
models from disk and never go online. The models folder can be copied as-is
to an offline machine.

    python download_models.py en-es es-en
    python download_models.py en-ja=Helsinki-NLP/opus-mt-en-jap
    python download_models.py --list

A plain "src-tgt" means Helsinki-NLP/opus-mt-src-tgt. Use "src-tgt=repo" when
the repository's language codes differ from the ones your datasets use (Opus-MT
calls Japanese "jap", for example).

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

# Other frameworks' copies of the same weights, and repository clutter.
SKIP = re.compile(r"(^\.|\.md$|tf_model\.h5$|flax_model\.msgpack$|rust_model\.ot$|\.onnx$|^onnx/)")


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


def download(spec):
    pair, _, repo = spec.partition("=")
    match = re.fullmatch(r"([A-Za-z]{2,3}(?:_[A-Za-z]+)?)-([A-Za-z]{2,3}(?:_[A-Za-z]+)?)", pair)
    if not match:
        raise SystemExit(f'"{spec}" is not a pair like en-es or en-ja=Helsinki-NLP/opus-mt-en-jap')
    source, target = match.groups()
    repo = repo or f"Helsinki-NLP/opus-mt-{source}-{target}"

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

    write_meta(staging, {
        "id": os.path.basename(folder),
        "kind": "base",
        "name": repo,
        "repo": repo,
        "source": source,
        "target": target,
        "complete": True,
        "downloadedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })
    if os.path.exists(folder):
        shutil.rmtree(folder)
    os.replace(staging, folder)


def list_models():
    for kind in ("base", "finetuned"):
        root = os.path.join(MODELS_DIR, kind)
        for name in sorted(os.listdir(root)) if os.path.isdir(root) else []:
            meta = read_meta(os.path.join(root, name))
            if meta:
                print(f"{kind:9} {meta.get('source')}->{meta.get('target')}  {meta.get('name', name)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pairs", nargs="*", help="en-es, or en-ja=Helsinki-NLP/opus-mt-en-jap")
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
