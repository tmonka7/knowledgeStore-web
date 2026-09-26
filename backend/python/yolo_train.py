"""Fine-tune a local Ultralytics YOLO model on a dataset uploaded from the YOLO page.

    python yolo_train.py --data datasets/yolo/<id> --base-model models/base/yolo26n \
        --output models/finetuned/<id>.partial --epochs 50 --imgsz 640

The dataset folder is what the page uploads: images/<path> with
labels/<path>.txt beside them (the layout Ultralytics expects), and
ks-dataset.json naming the classes and the task (detect or segment). The
train/validation split is made here, deterministically, so the same dataset
always splits the same way.

Runs offline (see ks_common.go_offline_yolo). Progress is reported as JSON
lines; the trained weights are written to --output/model.pt only when
training finishes.
"""
import argparse
import json
import os
import random
import shutil
import time

from ks_common import check_model, emit, fail, go_offline_yolo, pick_device, yolo_weights

go_offline_yolo()

IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff")


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--base-model", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--validation-split", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def total_loss(value):
    """The trainer's running loss as one number.

    Ultralytics 8.4 keeps it as a dict of named parts (box, cls, dfl…);
    earlier releases as a tensor of the same parts. Either way, the sum.
    """
    if value is None:
        return None
    parts = value.values() if isinstance(value, dict) else [value]
    total = sum(float(part.sum()) if hasattr(part, "sum") else float(part) for part in parts)
    return round(total, 4)


def labelled_images(data):
    """Images that have a label file (an empty one marks a background image)."""
    images_dir = os.path.join(data, "images")
    found = []
    for folder, _, files in os.walk(images_dir):
        for name in files:
            if not name.lower().endswith(IMAGE_EXTENSIONS):
                continue
            image = os.path.join(folder, name)
            relative = os.path.relpath(image, images_dir)
            label = os.path.join(data, "labels", os.path.splitext(relative)[0] + ".txt")
            if os.path.exists(label):
                found.append(os.path.abspath(image))
    return sorted(found)


def write_split(data, work, classes, images, share, seed):
    """train.txt / val.txt / data.yaml in the work folder, pointing at the dataset."""
    rng = random.Random(seed)
    shuffled = images[:]
    rng.shuffle(shuffled)
    held = max(1, round(len(shuffled) * share)) if len(shuffled) >= 5 else 0
    validation, training = shuffled[:held], shuffled[held:]
    # With too few images to spare any, validate on the training images:
    # the numbers flatter the model, but training still runs.
    validation = validation or training

    as_list = lambda paths: "\n".join(path.replace("\\", "/") for path in paths) + "\n"  # noqa: E731
    with open(os.path.join(work, "train.txt"), "w", encoding="utf-8") as handle:
        handle.write(as_list(training))
    with open(os.path.join(work, "val.txt"), "w", encoding="utf-8") as handle:
        handle.write(as_list(validation))

    names = "\n".join(f"  {index}: {json.dumps(name, ensure_ascii=False)}" for index, name in enumerate(classes))
    yaml_path = os.path.join(work, "data.yaml")
    with open(yaml_path, "w", encoding="utf-8") as handle:
        handle.write(f"path: {os.path.abspath(data)}\n".replace("\\", "/"))
        handle.write(f"train: {os.path.join(work, 'train.txt')}\n".replace("\\", "/"))
        handle.write(f"val: {os.path.join(work, 'val.txt')}\n".replace("\\", "/"))
        handle.write(f"names:\n{names}\n")
    return yaml_path, len(training), held


def main():
    args = parse_args()
    check_model(args.base_model)

    try:
        with open(os.path.join(args.data, "ks-dataset.json"), encoding="utf-8") as handle:
            dataset = json.load(handle)
    except (OSError, ValueError):
        fail("The dataset has not been uploaded completely. Save it to the server again from the YOLO page.")
    classes = dataset.get("classes") or []
    if not classes:
        fail("The dataset has no classes.")

    images = labelled_images(args.data)
    if len(images) < 2:
        fail(f"The dataset has {len(images)} labelled images; at least 2 are needed.")

    try:
        import torch
        from ultralytics import YOLO
    except ImportError as error:
        fail(f"{error.name or error} is not installed. Run: pip install -r backend/python/requirements.txt")

    os.makedirs(args.output, exist_ok=True)
    work = os.path.join(args.output, "_work")
    os.makedirs(work, exist_ok=True)
    yaml_path, train_count, validation_count = write_split(
        args.data, work, classes, images, args.validation_split, args.seed)

    device = pick_device()
    model = YOLO(yolo_weights(args.base_model))
    weights_task = getattr(model, "task", "detect")
    if dataset.get("task", "detect") != weights_task:
        fail(f"This is a {dataset.get('task')} dataset but the base model is for {weights_task}. "
             f"Pick a {'-seg ' if dataset.get('task') == 'segment' else 'detection '}model.")

    emit("status", message=f"Training {os.path.basename(args.base_model)} on {device.type}",
         device=device.type, trainImages=train_count, validationImages=validation_count, classes=classes)

    state = {"step": 0, "total": 0, "last": 0.0, "started": time.time(), "history": []}

    def on_train_start(trainer):
        state["total"] = len(trainer.train_loader) * trainer.epochs
        emit("start", totalSteps=state["total"], epochs=trainer.epochs)

    def on_train_batch_end(trainer):
        state["step"] += 1
        if time.time() - state["last"] > 0.5 or state["step"] == state["total"]:
            state["last"] = time.time()
            elapsed = time.time() - state["started"]
            emit("progress", step=state["step"], totalSteps=state["total"], epoch=trainer.epoch + 1,
                 loss=total_loss(trainer.tloss),
                 etaSeconds=round(elapsed / state["step"] * (state["total"] - state["step"])))

    def on_fit_epoch_end(trainer):
        metrics = trainer.metrics or {}
        entry = {"epoch": trainer.epoch + 1, "trainLoss": total_loss(trainer.tloss)}
        # After the last epoch Ultralytics re-validates the best weights and
        # fires this callback once more: that is the final score, not an epoch.
        final = entry["epoch"] > trainer.epochs
        # (B) is the box metric; segmentation adds (M) for the masks.
        for key, label in (("metrics/mAP50(B)", "mAP50"), ("metrics/mAP50-95(B)", "mAP50-95"),
                           ("metrics/mAP50(M)", "maskmAP50"), ("metrics/mAP50-95(M)", "maskmAP50-95")):
            if key in metrics:
                entry[label] = round(float(metrics[key]), 4)
        if final:
            state["final"] = {key: value for key, value in entry.items() if key not in ("epoch", "trainLoss")}
            return
        state["history"].append(entry)
        emit("epoch", **entry)

    model.add_callback("on_train_start", on_train_start)
    model.add_callback("on_train_batch_end", on_train_batch_end)
    model.add_callback("on_fit_epoch_end", on_fit_epoch_end)

    model.train(
        data=yaml_path,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch_size,
        device=0 if device.type == "cuda" else "cpu",
        # Worker processes re-import this script on Windows; loading in the
        # main process is slower but always works.
        workers=0,
        project=work,
        name="run",
        exist_ok=True,
        plots=False,  # Plots need a font Ultralytics would download.
        amp=device.type == "cuda",
        seed=args.seed,
        verbose=False,
    )

    best = getattr(model.trainer, "best", None)
    if not best or not os.path.exists(best):
        fail("Training finished without producing weights. See the log.")
    shutil.copyfile(best, os.path.join(args.output, "model.pt"))
    shutil.rmtree(work, ignore_errors=True)

    emit("done", history=state["history"], final=state.get("final") or {}, trainImages=train_count, validationImages=validation_count,
         classes=classes, task=weights_task, imgsz=args.imgsz,
         seconds=round(time.time() - state["started"]), device=device.type)


if __name__ == "__main__":
    main()
