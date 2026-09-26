"""Translate sentences with a local model, offline.

    python translate.py --model models/finetuned/<id> [--source en --target ko] < request.json

--source/--target are needed for a multilingual base model (M2M100); a
fine-tuned one already knows its target, and Opus-MT models have only one.

stdin:  {"texts": ["Hello", ...], "maxLength": 128}
stdout: one "done" event: {"event": "done", "translations": [...], "seconds": ...}
"""
import argparse
import json
import sys
import time

from ks_common import emit, fail, go_offline, pick_device, setup_languages

go_offline()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--source")
    parser.add_argument("--target")
    args = parser.parse_args()

    request = json.load(sys.stdin)
    texts = [str(text) for text in request.get("texts", []) if str(text).strip()]
    max_length = int(request.get("maxLength") or 256)
    if not texts:
        fail("There is nothing to translate.")

    try:
        import torch
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
    except ImportError as error:
        fail(f"{error.name or error} is not installed. Run: pip install -r backend/python/requirements.txt")

    started = time.time()
    device = pick_device()
    tokenizer = AutoTokenizer.from_pretrained(args.model, local_files_only=True)
    model = AutoModelForSeq2SeqLM.from_pretrained(args.model, local_files_only=True).to(device).eval()
    generate_args = {}
    if args.source and args.target:
        generate_args = setup_languages(tokenizer, model, args.source, args.target)

    translations = []
    for start in range(0, len(texts), 16):
        chunk = texts[start:start + 16]
        inputs = tokenizer(chunk, max_length=max_length, truncation=True, padding=True, return_tensors="pt").to(device)
        with torch.no_grad():
            output = model.generate(**inputs, num_beams=4, max_new_tokens=max_length, **generate_args)
        translations.extend(tokenizer.batch_decode(output, skip_special_tokens=True))

    emit("done", translations=translations, seconds=round(time.time() - started, 2), device=device.type)


if __name__ == "__main__":
    main()
