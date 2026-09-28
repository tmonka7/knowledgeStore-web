"""SAM2 (Segment Anything 2) for the YOLO page's Labelling tab: finds regions in an image.

Started once by backend/src/helpers/samSegment.js and kept running; one JSON
request per line on stdin, one reply per line on stdout:

  in   {"id", "model": "<folder with the .pt>", "image": "<path>",
        "mode": "prompt", "points": [[x, y, 1 | 0], ...], "box": [x1, y1, x2, y2] | null}
       {"id", "model", "image", "mode": "auto", "maxRegions": 40, "grid": 16}
  out  {"id", "ok": true, "width", "height", "took",
        "regions": [{"box": [x, y, w, h], "polygon": [[x, y], ...], "score", "area"}]}
       {"id", "ok": false, "error"}

Coordinates are fractions of the image (0..1); a box is its top-left corner
and size, as the page keeps them. "prompt" is one object: the points clicked
on it (1) or off it (0) and/or a box around it. "auto" finds the regions in
the whole image, the way SAM's automatic mask generator does: a grid of point
prompts, each giving candidate masks that are kept when the model is sure of
them and they are stable, and then de-duplicated.

The model runs through Ultralytics (already needed for YOLO): SAM2Predictor
encodes the image, and its prompt encoder and mask decoder turn prompts into
masks. Those are 256x256 for the 1024x1024 model input; they are filtered and
de-duplicated at that size and only the ones kept are scaled to the image,
which is what makes "auto" take seconds on a CPU rather than a minute and a
half. An image's encoding is kept for the next few requests on the same image
(the page sends the same bytes for every click on it), so a click after the
first costs only the decoder.
"""
import hashlib
import json
import os
import sys
import time
from collections import OrderedDict

REPLY = sys.stdout
sys.stdout = sys.stderr  # library chatter must not reach the reply channel

INPUT_SIZE = 1024
LOW_RES = 256
CACHE_IMAGES = 4


def send(message):
    REPLY.write(json.dumps(message) + "\n")
    REPLY.flush()


try:
    os.environ.setdefault("YOLO_OFFLINE", "1")
    import cv2
    import numpy as np
    import torch
    import torch.nn.functional as F
    import torchvision
    from ultralytics.models.sam import SAM2Predictor
except ImportError as error:
    send({"fatal": f"SAM2 needs {getattr(error, 'name', None) or error}, which is not installed. "
                   "Run: pip install -r backend/python/requirements.txt"})
    sys.exit(1)

torch.set_grad_enabled(False)
predictors = {}
encoded = OrderedDict()  # (weights, sha1 of the image) -> (features, height, width)


def weights_in(folder):
    names = sorted(name for name in os.listdir(folder) if name.endswith(".pt"))
    if not names:
        raise ValueError(f"There is no .pt file in {folder}.")
    return os.path.join(folder, names[0])


def predictor_for(folder):
    weights = weights_in(folder)
    if weights not in predictors:
        predictor = SAM2Predictor(overrides=dict(model=weights, imgsz=INPUT_SIZE, conf=0.25, mode="predict",
                                                 task="segment", verbose=False, save=False))
        predictor.setup_model(model=None, verbose=False)
        predictors.clear()  # one model at a time: they are large
        encoded.clear()
        predictors[weights] = predictor
    return weights, predictors[weights]


def encode(weights, predictor, path):
    """The image's features (cached by its bytes) and its size."""
    with open(path, "rb") as handle:
        data = handle.read()
    key = (weights, hashlib.sha1(data).hexdigest())
    if key in encoded:
        encoded.move_to_end(key)
        return encoded[key]
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("The image could not be read.")
    predictor.reset_image()
    predictor.set_image(image)
    value = (predictor.features, image.shape[0], image.shape[1])
    encoded[key] = value
    while len(encoded) > CACHE_IMAGES:
        encoded.popitem(last=False)
    return value


def decode(predictor, features, height, width, points=None, labels=None, box=None):
    """Low-resolution mask logits (N*3, 256, 256) and their predicted quality, for prompts in image pixels."""
    predictor.segment_all = False
    prompt_points, prompt_labels, _ = predictor._prepare_prompts(
        (INPUT_SIZE, INPUT_SIZE), (height, width), bboxes=box, points=points, labels=labels)
    masks, scores = predictor._inference_features(features, prompt_points, prompt_labels, multimask_output=True)
    return masks.float(), scores.float()


def valid_region(height, width):
    """The part of the 256x256 masks that covers the image: the model input is
    the image scaled to fit 1024 and padded on the right and bottom."""
    gain = INPUT_SIZE / max(height, width)
    return (max(1, round(height * gain * LOW_RES / INPUT_SIZE)), max(1, round(width * gain * LOW_RES / INPUT_SIZE)))


def to_image(logits, height, width):
    """Masks at the image's size, as booleans, from low-resolution logits."""
    rows, cols = valid_region(height, width)
    cropped = logits[:, :rows, :cols][None]
    return (F.interpolate(cropped, (height, width), mode="bilinear", align_corners=False)[0] > 0).cpu().numpy()


def outline(mask, height, width):
    """The mask's largest outline as a simplified polygon, and its box, both 0..1."""
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    if cv2.contourArea(contour) < 4:
        return None
    # About one point per 0.3% of the outline: close to the edge, small enough to edit.
    simple = cv2.approxPolyDP(contour, max(1.0, 0.003 * cv2.arcLength(contour, True)), True)[:, 0, :]
    if len(simple) < 3:
        return None
    x, y, w, h = cv2.boundingRect(contour)
    return {
        "box": [round(x / width, 5), round(y / height, 5), round(w / width, 5), round(h / height, 5)],
        "polygon": [[round(float(px) / width, 5), round(float(py) / height, 5)] for px, py in simple],
        "area": round(float(mask.sum()) / (width * height), 5),
    }


def stability(logits, offset=1.0):
    """How little a mask changes when its threshold moves: SAM's stability score."""
    inner = (logits > offset).flatten(1).sum(1).float()
    outer = (logits > -offset).flatten(1).sum(1).float()
    return inner / outer.clamp(min=1)


def boxes_of(binary):
    """Boxes (x1, y1, x2, y2) of boolean masks, in mask pixels."""
    n, h, w = binary.shape
    rows = binary.any(2)
    cols = binary.any(1)
    ys = torch.arange(h).expand(n, h)
    xs = torch.arange(w).expand(n, w)
    y1 = torch.where(rows, ys, h).min(1).values
    y2 = torch.where(rows, ys, -1).max(1).values
    x1 = torch.where(cols, xs, w).min(1).values
    x2 = torch.where(cols, xs, -1).max(1).values
    return torch.stack([x1, y1, x2 + 1, y2 + 1], 1).float()


def run_prompt(predictor, features, height, width, request):
    points = request.get("points") or []
    box = request.get("box")
    if not points and not box:
        raise ValueError("Click on the object, or draw a box around it.")
    pixel_points = [[p[0] * width, p[1] * height] for p in points] or None
    labels = [int(p[2]) if len(p) > 2 else 1 for p in points] or None
    pixel_box = [box[0] * width, box[1] * height, box[2] * width, box[3] * height] if box else None
    logits, scores = decode(predictor, features, height, width,
                            points=[pixel_points] if pixel_points else None,
                            labels=[labels] if labels else None, box=pixel_box)
    best = int(scores.argmax())
    region = outline(to_image(logits[best:best + 1], height, width)[0], height, width)
    if not region:
        return []
    region["score"] = round(float(scores[best]), 4)
    return [region]


def run_auto(predictor, features, height, width, request):
    grid = max(4, min(32, int(request.get("grid") or 16)))
    limit = max(1, min(200, int(request.get("maxRegions") or 40)))
    rows, cols = valid_region(height, width)

    # A grid of single-point prompts over the image. The decoder costs about
    # the same for every point (60 ms on a CPU), so points are taken coarse to
    # fine — every 4th row and column first, then the gaps — and a point that
    # already lies inside a region found with confidence is skipped: a large
    # object would otherwise be found again from every point on it. The price
    # is that parts inside a found object (a window of a bus) are not offered,
    # which suits labelling whole objects.
    steps = (np.arange(grid) + 0.5) / grid
    order = sorted(((row, col) for row in range(grid) for col in range(grid)),
                   key=lambda cell: (0 if cell[0] % 4 == 0 and cell[1] % 4 == 0 else 1 if cell[0] % 2 == 0 and cell[1] % 2 == 0 else 2))
    pending = [(steps[col], steps[row]) for row, col in order]
    covered = torch.zeros((rows, cols), dtype=torch.bool)
    kept_logits, kept_scores = [], []
    prompts = 0
    while pending:
        batch, rest = [], []
        for x, y in pending:
            if covered[min(rows - 1, int(y * rows)), min(cols - 1, int(x * cols))]:
                continue
            (batch if len(batch) < 16 else rest).append((x, y))
        pending = rest
        if not batch:
            break
        prompts += len(batch)
        points = np.array([[x * width, y * height] for x, y in batch], dtype=np.float32)
        logits, scores = decode(predictor, features, height, width, points=points, labels=np.ones(len(batch)))
        logits = logits[:, :rows, :cols]
        keep = scores > 0.8
        logits, scores = logits[keep], scores[keep]
        keep = stability(logits) > 0.9
        logits, scores = logits[keep], scores[keep]
        kept_logits.append(logits)
        kept_scores.append(scores)
        confident = (logits > 0)[scores > 0.9]
        if len(confident):
            # A region covering most of the picture is background: it covers nothing.
            small = confident.flatten(1).float().mean(1) < 0.5
            if small.any():
                covered |= confident[small].any(0)
    logits = torch.cat(kept_logits)
    scores = torch.cat(kept_scores)
    if not len(scores):
        return []

    binary = logits > 0
    area = binary.flatten(1).float().mean(1)
    # Not specks, and not the whole picture (the background is a region too, but not a label).
    keep = (area > 0.0015) & (area < 0.85)
    logits, scores, binary = logits[keep], scores[keep], binary[keep]
    if not len(scores):
        return []
    keep = torchvision.ops.nms(boxes_of(binary), scores, 0.7)[:limit]
    regions = []
    for index, mask in zip(keep.tolist(), to_image(logits[keep], height, width)):
        region = outline(mask, height, width)
        if region:
            region["score"] = round(float(scores[index]), 4)
            regions.append(region)
    print(f"auto: {prompts} of {grid * grid} prompts, {len(regions)} regions", file=sys.stderr)
    return regions


def handle(request):
    started = time.time()
    weights, predictor = predictor_for(request["model"])
    features, height, width = encode(weights, predictor, request["image"])
    regions = (run_auto if request.get("mode") == "auto" else run_prompt)(predictor, features, height, width, request)
    return {"width": width, "height": height, "regions": regions, "took": round(time.time() - started, 2)}


def main():
    send({"ready": True, "device": "cpu"})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except ValueError:
            continue
        try:
            send({"id": request.get("id"), "ok": True, **handle(request)})
        except Exception as error:  # noqa: BLE001 — reported to the page
            send({"id": request.get("id"), "ok": False, "error": str(error)[:500]})


if __name__ == "__main__":
    main()
