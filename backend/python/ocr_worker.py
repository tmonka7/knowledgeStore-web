"""Text recognition with PaddleOCR (PP-OCRv5), for Tools > AI > OCR.

A long-running worker, started by backend/src/helpers/ocr.js. The models are
read from the folders download_models.py puts them in; nothing is fetched.

Protocol, one JSON object per line:
  in  {"id": "...", "image": "<path>", "pdf": false, "maxPages": 30,
       "det": "<folder>", "rec": "<folder>", "textline": "<folder>" | null,
       "layout": "<folder>" | null, "table": "<folder>" | null}
      {"cancel": "<id>"}   stop that request after the page being read
  out {"id": "...", "progress": true, "done": 0, "total": 12, "pageCount": 40}
      {"id": "...", "progress": true, "done": 3, "total": 12,
       "page": {"page": 3, "width": 1700, "height": 2200, "image": "data:…" | null,
                "lines": [{"text": "...", "score": 0.98, "box": [[x, y] x 4], "color": "#1f3a93",
                           "bold": true, "role": "title", "region": 3}],
                "blocks": [{"type": "table", "box": [x1, y1, x2, y2], "html": "<table>…",
                            "columns": [x, …], "rows": [y, …]},
                           {"type": "figure", "box": [x1, y1, x2, y2], "image": "data:…"}]}}
      {"id": "...", "ok": true, "done": 12, "total": 12, "pageCount": 40, "took": 31.2,
       "engine": "onnxruntime" | "paddle"}
      {"id": "...", "ok": false, "error": "...", "cancelled": false}
Every page is sent as soon as it is read, so the page can show progress and
the pages read so far; the final reply only closes the request. An image is
one page. With "pdf": true the file is a PDF: its first maxPages pages are
rendered and read, and each page carries "image", a JPEG preview (a data:
URL), since a browser cannot draw a PDF page under the boxes itself. Boxes are
in the rendered page's pixels, which the preview keeps the proportions of.
With a "layout" model each line also gets a "role" — title, text, caption,
header, footer, or table / figure for a line inside one — and "region", the
layout region it is in (lines of one region are one block of text), and the page gets
"blocks": its tables, rebuilt as HTML with the "table" model and the lines in
each cell, and its figures, cut out of the page. Without one, lines have no
role and there are no blocks. A table's "columns" and "rows" are the edges of
its grid on the page, when the cells found line up into one (else absent).
Every line has the colour of its ink, and "bold" when its strokes are
markedly heavier than the page's other text of that size.
The first line out is {"ready": true, ...} or {"fatal": "..."}.

Speed: a model folder with an inference.onnx (download_models.py adds one) is
run on ONNX Runtime, which reads the same text as Paddle several times faster
on a CPU. A pipeline uses it when every model in it has one and onnxruntime is
installed, else Paddle; OCR_ENGINE=paddle forces Paddle. The layout model has
no ONNX copy and stays on Paddle, on a thread of its own, so it looks at a
page while the text of that page is read.
"""
import collections
import concurrent.futures
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
# PDF pages are rendered at this resolution for reading: enough for 8-point
# print. The previews sent back are smaller, as a page only shows them.
PDF_DPI = 200
PREVIEW_WIDTH = 1400
FIGURE_WIDTH = 1000

# PP-DocLayout labels, by what the page does with them.
TITLE_LABELS = {"doc_title", "paragraph_title"}
CAPTION_LABELS = {"figure_title", "table_title", "chart_title", "figure_table_chart_title"}
HEADER_LABELS = {"header", "header_image"}
FOOTER_LABELS = {"footer", "footer_image", "footnote", "number"}
FIGURE_LABELS = {"image", "chart", "seal", "header_image", "footer_image"}



def reply(message):
    REPLY.write(json.dumps(message, ensure_ascii=False) + "\n")
    REPLY.flush()


class Input:
    """Lines from stdin, read without Python's buffering so the pipe can be
    peeked at: between two pages the worker looks for a cancel without
    waiting for one.

    Not a thread blocked in a read: on Windows a read pending on the pipe
    stalls every DLL load in the process (the loader queries the standard
    handles), and loading PaddleOCR is a long run of DLL loads.
    """

    def __init__(self, fd=0):
        self.fd = fd
        self.buffer = b""
        self.closed = False
        if os.name == "nt":
            import ctypes
            import msvcrt
            from ctypes import wintypes

            self._handle = msvcrt.get_osfhandle(fd)
            self._peek = ctypes.windll.kernel32.PeekNamedPipe
            self._peek.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p,
                                   ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
            self._ctypes, self._wintypes = ctypes, wintypes

    def _waiting(self):
        """Bytes that can be read without blocking (1 at end of input, so the read sees it)."""
        if os.name == "nt":
            count = self._wintypes.DWORD(0)
            if not self._peek(self._handle, None, 0, None, self._ctypes.byref(count), None):
                return 1  # A closed pipe: the read returns b"" and marks the end.
            return count.value
        import select
        return 1 if select.select([self.fd], [], [], 0)[0] else 0

    def _fill(self, size):
        chunk = os.read(self.fd, size)
        if not chunk:
            self.closed = True
        self.buffer += chunk

    def _take_lines(self):
        *lines, self.buffer = self.buffer.split(b"\n")
        return [line.decode("utf-8", "replace").strip() for line in lines if line.strip()]

    def available(self):
        """The complete lines that have arrived, without waiting."""
        while not self.closed and (waiting := self._waiting()):
            self._fill(max(1, waiting))
        return self._take_lines()

    def wait(self):
        """At least one line, waiting for it; [] once stdin is closed."""
        while b"\n" not in self.buffer and not self.closed:
            self._fill(65536)
        return self._take_lines()


class Cancelled(Exception):
    pass


def model_name(folder):
    """The model's PaddleX name: the folder is named after it, as the repository is."""
    return os.path.basename(os.path.normpath(folder))


def engine_for(*folders):
    """ONNX Runtime when every model here has an ONNX copy and it is installed; else Paddle."""
    from importlib.util import find_spec

    if os.environ.get("OCR_ENGINE", "").lower() == "paddle" or find_spec("onnxruntime") is None:
        return "paddle"
    if all(os.path.isfile(os.path.join(folder, "inference.onnx")) for folder in folders if folder):
        return "onnxruntime"
    return "paddle"


def with_engine(make, engine, what, paddle_options=None):
    """(model, engine): on the engine chosen, or on Paddle when ONNX Runtime cannot load it."""
    if engine == "onnxruntime":
        try:
            return make({"engine": "onnxruntime"}), engine
        except Exception:  # noqa: BLE001  (a damaged ONNX copy: Paddle still reads the page)
            traceback.print_exc()
            print(f"{what}: ONNX Runtime could not load it; using Paddle", file=sys.stderr, flush=True)
    # oneDNN (MKL-DNN) fails on the PP-OCRv5 and PP-DocLayout graphs with
    # PaddlePaddle 3.3 on the CPU ("ConvertPirAttribute2RuntimeAttribute not
    # support"). OCR_MKLDNN=1 turns it back on where the installed version
    # handles it.
    return make({"enable_mkldnn": os.environ.get("OCR_MKLDNN") == "1", **(paddle_options or {})}), "paddle"


def build(det, rec, textline):
    """The text pipeline, and the engine it runs on."""
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
    }
    if textline:
        options.update(textline_orientation_model_name=model_name(textline), textline_orientation_model_dir=textline)
    return with_engine(lambda engine: PaddleOCR(**options, **engine), engine_for(det, rec, textline), model_name(rec))


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


def open_pdf(path):
    import pypdfium2 as pdfium

    try:
        return pdfium.PdfDocument(path)
    except pdfium.PdfiumError as error:
        raise ValueError(f"this PDF cannot be opened ({error}); it may be damaged or password-protected") from None


def render_page(document, index):
    """One PDF page as BGR pixels, rendered at PDF_DPI."""
    import numpy as np

    page = document[index]
    try:
        image = page.render(scale=PDF_DPI / 72).to_pil().convert("RGB")
    finally:
        page.close()
    return np.ascontiguousarray(np.asarray(image)[:, :, ::-1])


def preview(pixels, max_width=PREVIEW_WIDTH):
    """A JPEG data: URL of a page (or part of one), at most max_width wide."""
    import base64
    import io
    from PIL import Image

    image = Image.fromarray(pixels[:, :, ::-1])
    if image.width > max_width:
        image = image.resize((max_width, round(image.height * max_width / image.width)), Image.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=80)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def read_lines(ocr, pixels):
    """Every line of text PaddleOCR finds in one image."""
    result = ocr.predict(pixels)[0]
    return [
        {"text": text, "score": round(float(score), 4),
         "box": [[round(float(x), 1), round(float(y), 1)] for x, y in poly]}
        for text, score, poly in zip(result["rec_texts"], result["rec_scores"], result["rec_polys"])
        if str(text).strip()
    ]


def line_styles(pixels, lines):
    """Each line's ink colour, and whether it is bold.

    The ink is the pixels of a line's box that stand well apart from its
    background (the box's median). Bold is judged by stroke thickness — ink
    area over ink outline, about half a stroke's width — against lines of a
    similar size on the page, since thicker strokes are what make type bold.
    """
    import numpy as np

    height, width = pixels.shape[:2]
    measures = []  # (stroke thickness, box height) per line; thickness 0 when unknown
    for line in lines:
        xs = [point[0] for point in line["box"]]
        ys = [point[1] for point in line["box"]]
        x1, x2 = max(0, int(min(xs))), min(width, int(max(xs)) + 1)
        y1, y2 = max(0, int(min(ys))), min(height, int(max(ys)) + 1)
        line["color"], thickness = "#000000", 0.0
        crop = pixels[y1:y2, x1:x2].astype(np.int16)
        if crop.shape[0] >= 4 and crop.shape[1] >= 4:
            background = np.median(crop.reshape(-1, 3), axis=0)
            distance = np.abs(crop - background).sum(axis=2)
            ink = distance > 150
            if ink.sum() >= 8:
                padded = np.pad(ink, 1)
                inner = padded[:-2, 1:-1] & padded[2:, 1:-1] & padded[1:-1, :-2] & padded[1:-1, 2:]
                thickness = 2 * ink.sum() / max(1, (ink & ~inner).sum())
                # The core of the strokes, not their anti-aliased edges.
                values = distance[ink]
                core = crop[ink][values >= np.percentile(values, 60)]
                blue, green, red = (int(value) for value in np.median(core, axis=0))
                # Near-black is black: scanning and JPEG tint what was printed black.
                if max(red, green, blue) < 90 and max(red, green, blue) - min(red, green, blue) < 40:
                    red = green = blue = 0
                line["color"] = f"#{red:02x}{green:02x}{blue:02x}"
        measures.append((thickness, max(1, y2 - y1)))

    known = [(t, h) for t, h in measures if t > 0]
    usual_ratio = float(np.median([t / h for t, h in known])) if known else 0
    for index, (line, (thickness, size)) in enumerate(zip(lines, measures)):
        peers = [t for other, (t, h) in enumerate(measures)
                 if other != index and t > 0 and abs(h - size) <= size * 0.25]
        if thickness <= 0:
            line["bold"] = False
        elif len(peers) >= 3:
            line["bold"] = bool(thickness > float(np.median(peers)) * 1.3)
        else:
            line["bold"] = bool(usual_ratio and thickness / size > usual_ratio * 1.35)
    return lines


def _edges(values, tolerance):
    """Positions that are the same line within `tolerance`, as one each."""
    edges = []
    for value in sorted(values):
        if edges and value - edges[-1][-1] <= tolerance:
            edges[-1].append(value)
        else:
            edges.append([value])
    return [round(sum(group) / len(group), 1) for group in edges]


def layout_models(layout_dir, table_dir):
    from paddleocr import LayoutDetection, TableStructureRecognition

    # PP-DocLayout on Paddle was fastest on four threads (2.2 s a page against
    # 2.9 s on 8 or 16, on a 16-core machine); more only contend.
    threads = int(os.environ.get("OCR_LAYOUT_THREADS") or 0) or min(4, os.cpu_count() or 4)
    layout, _ = with_engine(
        lambda engine: LayoutDetection(model_name=model_name(layout_dir), model_dir=layout_dir, **engine),
        engine_for(layout_dir), model_name(layout_dir), {"cpu_threads": threads})
    table = None
    if table_dir:
        table, _ = with_engine(
            lambda engine: TableStructureRecognition(model_name=model_name(table_dir), model_dir=table_dir, **engine),
            engine_for(table_dir), model_name(table_dir))
    return layout, table


def _center(box):
    xs = [point[0] for point in box]
    ys = [point[1] for point in box]
    return sum(xs) / len(xs), sum(ys) / len(ys)


def _inside(point, rect):
    x, y = point
    return rect[0] <= x <= rect[2] and rect[1] <= y <= rect[3]


def _overlap(a, b):
    """Intersection over the smaller of two rectangles."""
    width = min(a[2], b[2]) - max(a[0], b[0])
    height = min(a[3], b[3]) - max(a[1], b[1])
    if width <= 0 or height <= 0:
        return 0.0
    smaller = min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])) or 1
    return width * height / smaller


def _cell_text(lines):
    """The lines in one cell, top to bottom, as HTML."""
    from html import escape

    rows = []
    for line in sorted(lines, key=lambda item: _center(item["box"])[1]):
        y = _center(line["box"])[1]
        height = abs(line["box"][3][1] - line["box"][0][1]) or 1
        if rows and abs(rows[-1][0] - y) < height / 2:
            rows[-1][1].append(line)
        else:
            rows.append([y, [line]])
    def styled(line):
        text = escape(line["text"])
        if line.get("color", "#000000") != "#000000":
            text = f'<span style="color:{line["color"]}">{text}</span>'
        return f"<b>{text}</b>" if line.get("bold") else text

    return "<br>".join(
        " ".join(styled(item) for item in sorted(row, key=lambda item: _center(item["box"])[0]))
        for _, row in rows
    )


def table_html(table_model, pixels, rect, lines):
    """A table region as {"html", "columns", "rows"}: the structure from the
    model, each cell filled with the text lines whose centre falls in it, and
    the grid's edges on the page."""
    x1, y1, x2, y2 = rect
    result = table_model.predict(pixels[y1:y2, x1:x2].copy())[0]
    cells = []
    for coords in result["bbox"]:
        xs, ys = coords[0::2], coords[1::2]
        cells.append([min(xs) + x1, min(ys) + y1, max(xs) + x1, max(ys) + y1])
    taken = set()

    def fill(index):
        if index >= len(cells):
            return ""
        chosen = [i for i, line in enumerate(lines) if i not in taken and _inside(_center(line["box"]), cells[index])]
        taken.update(chosen)
        return _cell_text([lines[i] for i in chosen])

    html, cell, opening = [], 0, False
    for token in result["structure"]:
        if token in ("<html>", "</html>", "<body>", "</body>"):
            continue
        if token == "<td></td>":
            html.append(f"<td>{fill(cell)}</td>")
            cell += 1
        elif token == "<td":
            html.append("<td")
            opening = True
        elif opening and token == ">":
            html.append(">" + fill(cell))
            cell += 1
            opening = False
        elif opening:
            html.append(token)  # colspan="2", rowspan="3"
        else:
            html.append(token)

    # The grid: cell sides that line up are one column or row edge. Only kept
    # when it has as many columns as the widest row, so widths never shift.
    table = {"html": "".join(html)}
    if cells:
        # Left and top sides: a cell's right side often runs into the next
        # column, while cells starting a column line up closely.
        columns = _edges([cell[0] for cell in cells], max(8, (x2 - x1) * 0.02)) + [max(cell[2] for cell in cells)]
        rows = _edges([cell[1] for cell in cells], max(6, (y2 - y1) * 0.02)) + [max(cell[3] for cell in cells)]
        count = 0
        best = 0
        for token in result["structure"]:
            if token == "<tr>":
                count = 0
            elif token in ("<td></td>", "<td"):
                count += 1
            elif "colspan" in token:
                count += int("".join(ch for ch in token if ch.isdigit()) or 1) - 1
            elif token == "</tr>":
                best = max(best, count)
        if len(columns) - 1 == best:
            table["columns"] = columns
        if len(rows) - 1 == result["structure"].count("<tr>"):
            table["rows"] = rows
    return table


def crop_image(pixels, rect):
    x1, y1, x2, y2 = rect
    return preview(pixels[y1:y2, x1:x2], FIGURE_WIDTH)


def find_regions(layout, pixels):
    """The layout model's regions of a page: titles, paragraphs, tables, figures …"""
    height, width = pixels.shape[:2]
    regions = []
    for box in layout.predict(pixels)[0]["boxes"]:
        x1, y1, x2, y2 = (int(round(float(value))) for value in box["coordinate"])
        rect = [max(0, x1), max(0, y1), min(width, x2), min(height, y2)]
        if rect[2] - rect[0] > 4 and rect[3] - rect[1] > 4:
            regions.append({"label": box["label"], "score": float(box["score"]), "rect": rect})
    return regions


def analyse_layout(table_model, pixels, lines, regions):
    """Give each line its role and find the page's tables and figures."""

    # One figure where the model saw both an image and a chart in one place.
    figures = []
    for region in sorted((r for r in regions if r["label"] in FIGURE_LABELS), key=lambda r: -r["score"]):
        if all(_overlap(region["rect"], other["rect"]) < 0.7 for other in figures):
            figures.append(region)
    tables = [r for r in regions if r["label"] == "table"]

    for line in lines:
        center = _center(line["box"])
        found = next((r for r in tables if _inside(center, r["rect"])), None) \
            or next((r for r in figures if _inside(center, r["rect"])), None) \
            or next((r for r in regions if _inside(center, r["rect"])), None)
        if found:
            line["region"] = regions.index(found)
        label = found["label"] if found else "text"
        line["role"] = ("table" if label == "table" else "figure" if label in FIGURE_LABELS
                        else "title" if label in TITLE_LABELS else "caption" if label in CAPTION_LABELS
                        else "header" if label in HEADER_LABELS else "footer" if label in FOOTER_LABELS
                        else "text")

    blocks = []
    for region in tables:
        inside = [line for line in lines if _inside(_center(line["box"]), region["rect"])]
        try:
            table = table_html(table_model, pixels, region["rect"], inside) if table_model else None
        except Exception:  # noqa: BLE001  (a table that cannot be rebuilt stays as lines)
            traceback.print_exc()
            table = None
        if table and table["html"]:
            blocks.append({"type": "table", "box": region["rect"], **table})
        else:
            for line in inside:
                line["role"] = "text"
    for region in figures:
        blocks.append({"type": "figure", "box": region["rect"], "image": crop_image(pixels, region["rect"])})
    return blocks


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

    # Requests queue here and are read one at a time; a cancel is picked up
    # between the pages of the one being read, or before a queued one starts.
    stdin = Input()
    requests = collections.deque()
    cancelled = set()

    def take(lines):
        for raw in lines:
            try:
                message = json.loads(raw)
            except ValueError as error:
                reply({"id": None, "ok": False, "error": f"not JSON: {error}"})
                continue
            if message.get("cancel"):
                cancelled.add(message["cancel"])
            else:
                requests.append(message)

    started = time.time()
    try:
        import paddleocr  # noqa: F401  (loads paddle and paddlex too)
        if find_spec("onnxruntime") is not None:
            import onnxruntime

            # Its shape warnings on SLANet are harmless and would bury real errors.
            onnxruntime.set_default_logger_severity(3)
        load_error = None
        print(f"PaddleOCR loaded in {time.time() - started:.1f} s", file=sys.stderr, flush=True)
    except Exception as error:  # noqa: BLE001  (reported on every request instead)
        traceback.print_exc()
        load_error = f"PaddleOCR could not be loaded ({error or error.__class__.__name__})"

    loaded = {}
    layouts = {}
    # The layout models are built and run on this one thread only, so the
    # layout of a page is found while its text is read on the main thread.
    layout_thread = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="layout")

    def layout_pipeline(layout_dir, table_dir):
        key = (layout_dir, table_dir)
        if key not in layouts:
            layouts.clear()
            layouts[key] = layout_models(layout_dir, table_dir)
        return layouts[key]

    def pipeline(det, rec, textline):
        key = (det, rec, textline)
        if key not in loaded:
            while len(loaded) >= MAX_LOADED:
                loaded.pop(next(iter(loaded)))
            loaded[key] = build(det, rec, textline)
        return loaded[key]

    while True:
        take(stdin.available())
        while not requests:
            if stdin.closed:
                return
            take(stdin.wait())
        request = requests.popleft()
        request_id = request.get("id")
        document = None

        def check_cancelled():
            take(stdin.available())
            if request_id in cancelled:
                raise Cancelled()

        try:
            if not request.get("image") or not request.get("det") or not request.get("rec"):
                raise ValueError("the request needs an image and the detection and recognition models")
            if load_error:
                raise RuntimeError(load_error)
            check_cancelled()
            started = time.time()
            pdf = bool(request.get("pdf"))
            if pdf:
                if find_spec("pypdfium2") is None:
                    raise RuntimeError("reading PDFs needs pypdfium2. Run: pip install pypdfium2")
                document = open_pdf(request["image"])
                page_count = len(document)
                total = min(page_count, max(1, int(request.get("maxPages") or 30)))
            else:
                image = read_image(request["image"])
                page_count = total = 1
            reply({"id": request_id, "progress": True, "done": 0, "total": total, "pageCount": page_count})
            ocr, engine = pipeline(request["det"], request["rec"], request.get("textline") or None)
            layout = layout_thread.submit(layout_pipeline, request["layout"], request.get("table") or None).result() \
                if request.get("layout") else None
            for index in range(total):
                check_cancelled()
                pixels = render_page(document, index) if pdf else image
                height, width = pixels.shape[:2]
                regions = layout_thread.submit(find_regions, layout[0], pixels) if layout else None
                lines = line_styles(pixels, read_lines(ocr, pixels))
                page = {"page": index + 1, "width": width, "height": height,
                        "dpi": PDF_DPI if pdf else None,
                        "image": preview(pixels) if pdf else None, "lines": lines,
                        "blocks": layout_thread.submit(analyse_layout, layout[1], pixels, lines,
                                                       regions.result()).result() if layout else []}
                reply({"id": request_id, "progress": True, "done": index + 1, "total": total, "page": page})
            reply({"id": request_id, "ok": True, "done": total, "total": total, "pageCount": page_count,
                   "took": round(time.time() - started, 3), "engine": engine})
        except Cancelled:
            reply({"id": request_id, "ok": False, "error": "cancelled", "cancelled": True})
        except Exception as error:  # noqa: BLE001  (one bad request must not end the worker)
            traceback.print_exc()
            reply({"id": request_id, "ok": False, "error": str(error) or error.__class__.__name__})
        finally:
            if document is not None:
                document.close()
            cancelled.discard(request_id)


if __name__ == "__main__":
    main()
