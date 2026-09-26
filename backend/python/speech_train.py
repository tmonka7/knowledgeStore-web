"""Fine-tune a local Whisper model on a dataset uploaded from the Speech to Text page.

    python speech_train.py --data datasets/speech/<id> --language ko \
        --base-model models/base/whisper-tiny --output models/finetuned/<id>.partial

The dataset folder holds audio/<clip>.wav and metadata.jsonl, one
{"audio": "audio/<clip>.wav", "text": "..."} per line. Runs offline; progress
is reported as JSON lines, and the model is written to --output only when
training finishes. The error rate (WER, or CER for languages written without
spaces) is measured on held-back clips before and after training.
"""
import argparse
import math
import os
import random
import time

from ks_common import check_model, emit, fail, go_offline, pick_device
from speech_common import MAX_SECONDS, SAMPLE_RATE, error_rate, load_clips, prepare_whisper, read_wav

go_offline()


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--language", required=True)
    parser.add_argument("--base-model", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=1e-5)
    parser.add_argument("--validation-split", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def batches(items, size):
    for start in range(0, len(items), size):
        yield items[start:start + size]


def main():
    args = parse_args()
    check_model(args.base_model)

    clips = load_clips(args.data)
    if len(clips) < 2:
        fail(f"The dataset has {len(clips)} transcribed clips; at least 2 are needed.")

    try:
        import torch
        from transformers import WhisperForConditionalGeneration, WhisperProcessor
    except ImportError as error:
        fail(f"{error.name or error} is not installed. Run: pip install -r backend/python/requirements.txt")

    random.seed(args.seed)
    torch.manual_seed(args.seed)

    # Decode every clip once up front: small datasets fit easily, and a bad
    # file is reported before any training time is spent.
    audio = {}
    skipped = []
    for path, _ in clips:
        samples = read_wav(path)
        if len(samples) > MAX_SECONDS * SAMPLE_RATE:
            skipped.append(os.path.basename(path))
            continue
        audio[path] = samples
    clips = [(path, text) for path, text in clips if path in audio]
    if skipped:
        emit("status", message=f"Skipped {len(skipped)} clips longer than {MAX_SECONDS} s", skipped=skipped[:20])
    if len(clips) < 2:
        fail(f"Only {len(clips)} clips are {MAX_SECONDS} s or shorter; at least 2 are needed.")

    random.shuffle(clips)
    held = max(1, int(len(clips) * args.validation_split)) if len(clips) >= 10 else 0
    validation, training = clips[:held], clips[held:]

    device = pick_device()
    emit("status", message=f"Loading {os.path.basename(args.base_model)} on {device.type}",
         device=device.type, trainClips=len(training), validationClips=len(validation))

    processor = WhisperProcessor.from_pretrained(args.base_model, local_files_only=True)
    # float32 always: float16 training overflows (see train.py).
    model = WhisperForConditionalGeneration.from_pretrained(args.base_model, local_files_only=True).float().to(device)
    generate_args = prepare_whisper(processor, model, args.language)
    start_token = model.config.decoder_start_token_id

    def features(chunk):
        return processor.feature_extractor([audio[path] for path, _ in chunk], sampling_rate=SAMPLE_RATE,
                                           return_tensors="pt").input_features.to(device)

    def labels(chunk):
        encoded = processor.tokenizer([text for _, text in chunk], padding=True, return_tensors="pt")
        ids = encoded.input_ids.masked_fill(encoded.attention_mask.ne(1), -100)
        # The model prepends <|startoftranscript|> itself when it shifts the
        # labels right; keeping the tokenizer's copy would teach it twice.
        if (ids[:, 0] == start_token).all():
            ids = ids[:, 1:]
        return ids.to(device)

    def transcribe(chunk):
        with torch.no_grad():
            output = model.generate(features(chunk), max_new_tokens=225, **generate_args)
        return [text.strip() for text in processor.batch_decode(output, skip_special_tokens=True)]

    scored = validation or training[:8]
    references = [text for _, text in scored]
    model.eval()
    before = [text for chunk in batches(scored, args.batch_size) for text in transcribe(chunk)]
    rate_before, metric = error_rate(references, before, args.language)

    steps_per_epoch = math.ceil(len(training) / args.batch_size)
    total_steps = steps_per_epoch * args.epochs
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=0.01)
    from transformers import get_linear_schedule_with_warmup
    scheduler = get_linear_schedule_with_warmup(optimizer, max(1, total_steps // 10), total_steps)

    emit("start", totalSteps=total_steps, epochs=args.epochs, stepsPerEpoch=steps_per_epoch)
    step = 0
    last_report = 0.0
    started = time.time()
    history = []
    for epoch in range(1, args.epochs + 1):
        model.train()
        random.shuffle(training)
        running, seen = 0.0, 0
        for chunk in batches(training, args.batch_size):
            loss = model(input_features=features(chunk), labels=labels(chunk)).loss
            if not torch.isfinite(loss):
                fail(f"Training diverged at epoch {epoch}, step {step + 1} (the loss is {loss.item()}). "
                     "Nothing was saved. Try a lower learning rate.")
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            optimizer.zero_grad()

            step += 1
            running += loss.item()
            seen += 1
            if time.time() - last_report > 0.5 or step == total_steps:
                last_report = time.time()
                elapsed = time.time() - started
                emit("progress", step=step, totalSteps=total_steps, epoch=epoch, loss=round(running / seen, 4),
                     etaSeconds=round(elapsed / step * (total_steps - step)))

        model.eval()
        entry = {"epoch": epoch, "trainLoss": round(running / max(seen, 1), 4)}
        if validation:
            total, count = 0.0, 0
            with torch.no_grad():
                for chunk in batches(validation, args.batch_size):
                    total += model(input_features=features(chunk), labels=labels(chunk)).loss.item()
                    count += 1
            entry["validationLoss"] = round(total / count, 4)
        history.append(entry)
        emit("epoch", **entry)

    model.eval()
    after = [text for chunk in batches(scored, args.batch_size) for text in transcribe(chunk)]
    rate_after, _ = error_rate(references, after, args.language)
    emit("samples", samples=[
        {"source": os.path.basename(path), "reference": reference, "before": old, "after": new}
        for (path, reference), old, new in list(zip(scored, before, after))[:5]
    ])

    os.makedirs(args.output, exist_ok=True)
    model.save_pretrained(args.output)
    processor.save_pretrained(args.output)
    model.generation_config.save_pretrained(args.output)

    emit("done", history=history, trainClips=len(training), validationClips=len(validation),
         metric=metric, errorBefore=rate_before, errorAfter=rate_after,
         seconds=round(time.time() - started), device=device.type)


if __name__ == "__main__":
    main()
