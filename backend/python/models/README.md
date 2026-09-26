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
