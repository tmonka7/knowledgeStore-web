"""Export an ECAPA-TDNN speaker model to ONNX, check it, and zip it for download.

    python speaker_export.py --model models/base/spkrec-ecapa-voxceleb --output models/onnx/<id>.partial \
        [--sample clip.wav]

The whole pipeline goes into one graph when the installed PyTorch can export
it (its newer, torch.export-based exporter handles the STFT inside the
filterbank): 16 kHz audio in, 192-number voiceprint out. The older exporter
cannot, so without it the graph starts from the 80 log-mel filterbank
features, and the README says how to compute them.

The export is run next to PyTorch on --sample (a speaker's voice sample) or,
without one, on a synthetic clip, and the two voiceprints compared.
"""
import argparse
import contextlib
import importlib.util
import io
import os
import shutil

from ks_common import check_model, emit, fail, go_offline, read_meta
from speaker_common import SAMPLE_RATE, load_ecapa, read_wav, speech_only

go_offline()

OPSET = 18
EMBEDDING_SIZE = 192

README = """{name} — ECAPA-TDNN speaker model, ONNX export

Architecture: ECAPA-TDNN   Voiceprint: {size} numbers   Exported with: {method}

Files
  {file}   {io}

What the app does around it
  1. Audio: 16 kHz, mono, float32 in -1..1. Clips of 1 to 20 s work best;
     under 0.5 s of speech is too little.
  2. Silence is cut out first: 30 ms frames count as speech when their RMS is
     within 30 dB of the loudest frame (and above 0.001); gaps of up to 0.3 s
     between speech frames are kept. This makes pauses not matter.
  3. The voiceprint is compared by cosine similarity. A speaker's reference is
     the mean of their samples' unit-length voiceprints (made unit length
     again). The app counts a score of {threshold} or more as a match; tune it
     for your microphones.
{features}
Python (onnxruntime and numpy):
  import numpy as np, onnxruntime as ort
  session = ort.InferenceSession("{file}")
  def voiceprint(audio):              # float32 numpy array, 16 kHz mono
{call}
      return vector / np.linalg.norm(vector)
  score = float(voiceprint(a) @ voiceprint(b))   # -1..1, same speaker is high

The graph takes one clip at a time (batch size 1), from half a second to
several minutes long.
"""

FEATURES = """
  The graph starts from features, because this server's PyTorch could not
  export the filterbank. Compute them as SpeechBrain's Fbank does:
  n_fft 400, hop 160 (10 ms), Hamming window 25 ms, centred frames with
  constant padding; power spectrum -> 80 triangular mel filters from 0 to
  8000 Hz -> 10*log10(max(x, 1e-10)), then clip at 80 dB below the maximum.
  With PyTorch and SpeechBrain at hand:
    from speechbrain.lobes.features import Fbank
    fbank = Fbank(n_mels=80)(torch.from_numpy(audio)[None]).numpy()   # [1, frames, 80]
  (mean normalisation per clip is inside the graph).
"""


def build_pipeline(folder):
    import torch

    features, normalize, embedding = load_ecapa(folder)

    class Voiceprint(torch.nn.Module):
        """wav [1, samples] -> [1, 192], exactly what speaker_worker.py computes."""

        def __init__(self):
            super().__init__()
            self.features, self.normalize, self.embedding = features, normalize, embedding

        def forward(self, wav):
            lengths = torch.ones(wav.shape[0])
            return self.embedding(self.normalize(self.features(wav), lengths), lengths).squeeze(1)

    class FromFeatures(torch.nn.Module):
        """fbank [1, frames, 80] -> [1, 192]."""

        def __init__(self):
            super().__init__()
            self.normalize, self.embedding = normalize, embedding

        def forward(self, fbank):
            lengths = torch.ones(fbank.shape[0])
            return self.embedding(self.normalize(fbank, lengths), lengths).squeeze(1)

    return features, Voiceprint().eval(), FromFeatures().eval()


def quietly(work):
    """Run `work()` with the exporter's chatter (and its emoji, which some
    Windows consoles cannot encode) kept out of the job's log."""
    sink = io.StringIO()
    with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        return work()


def export_full(pipeline, path):
    import torch

    example = torch.randn(1, 3 * SAMPLE_RATE) * 0.1
    samples = torch.export.Dim("samples", min=SAMPLE_RATE // 4, max=SAMPLE_RATE * 600)
    quietly(lambda: torch.onnx.export(
        pipeline, (example,), path, input_names=["wav"], output_names=["embedding"], opset_version=OPSET,
        dynamo=True, dynamic_shapes={"wav": {1: samples}}, external_data=False))


def export_features(pipeline, features, path):
    import torch

    example = features(torch.randn(1, 3 * SAMPLE_RATE) * 0.1)
    quietly(lambda: torch.onnx.export(
        pipeline, (example,), path, input_names=["fbank"], output_names=["embedding"], opset_version=17,
        dynamo=False, dynamic_axes={"fbank": {1: "frames"}}))


def single_file(path):
    """One .onnx with the weights inside (an exporter may put them beside it)."""
    import onnx

    data = f"{path}.data"
    model = onnx.load(path)
    onnx.save(model, path, save_as_external_data=False)
    if os.path.exists(data):
        os.remove(data)


def label(path, meta, method, takes):
    """Metadata an ONNX user can read without the README."""
    import onnx

    model = onnx.load(path)
    for key, value in {
        "name": meta.get("name", ""),
        "architecture": "ECAPA-TDNN",
        "sample_rate": str(SAMPLE_RATE),
        "embedding_size": str(EMBEDDING_SIZE),
        "input": takes,
        "exported_with": method,
        "licence": meta.get("licence", ""),
    }.items():
        entry = model.metadata_props.add()
        entry.key, entry.value = key, value
    onnx.save(model, path)


def check(pipeline, features, path, takes, sample):
    """Voiceprints of one clip from PyTorch and from the ONNX graph."""
    import numpy as np
    import torch

    if importlib.util.find_spec("onnxruntime") is None:
        return {"verified": False, "reason": "onnxruntime is not installed, so the export was not test-run."}
    import onnxruntime as ort

    source = "a synthetic clip"
    audio = None
    if sample and os.path.exists(sample):
        try:
            voiced, _ = speech_only(read_wav(sample))
            if voiced.size >= SAMPLE_RATE // 2:
                audio, source = voiced, f"a voice sample ({voiced.size / SAMPLE_RATE:.1f} s of speech)"
        except ValueError:
            pass
    if audio is None:
        # Harmonics with a wobbling pitch: speech-like enough to exercise every layer.
        t = np.arange(3 * SAMPLE_RATE) / SAMPLE_RATE
        pitch = 140 + 30 * np.sin(2 * np.pi * 2 * t)
        phase = 2 * np.pi * np.cumsum(pitch) / SAMPLE_RATE
        audio = (sum(np.sin(k * phase) / k for k in range(1, 12)) * 0.1).astype(np.float32)

    wav = torch.from_numpy(np.ascontiguousarray(audio, dtype=np.float32))[None]
    with torch.no_grad():
        reference = pipeline(wav).numpy()[0]
        feed = wav.numpy() if takes == "wav" else features(wav).numpy()
    session = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    exported = session.run(None, {takes: feed})[0][0]
    cosine = float(reference @ exported / (np.linalg.norm(reference) * np.linalg.norm(exported)))
    return {
        "verified": True,
        "input": source,
        "pytorch": f"voiceprint of {EMBEDDING_SIZE}",
        "onnx": f"cosine {cosine:.6f} to PyTorch's",
        "maxDifference": float(np.abs(reference - exported).max()),
        "match": cosine > 0.9999,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--sample")
    args = parser.parse_args()

    check_model(args.model)
    meta = read_meta(args.model)
    if importlib.util.find_spec("onnx") is None:
        fail("The onnx package is not installed. Run: pip install -r backend/python/requirements.txt")
    try:
        import torch  # noqa: F401
        import hyperpyyaml  # noqa: F401
    except ImportError as error:
        fail(f"{error.name or error} is not installed. Run: pip install -r backend/python/requirements.txt")

    if os.path.exists(args.output):
        shutil.rmtree(args.output)
    os.makedirs(args.output)

    emit("status", message="Loading the model")
    features, pipeline, from_features = build_pipeline(args.model)

    path = os.path.join(args.output, "ecapa.onnx")
    emit("status", message="Exporting audio to voiceprint", method="torch.export")
    try:
        export_full(pipeline, path)
        method, takes = "torch.onnx (torch.export)", "wav"
    except Exception as error:  # noqa: BLE001 — the features graph still works
        emit("status", message=f"The filterbank could not be exported ({str(error).splitlines()[0][:200]}); "
                               "exporting from features instead", method="torch.onnx")
        for leftover in (path, f"{path}.data"):
            if os.path.exists(leftover):
                os.remove(leftover)
        path = os.path.join(args.output, "ecapa_fbank.onnx")
        try:
            export_features(from_features, features, path)
        except Exception as inner:  # noqa: BLE001 — reported to the page
            fail(f"ONNX export failed: {inner}")
        method, takes = "torch.onnx (TorchScript)", "fbank"
    single_file(path)
    label(path, meta, method, takes)

    emit("status", message="Checking the exported model")
    try:
        result = check(pipeline, features, path, takes, args.sample)
    except Exception as error:  # noqa: BLE001
        result = {"verified": False, "reason": f"The check could not run: {error}"}

    name = os.path.basename(path)
    if takes == "wav":
        io_line = f'input "wav" float32 [1, samples] -> output "embedding" float32 [1, {EMBEDDING_SIZE}]'
        call = '      vector = session.run(None, {"wav": audio[None]})[0][0]'
    else:
        io_line = f'input "fbank" float32 [1, frames, 80] -> output "embedding" float32 [1, {EMBEDDING_SIZE}]'
        call = '      vector = session.run(None, {"fbank": fbank_of(audio)})[0][0]   # see above'
    with open(os.path.join(args.output, "README.txt"), "w", encoding="utf-8") as handle:
        handle.write(README.format(
            name=meta.get("name", os.path.basename(args.model)), size=EMBEDDING_SIZE, method=method,
            file=name, io=io_line, threshold="0.35", features=FEATURES if takes == "fbank" else "", call=call))

    emit("status", message="Creating the zip")
    archive = shutil.make_archive(args.output, "zip", args.output)
    emit("done", method=method, input=takes, files=sorted(os.listdir(args.output)),
         archive=os.path.basename(archive), bytes=os.path.getsize(archive), check=result)


if __name__ == "__main__":
    main()
