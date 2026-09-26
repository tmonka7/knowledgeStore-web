"""Fine-tune a local Marian (Opus-MT) model on a translation dataset.

    python train.py --dataset dataset.jsonl --source en --target es \
        --base-model models/base/opus-mt-en-es --output models/finetuned/<id>.partial

Runs fully offline. Progress is reported as JSON lines (see ks_common). The
model is written to --output only when training finishes; the API renames the
folder into place, so a cancelled or crashed run never looks like a model.

A plain PyTorch loop rather than transformers.Trainer: it needs nothing beyond
transformers, torch and sentencepiece, and it reports exactly what the page
shows.
"""
import argparse
import math
import os
import random
import time

from ks_common import emit, fail, go_offline, load_pairs, pick_device

go_offline()


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--base-model", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=5e-5)
    parser.add_argument("--max-length", type=int, default=128)
    parser.add_argument("--validation-split", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def batches(items, size):
    for start in range(0, len(items), size):
        yield items[start:start + size]


def encode(tokenizer, pairs, max_length, device):
    sources = [source for source, _ in pairs]
    targets = [target for _, target in pairs]
    batch = tokenizer(sources, text_target=targets, max_length=max_length,
                      truncation=True, padding=True, return_tensors="pt")
    # Padding in the labels must not count towards the loss.
    batch["labels"][batch["labels"] == tokenizer.pad_token_id] = -100
    return {key: value.to(device) for key, value in batch.items()}


def translate(model, tokenizer, texts, max_length, device):
    import torch
    inputs = tokenizer(texts, max_length=max_length, truncation=True, padding=True, return_tensors="pt").to(device)
    with torch.no_grad():
        output = model.generate(**inputs, num_beams=4, max_new_tokens=max_length)
    return tokenizer.batch_decode(output, skip_special_tokens=True)


def main():
    args = parse_args()

    pairs = load_pairs(args.dataset, args.source, args.target)
    if len(pairs) < 2:
        fail(f"The dataset has {len(pairs)} complete {args.source}->{args.target} pairs; at least 2 are needed.")

    try:
        import torch
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer, get_linear_schedule_with_warmup
    except ImportError as error:
        fail(f"{error.name or error} is not installed. Run: pip install -r backend/python/requirements.txt")

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    random.shuffle(pairs)

    # Hold some pairs back to measure progress on, unless there are too few
    # to spare any.
    held = int(len(pairs) * args.validation_split) if len(pairs) >= 10 else 0
    validation, training = pairs[:held], pairs[held:]

    device = pick_device()
    emit("status", message=f"Loading {os.path.basename(args.base_model)} on {device.type}",
         device=device.type, trainPairs=len(training), validationPairs=len(validation))

    tokenizer = AutoTokenizer.from_pretrained(args.base_model, local_files_only=True)
    model = AutoModelForSeq2SeqLM.from_pretrained(args.base_model, local_files_only=True).to(device)

    samples = (validation or training)[:3]
    before = translate(model, tokenizer, [source for source, _ in samples], args.max_length, device)

    steps_per_epoch = math.ceil(len(training) / args.batch_size)
    total_steps = steps_per_epoch * args.epochs
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=0.01)
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
            loss = model(**encode(tokenizer, chunk, args.max_length, device)).loss
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            optimizer.zero_grad()

            step += 1
            running += loss.item()
            seen += 1
            # At most twice a second: a small dataset steps far faster than
            # the page could draw it.
            if time.time() - last_report > 0.5 or step == total_steps:
                last_report = time.time()
                elapsed = time.time() - started
                emit("progress", step=step, totalSteps=total_steps, epoch=epoch,
                     loss=round(running / seen, 4), learningRate=scheduler.get_last_lr()[0],
                     etaSeconds=round(elapsed / step * (total_steps - step)))

        entry = {"epoch": epoch, "trainLoss": round(running / max(seen, 1), 4)}
        if validation:
            model.eval()
            total, count = 0.0, 0
            with torch.no_grad():
                for chunk in batches(validation, args.batch_size):
                    total += model(**encode(tokenizer, chunk, args.max_length, device)).loss.item()
                    count += 1
            entry["validationLoss"] = round(total / count, 4)
        history.append(entry)
        emit("epoch", **entry)

    model.eval()
    after = translate(model, tokenizer, [source for source, _ in samples], args.max_length, device)
    emit("samples", samples=[
        {"source": source, "reference": reference, "before": old, "after": new}
        for (source, reference), old, new in zip(samples, before, after)
    ])

    os.makedirs(args.output, exist_ok=True)
    model.save_pretrained(args.output)
    tokenizer.save_pretrained(args.output)
    if getattr(model, "generation_config", None) is not None:
        model.generation_config.save_pretrained(args.output)

    emit("done", history=history, trainPairs=len(training), validationPairs=len(validation),
         seconds=round(time.time() - started), device=device.type)


if __name__ == "__main__":
    main()
