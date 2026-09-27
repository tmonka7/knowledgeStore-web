"""Fine-tune Moonshine on the recordings of a command set, for Tools > AI > Speech to Command.

    python command_train.py --data datasets/command/<id> --base-model models/base/moonshine-tiny \
        --output models/finetuned/<id>.partial

The folder holds ks-dataset.json (the commands and their phrases), audio/<clip>.wav
and metadata.jsonl, one {"audio", "text", "command"} per recording. Moonshine
learns to transcribe the phrases as these people say them; the command is
then the phrase its transcript matches (command_common.match). Clips are
varied a little each epoch (loudness, noise, a pause before the speech) so a
few recordings of each command go further.

Held-back recordings (one per command that has three or more) are scored
before and after: the share recognised as the right command, and the word or
character error rate. The model is written, with its commands, to --output
only when training finishes. Progress is reported as JSON lines.
"""
import argparse
import json
import math
import os
import random
import time

from command_common import (
    DEFAULT_THRESHOLD, MAX_SECONDS, SAMPLE_RATE, inputs_for, label_ids, load_command_clips, load_moonshine, match,
    read_commands, transcribe,
)
from ks_common import check_model, describe_device, emit, fail, go_offline, pick_device, read_meta
from speech_common import error_rate, read_wav

go_offline()


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--base-model", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--language", default="")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=5e-5)
    parser.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD)
    parser.add_argument("--no-augment", action="store_true")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", default="auto", help="auto, cpu, cuda, cuda:N or mps")
    return parser.parse_args()


def batches(items, size):
    for start in range(0, len(items), size):
        yield items[start:start + size]


def hold_back(clips):
    """One recording of each command that has three or more, at most a fifth of them all."""
    by_command = {}
    for clip in clips:
        by_command.setdefault(clip[2], []).append(clip)
    held = []
    limit = max(1, len(clips) // 5)
    for group in by_command.values():
        if len(group) >= 3 and len(held) < limit:
            held.append(group[0])
    chosen = set(id(clip) for clip in held)
    return held, [clip for clip in clips if id(clip) not in chosen]


def augment(samples, rng):
    """The clip a little louder or quieter, sometimes with faint noise, sometimes after a short pause."""
    import numpy as np

    out = samples * rng.uniform(0.6, 1.4)
    if rng.random() < 0.5:
        power = float(np.mean(samples ** 2)) or 1e-6
        snr = rng.uniform(20, 40)
        out = out + np.random.default_rng(rng.randrange(1 << 30)).normal(
            0, math.sqrt(power / (10 ** (snr / 10))), len(out)).astype(np.float32)
    if rng.random() < 0.5:
        out = np.concatenate([np.zeros(int(rng.uniform(0, 0.3) * SAMPLE_RATE), dtype=np.float32), out])
    return np.clip(out, -1, 1).astype(np.float32)


def main():
    args = parse_args()
    check_model(args.base_model)
    commands = read_commands(args.data)
    if not commands:
        fail("The command set has no commands.")
    names = {command["id"]: command.get("name", command["id"]) for command in commands}
    language = args.language or read_meta(args.base_model).get("language") or "en"

    clips = [clip for clip in load_command_clips(args.data) if clip[2] in names]
    if len(clips) < 2:
        fail(f"The command set has {len(clips)} recordings; at least 2 are needed.")

    try:
        import torch
    except ImportError as error:
        fail(f"{error.name or error} is not installed. Run: pip install -r backend/python/requirements.txt")

    rng = random.Random(args.seed)
    random.seed(args.seed)
    torch.manual_seed(args.seed)

    audio = {}
    skipped = []
    for path, _, _ in clips:
        samples = read_wav(path)
        if len(samples) > MAX_SECONDS * SAMPLE_RATE or len(samples) < SAMPLE_RATE // 4:
            skipped.append(os.path.basename(path))
            continue
        audio[path] = samples
    clips = [clip for clip in clips if clip[0] in audio]
    if skipped:
        emit("status", message=f"Skipped {len(skipped)} recordings shorter than 0.25 s or longer than {MAX_SECONDS} s",
             skipped=skipped[:20])
    if len(clips) < 2:
        fail(f"Only {len(clips)} recordings are usable; at least 2 are needed.")

    rng.shuffle(clips)
    validation, training = hold_back(clips)

    device = pick_device(args.device)
    emit("status", message=f"Loading {os.path.basename(args.base_model)} on {describe_device(device)}",
         device=device.type, trainClips=len(training), validationClips=len(validation), commands=len(commands))
    processor, model = load_moonshine(args.base_model, device)

    def read(chunk):
        texts = []
        for part in batches(chunk, args.batch_size):
            texts.extend(transcribe(processor, model, [audio[path] for path, _, _ in part], device))
        return texts

    # Scored on held-back recordings; with too few to hold any back, on the
    # training ones (which says less, and the result says so).
    scored = validation or training[:16]
    references = [text for _, text, _ in scored]

    def score(texts):
        hits = sum(1 for (_, _, expected), text in zip(scored, texts)
                   if (match(text, commands, args.threshold, language)["command"] or {}).get("id") == expected)
        rate, metric = error_rate(references, texts, language)
        return round(hits / len(scored), 4), rate, metric

    before = read(scored)
    accuracy_before, error_before, metric = score(before)
    emit("status", message=f"Before training: {accuracy_before * 100:.0f}% of commands recognised")

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
        rng.shuffle(training)
        running, seen = 0.0, 0
        for chunk in batches(training, args.batch_size):
            samples = [audio[path] if args.no_augment else augment(audio[path], rng) for path, _, _ in chunk]
            loss = model(**inputs_for(processor, samples, device),
                         labels=label_ids(processor, model, [text for _, text, _ in chunk], device)).loss
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
                    total += model(**inputs_for(processor, [audio[path] for path, _, _ in chunk], device),
                                   labels=label_ids(processor, model, [text for _, text, _ in chunk], device)).loss.item()
                    count += 1
            entry["validationLoss"] = round(total / count, 4)
        history.append(entry)
        emit("epoch", **entry)

    model.eval()
    after = read(scored)
    accuracy_after, error_after, _ = score(after)

    def said(text):
        found = match(text, commands, args.threshold, language)["command"]
        return f"{text or '—'}  →  {found['name'] if found else '(no command)'}"

    emit("samples", samples=[
        {"source": os.path.basename(path), "reference": names.get(expected, expected),
         "before": said(old), "after": said(new)}
        for (path, _, expected), old, new in list(zip(scored, before, after))[:8]
    ])

    os.makedirs(args.output, exist_ok=True)
    model.save_pretrained(args.output)
    processor.save_pretrained(args.output)
    model.generation_config.save_pretrained(args.output)
    with open(os.path.join(args.output, "commands.json"), "w", encoding="utf-8") as handle:
        json.dump({"language": language, "threshold": args.threshold, "commands": commands}, handle,
                  ensure_ascii=False, indent=2)

    emit("done", history=history, trainClips=len(training), validationClips=len(validation),
         heldOut=bool(validation), metric=metric, errorBefore=error_before, errorAfter=error_after,
         accuracyBefore=accuracy_before, accuracyAfter=accuracy_after,
         seconds=round(time.time() - started), device=device.type)


if __name__ == "__main__":
    main()
