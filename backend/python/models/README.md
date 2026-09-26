# Translation models

Everything under this folder is read by `backend/python` and never downloaded
at run time: training, translation and ONNX export all run with Hugging Face's
offline mode on.

```
base/<name>/        Opus-MT models fetched by download_models.py
finetuned/<id>/     models trained from the Transformers page
onnx/<id>/          ONNX exports, and <id>.zip for download
```

The weights are too large for git and are ignored. To install them, on a
machine with internet access:

```
pip install -r backend/python/requirements.txt
python backend/python/download_models.py en-es en-zh m2m100
python backend/python/download_models.py --list
```

Opus-MT models (`en-es`, `en-zh`, …) are small (about 300 MB) and made for one
direction each. `m2m100` is facebook/m2m100_418M (MIT licence, about 1.9 GB):
one model for any direction between 100 languages. It is what covers en→ko,
because Helsinki-NLP's only English→Korean model (`opus-mt-tc-big-en-ko`) is
broken on Hugging Face and translates into nonsense. Fine-tuning M2M100 on a
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

For an offline machine, copy this whole folder across (and install the pip
packages from a wheelhouse: `pip download -r requirements.txt -d wheels` on the
connected machine, `pip install --no-index --find-links wheels -r
requirements.txt` on the offline one). `TRANSLATION_MODELS_DIR` points the API
somewhere else if the models live outside the project.
