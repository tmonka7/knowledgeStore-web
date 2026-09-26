"""Run a local YOLO model (.pt or .onnx) on images, offline.

    python yolo_predict.py --model models/finetuned/<id> --images a.jpg b.png [--conf 0.25]

stdout: one "done" event with, per image, its size and the detections —
class, confidence, the box as normalised [x1, y1, x2, y2], and for a
segmentation model the outline as normalised [[x, y], ...].
"""
import argparse
import os
import time

from ks_common import check_model, emit, fail, go_offline_yolo, yolo_weights

go_offline_yolo()


def describe(result):
    height, width = result.orig_shape
    names = result.names
    detections = []
    boxes = result.boxes
    polygons = result.masks.xyn if result.masks is not None else None
    for index in range(len(boxes) if boxes is not None else 0):
        x1, y1, x2, y2 = boxes.xyxyn[index].tolist()
        class_id = int(boxes.cls[index])
        detection = {
            "classId": class_id,
            "name": names.get(class_id, str(class_id)) if isinstance(names, dict) else names[class_id],
            "confidence": round(float(boxes.conf[index]), 4),
            "box": [round(x1, 5), round(y1, 5), round(x2, 5), round(y2, 5)],
        }
        if polygons is not None and index < len(polygons):
            detection["polygon"] = [[round(float(x), 5), round(float(y), 5)] for x, y in polygons[index]]
        detections.append(detection)
    return {"width": width, "height": height, "detections": detections}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="a model folder, or a .pt / .onnx file")
    parser.add_argument("--images", nargs="+", required=True)
    parser.add_argument("--conf", type=float, default=0.25)
    parser.add_argument("--imgsz", type=int, default=0)
    args = parser.parse_args()

    if os.path.isdir(args.model):
        check_model(args.model)
        weights = yolo_weights(args.model)
    else:
        weights = args.model

    try:
        from ultralytics import YOLO
    except ImportError as error:
        fail(f"{error.name or error} is not installed. Run: pip install -r backend/python/requirements.txt")

    started = time.time()
    model = YOLO(weights, task=None)
    options = {"conf": args.conf, "verbose": False}
    if args.imgsz:
        options["imgsz"] = args.imgsz
    results = [describe(result) for result in model.predict(args.images, **options)]
    emit("done", results=results, task=getattr(model, "task", "detect"),
         seconds=round(time.time() - started, 2))


if __name__ == "__main__":
    main()
