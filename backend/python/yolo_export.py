"""Export a local YOLO model to ONNX, check it, and zip it for download.

    python yolo_export.py --model models/finetuned/<id> --output models/onnx/<id>.partial \
        [--imgsz 640] [--sample image.jpg]

Uses Ultralytics' own exporter, offline. The .onnx carries the class names and
input size in its metadata, so `YOLO("model.onnx")` loads it as-is, and so does
onnxruntime in any language.

With --sample, the exported model and the original are both run on that image
and their detections compared.
"""
import argparse
import importlib.util
import os
import shutil

from ks_common import check_model, emit, fail, go_offline_yolo, read_meta, yolo_weights

go_offline_yolo()

README = """{name} — YOLO ONNX export

Task: {task}   Input size: {imgsz}x{imgsz}   Classes: {classes}

Files
  model.onnx    input "images" float32 [1, 3, {imgsz}, {imgsz}], RGB, 0..1
  classes.txt   one class name per line, in class-id order

Run it with Ultralytics (offline):
  from ultralytics import YOLO
  results = YOLO("model.onnx", task="{task}").predict("image.jpg")

or with onnxruntime directly (the class names are also in the model's
metadata, key "names").
"""


def iou(a, b):
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    inter = max(0, min(ax2, bx2) - max(ax1, bx1)) * max(0, min(ay2, by2) - max(ay1, by1))
    union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - inter
    return inter / union if union > 0 else 0.0


def compare(original, exported, sample, imgsz, task):
    """Detections of both models on one image, matched by class and overlap."""
    from ultralytics import YOLO

    def detections(weights):
        result = YOLO(weights, task=task).predict(sample, imgsz=imgsz, conf=0.25, verbose=False)[0]
        boxes = result.boxes
        return sorted(
            ((int(boxes.cls[i]), float(boxes.conf[i]), boxes.xyxyn[i].tolist()) for i in range(len(boxes))),
            key=lambda item: -item[1])

    torch_found = detections(original)
    onnx_found = detections(exported)
    matched = sum(1 for cls, _, box in torch_found
                  if any(cls == other_cls and iou(box, other_box) > 0.9 for other_cls, _, other_box in onnx_found))
    return {
        "verified": True,
        "input": os.path.basename(sample),
        "pytorch": f"{len(torch_found)} detections",
        "onnx": f"{len(onnx_found)} detections",
        "match": len(torch_found) == len(onnx_found) and matched == len(torch_found),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--imgsz", type=int, default=0)
    parser.add_argument("--sample")
    args = parser.parse_args()

    check_model(args.model)
    meta = read_meta(args.model)
    if importlib.util.find_spec("onnx") is None:
        fail("The onnx package is not installed. Run: pip install -r backend/python/requirements.txt")
    try:
        from ultralytics import YOLO
    except ImportError as error:
        fail(f"{error.name or error} is not installed. Run: pip install -r backend/python/requirements.txt")

    imgsz = args.imgsz or int(meta.get("imgsz") or 640)
    if os.path.exists(args.output):
        shutil.rmtree(args.output)
    os.makedirs(args.output)

    # Ultralytics writes the .onnx next to the weights, so export a copy that
    # lives in the output folder.
    weights = os.path.join(args.output, "model.pt")
    shutil.copyfile(yolo_weights(args.model), weights)
    model = YOLO(weights)
    task = getattr(model, "task", "detect")
    names = model.names if isinstance(model.names, dict) else dict(enumerate(model.names))
    classes = [names[index] for index in sorted(names)]

    emit("status", message="Exporting with Ultralytics", method="ultralytics")
    try:
        exported = model.export(
            format="onnx",
            imgsz=imgsz,
            # onnxslim tidies the graph; used when installed, skipped (not
            # auto-installed) when not.
            simplify=importlib.util.find_spec("onnxslim") is not None,
            dynamic=False,
        )
    except Exception as error:  # noqa: BLE001 — reported to the page, not swallowed
        fail(f"ONNX export failed: {error}")
    onnx_path = os.path.join(args.output, "model.onnx")
    if os.path.abspath(str(exported)) != os.path.abspath(onnx_path):
        shutil.move(str(exported), onnx_path)

    check = {"verified": False, "reason": "No sample image was available to test-run the export."}
    if args.sample and os.path.exists(args.sample):
        emit("status", message="Checking the exported model")
        try:
            check = compare(weights, onnx_path, args.sample, imgsz, task)
        except Exception as error:  # noqa: BLE001
            check = {"verified": False, "reason": f"The check could not run: {error}"}
    os.remove(weights)

    with open(os.path.join(args.output, "classes.txt"), "w", encoding="utf-8") as handle:
        handle.write("\n".join(classes) + "\n")
    with open(os.path.join(args.output, "README.txt"), "w", encoding="utf-8") as handle:
        handle.write(README.format(name=meta.get("name", os.path.basename(args.model)), task=task,
                                   imgsz=imgsz, classes=", ".join(classes)))

    emit("status", message="Creating the zip")
    archive = shutil.make_archive(args.output, "zip", args.output)
    emit("done", method="ultralytics", files=sorted(os.listdir(args.output)),
         archive=os.path.basename(archive), bytes=os.path.getsize(archive), check=check,
         classes=classes, task=task, imgsz=imgsz)


if __name__ == "__main__":
    main()
