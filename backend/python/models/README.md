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
python backend/python/download_models.py en-es es-en
python backend/python/download_models.py --list
```

Opus-MT names a few languages differently from the codes a dataset uses; map
them explicitly, e.g. `en-ja=Helsinki-NLP/opus-mt-en-jap`.

For an offline machine, copy this whole folder across (and install the pip
packages from a wheelhouse: `pip download -r requirements.txt -d wheels` on the
connected machine, `pip install --no-index --find-links wheels -r
requirements.txt` on the offline one). `TRANSLATION_MODELS_DIR` points the API
somewhere else if the models live outside the project.
