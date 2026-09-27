# Translation models

Everything under this folder is read by `backend/python` and never downloaded
at run time: training, translation and ONNX export all run with Hugging Face's
offline mode on.

```
base/<name>/        base models fetched by download_models.py
finetuned/<id>/     models trained from the Transformers page
onnx/<id>/          ONNX exports, and <id>.zip for download
```

The weights are too large for git and are ignored. To install them, on a
machine with internet access:

```
pip install -r backend/python/requirements.txt
python backend/python/download_models.py en-es en-zh m2m100
python backend/python/download_models.py yolo26n yolo26n-seg whisper-tiny
python backend/python/download_models.py --list
```

For Speaker recognition (SpeechBrain's ECAPA-TDNN, trained on VoxCeleb,
Apache-2.0, about 90 MB):

```
pip install speechbrain
python backend/python/download_models.py ecapa
```

It makes a 192-number voiceprint of a clip in about 0.25 s on a CPU. The same
model powers voice sign-in (Login with Voice, and the voice enrolment at
registration); without it those are simply not offered. The
server loads it from `hyperparams.yaml` and `embedding_model.ckpt` directly,
because SpeechBrain's own loader contacts the Hugging Face Hub even for a
local folder; the voiceprints are identical.

The Models tab exports it to ONNX with `speaker_export.py` into
`models/onnx/<id>/` and `<id>.zip`: one graph from audio to voiceprint
(`ecapa.onnx`, about 84 MB). That needs PyTorch's newer exporter (the
`onnxscript` package), because the filterbank's STFT cannot go through the
older one; without it the graph starts from filterbank features instead
(`ecapa_fbank.onnx`).

For OCR (PaddleOCR 3 with the PP-OCRv5 models, Apache-2.0, about 90 MB):

```
pip install paddlepaddle paddleocr
python backend/python/download_models.py paddleocr
python backend/python/download_models.py paddleocr-server   # optional, larger and more accurate
```

Each model is its own folder in `models/base`, named as PaddleOCR names it:
`PP-OCRv5_mobile_det` finds the lines of text, `PP-LCNet_x1_0_textline_ori`
turns upside-down lines round (the page's **Rotated text** switch), and one
recognition model per script reads them — `en_PP-OCRv5_mobile_rec` (English),
`PP-OCRv5_mobile_rec` (Chinese and Japanese, and English too),
`korean_PP-OCRv5_mobile_rec` (Korean) and `eslav_PP-OCRv5_mobile_rec`
(Russian). For **Keep layout**, `PP-DocLayout-M` finds a page's titles,
paragraphs, tables and figures, and `SLANet_plus` recognises each table's rows,
columns and merged cells, which the worker fills with the lines read in each
cell (`paddleocr-server` adds the larger `PP-DocLayout_plus-L`). `ocr_worker.py`
loads them from these folders only; PaddleOCR's own download is never used.

Speed: `paddleocr` also puts an `inference.onnx` in each mobile model's folder
(RapidOCR's conversion of the same weights, from ModelScope). With
`onnxruntime` installed (it is in requirements.txt) those models run on ONNX
Runtime: on a 16-core CPU the text of a full A4 page is read in about 2 s
instead of 15 s, and a table in a sixth of the time, with exactly the same
result. `PP-DocLayout-M` has no ONNX copy and stays on Paddle (about 2 s a
page), on its own thread while the text is read; turning **Keep layout** off
skips it. `OCR_ENGINE=paddle` runs everything on Paddle. Paddle's oneDNN is
turned off, because PaddlePaddle 3.3 fails with it on these models on the CPU
(`OCR_MKLDNN=1` turns it back on).

For Text to Speech (Supertone's Supertonic 3, OpenRAIL-M, about 400 MB):

```
pip install onnxruntime
python backend/python/download_models.py supertonic-3
```

The folder `supertonic-3` holds the four ONNX models (`onnx/`) and the ten
preset voices (`voice_styles/F1.json` … `M5.json`); `tts_worker.py` runs them
with onnxruntime, following Supertone's reference code. It reads 31 languages,
not Chinese, at about 0.4 s of work per second of speech on a 16-core CPU.

**Train voice** (`tts_train_voice.py`) also needs the speaker model
(`download_models.py ecapa`), PyTorch and `onnx2torch` (all in
requirements.txt). It converts the four ONNX models to PyTorch in memory at
the start of each job; nothing is written to the model folder. A trained
voice is saved in `models/finetuned/<id>/` as `voice.json` (a voice style,
like `voice_styles/F1.json`) and `target.json` (the recordings' voiceprint).

For Speech to Command (Moonshine AI's Moonshine; English models MIT):

```
python backend/python/download_models.py moonshine-tiny
```

`moonshine-base` is larger (about 250 MB against 110 MB) and more accurate.
`moonshine-tiny-ko`, `-ja`, `-zh`, `-ar`, `-uk` and `-vi` (and the same for
base) transcribe those languages; they are under the Moonshine AI Community
License (free under US$1M a year in revenue; commercial users register with
Moonshine AI). They run with transformers 4.48 or later: `command_worker.py`
keeps one loaded and matches what it hears to a command set's phrases
(`command_common.py`), and `command_train.py` fine-tunes one on a set's
recordings, saving it with `commands.json` in `models/finetuned/<id>/`.

For Voice recognition on the Speech to Text page (whisper.cpp, MIT):

```
python backend/python/download_models.py ggml-tiny ggml-base ggml-tiny.en
```

| Model | Size | |
| --- | --- | --- |
| `ggml-tiny` | 75 MB | fastest; any language |
| `ggml-tiny.en` | 75 MB | English only, a little more accurate than `ggml-tiny` on English |
| `ggml-base` | 142 MB | better; any language |
| `ggml-base.en` | 142 MB | English only |

(`ggml-small` / `ggml-small.en`, 466 MB, also work.) They are whisper.cpp's
own model files from `ggerganov/whisper.cpp` and are separate from the
`whisper-*` models, which are for training. On a 16-thread CPU, `ggml-tiny`
recognises 7 seconds of speech in about 0.6 s and `ggml-base` in about 1.8 s.

A Whisper model trained on the Speech to Text page (or a `whisper-*` base
model) can be turned into one of these files with its **GGML** button;
`speech_ggml.py` does the conversion. For `openai/whisper-tiny` the result
matches `ggml-tiny.bin` exactly (same tensors and size). Converted copies are
stored in `finetuned/<model id>.ggml` and belong to the user who made them.

`yolo26n` / `yolo26n-seg` are Ultralytics' detection and segmentation weights
(about 6 MB each, AGPL-3.0; any other name such as `yolo11s` also works), for
the YOLO page. `whisper-tiny` is OpenAI's Whisper speech-recognition model
(about 150 MB; `whisper-base` and `whisper-small` are more accurate and
slower), for the Speech to Text page. Each model's `ks-model.json` records
which page it belongs to (`task`: translation, detection or speech).

Opus-MT models (`en-es`, `en-zh`, …) are small (about 300 MB) and made for one
direction each. `m2m100` is facebook/m2m100_418M (MIT licence, about 1.9 GB):
one model for any direction between 100 languages. It is what covers en→ko,
because Helsinki-NLP's only English→Korean model (`opus-mt-tc-big-en-ko`) is
broken on Hugging Face and translates into nonsense. For Korean→English there is also a small dedicated model,
`ko-en=Helsinki-NLP/opus-mt_tiny_kor-eng` (about 50 MB, fast to train). There
is no tiny English→Korean one. Fine-tuning M2M100 on a
CPU needs roughly 8 GB of free RAM, and its ONNX export is about 2.8 GB.

Opus-MT names a few languages differently from the codes a dataset uses; map
them explicitly, e.g. `en-ja=Helsinki-NLP/opus-mt-en-jap`.

If training or ONNX export reports that a model is damaged — typically after
an interrupted download, or a copy of this folder that did not finish — check
and repair it (the repair re-downloads only the damaged files):

```
python backend/python/download_models.py --verify
python backend/python/download_models.py --verify --repair
```

Training runs on the device chosen in each Train panel: automatic (the first
NVIDIA GPU if PyTorch can use one, otherwise the CPU), the CPU, or a specific
GPU. A GPU needs a CUDA build of PyTorch — see backend/python/requirements.txt;
`python backend/python/gpu_info.py` shows what the server's PyTorch can see.

For an offline machine, copy this whole folder across (and install the pip
packages from a wheelhouse: `pip download -r requirements.txt -d wheels` on the
connected machine, `pip install --no-index --find-links wheels -r
requirements.txt` on the offline one). `TRANSLATION_MODELS_DIR` points the API
somewhere else if the models live outside the project.
