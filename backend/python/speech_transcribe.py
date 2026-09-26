"""Transcribe WAV files with a local Whisper model, offline.

    python speech_transcribe.py --model models/finetuned/<id> [--language ko] --audio a.wav b.wav

--language is needed for a base model; a fine-tuned one already knows its own.
stdout: one "done" event: {"event": "done", "texts": [...], "seconds": ...}
"""
import argparse
import time

from ks_common import check_model, emit, fail, go_offline, pick_device, read_meta
from speech_common import MAX_SECONDS, SAMPLE_RATE, prepare_whisper, read_wav

go_offline()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--language")
    parser.add_argument("--audio", nargs="+", required=True)
    args = parser.parse_args()

    check_model(args.model)
    try:
        import torch
        from transformers import WhisperForConditionalGeneration, WhisperProcessor
    except ImportError as error:
        fail(f"{error.name or error} is not installed. Run: pip install -r backend/python/requirements.txt")

    started = time.time()
    device = pick_device()
    processor = WhisperProcessor.from_pretrained(args.model, local_files_only=True)
    model = WhisperForConditionalGeneration.from_pretrained(args.model, local_files_only=True).float().to(device).eval()
    generate_args = prepare_whisper(processor, model, args.language or read_meta(args.model).get("language"))

    texts = []
    for path in args.audio:
        samples = read_wav(path)[: MAX_SECONDS * SAMPLE_RATE]
        features = processor.feature_extractor(samples, sampling_rate=SAMPLE_RATE, return_tensors="pt").input_features
        with torch.no_grad():
            output = model.generate(features.to(device), max_new_tokens=225, **generate_args)
        texts.append(processor.batch_decode(output, skip_special_tokens=True)[0].strip())

    emit("done", texts=texts, seconds=round(time.time() - started, 2), device=device.type)


if __name__ == "__main__":
    main()
