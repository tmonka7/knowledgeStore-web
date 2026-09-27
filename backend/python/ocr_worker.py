"""Text recognition with PaddleOCR (PP-OCRv5), for Tools > AI > OCR.

A long-running worker, started by backend/src/helpers/ocr.js. The models are
read from the folders download_models.py puts them in; nothing is fetched.

Protocol, one JSON object per line:
  in  {"id": "...", "image": "<path>", "det": "<folder>", "rec": "<folder>",
       "textline": "<folder>" | null}
  out {"id": "...", "ok": true, "width": 1280, "height": 720,
       "lines": [{"text": "...", "score": 0.98, "box": [[x, y] x 4]}], "took": 0.42}
      {"id": "...", "ok": false, "error": "..."}
The first line out is {"ready": true, ...} or {"fatal": "..."}.
"""
import json
import os
import sys
import time
import traceback

# PaddleX checks that its model hosts can be reached when it is imported;
# every model here comes from disk, so that check is only a delay offline.
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

REPLY = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1)
os.dup2(2, 1)
sys.stdout = sys.stderr

from ks_common import read_meta  # noqa: E402  (after the redirect)

# Two pipelines at a time: enough to compare two languages or two models
# without holding every recognition model in memory.
MAX_LOADED = 2


def reply(message):
    REPLY.write(json.dumps(message, ensure_ascii=False) + "\n")
    REPLY.flush()


def model_name(folder):
    """The model's PaddleX name: the folder is named after it, as the repository is."""
    return os.path.basename(os.path.normpath(folder))


def build(det, rec, textline):
    from paddleocr import PaddleOCR

    for folder in filter(None, (det, rec, textline)):
        if not read_meta(folder).get("complete"):
            raise ValueError(f"{model_name(folder)} is not fully downloaded. Run: python download_models.py paddleocr")
    options = {
        "text_detection_model_name": model_name(det),
        "text_detection_model_dir": det,
        "text_recognition_model_name": model_name(rec),
        "text_recognition_model_dir": rec,
        # Page-level orientation and unwarping are for photographed documents
        # and need two more models; the text-line classifier covers the
        # common case of text turned upside down.
        "use_doc_orientation_classify": False,
        "use_doc_unwarping": False,
        "use_textline_orientation": bool(textline),
        # oneDNN (MKL-DNN) fails on the PP-OCRv5 graphs with PaddlePaddle 3.3
        # on the CPU ("ConvertPirAttribute2RuntimeAttribute not support").
        # OCR_MKLDNN=1 turns it back on where the installed version handles it.
        "enable_mkldnn": os.environ.get("OCR_MKLDNN") == "1",
    }
    if textline:
        options.update(textline_orientation_model_name=model_name(textline), textline_orientation_model_dir=textline)
    return PaddleOCR(**options)


def read_image(path):
    """The image as BGR pixels, turned as its EXIF orientation says.

    Decoded here rather than by PaddleOCR, which picks a reader by the file's
    extension — an upload is saved without one — and ignores EXIF, so a
    phone photo would be read on its side while the page shows it upright.
    """
    import numpy as np
    from PIL import Image, ImageOps, UnidentifiedImageError

    try:
        with Image.open(path) as image:
            image = ImageOps.exif_transpose(image).convert("RGB")
    except UnidentifiedImageError:
        raise ValueError("this file is not an image that can be read (PNG, JPEG, BMP or WebP)") from None
    return np.ascontiguousarray(np.asarray(image)[:, :, ::-1])


def installed_version(*distributions):
    """The version of the first of these pip packages that is installed, or None."""
    from importlib.metadata import PackageNotFoundError, version

    for name in distributions:
        try:
            return version(name)
        except PackageNotFoundError:
            continue
    return None


def main():
    # Ready as soon as the packages are known to be there. Loading PaddlePaddle
    # (about a gigabyte of native libraries) takes seconds on a fast machine
    # but minutes on a slow disk, or the first time an antivirus scans it; it
    # happens below, while the first request waits, under that request's time
    # limit instead of the server's start-up limit.
    from importlib.util import find_spec

    missing = [name for name in ("numpy", "PIL", "paddle", "paddleocr") if find_spec(name) is None]
    if missing:
        reply({"fatal": f"OCR needs PaddleOCR for {sys.executable} ({', '.join(missing)} not installed). "
                        "Run: pip install paddlepaddle paddleocr"})
        return
    reply({"ready": True, "python": sys.version.split()[0],
           "paddle": installed_version("paddlepaddle", "paddlepaddle-gpu") or "",
           "paddleocr": installed_version("paddleocr") or ""})

    started = time.time()
    try:
        import paddleocr  # noqa: F401  (loads paddle and paddlex too)
        load_error = None
        print(f"PaddleOCR loaded in {time.time() - started:.1f} s", file=sys.stderr, flush=True)
    except Exception as error:  # noqa: BLE001  (reported on every request instead)
        traceback.print_exc()
        load_error = f"PaddleOCR could not be loaded ({error or error.__class__.__name__})"

    loaded = {}

    def pipeline(det, rec, textline):
        key = (det, rec, textline)
        if key not in loaded:
            while len(loaded) >= MAX_LOADED:
                loaded.pop(next(iter(loaded)))
            loaded[key] = build(det, rec, textline)
        return loaded[key]

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            if not request.get("image") or not request.get("det") or not request.get("rec"):
                raise ValueError("the request needs an image and the detection and recognition models")
            if load_error:
                raise RuntimeError(load_error)
            started = time.time()
            pixels = read_image(request["image"])
            height, width = pixels.shape[:2]
            ocr = pipeline(request["det"], request["rec"], request.get("textline") or None)
            result = ocr.predict(pixels)[0]
            texts = result["rec_texts"]
            scores = result["rec_scores"]
            polys = result["rec_polys"]
            lines = [
                {"text": text, "score": round(float(score), 4),
                 "box": [[round(float(x), 1), round(float(y), 1)] for x, y in poly]}
                for text, score, poly in zip(texts, scores, polys) if str(text).strip()
            ]
            reply({"id": request_id, "ok": True, "width": width, "height": height,
                   "lines": lines, "took": round(time.time() - started, 3)})
        except Exception as error:  # noqa: BLE001  (one bad request must not end the worker)
            traceback.print_exc()
            reply({"id": request_id, "ok": False, "error": str(error) or error.__class__.__name__})


if __name__ == "__main__":
    main()
