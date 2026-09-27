"""Speaker recognition with ECAPA-TDNN (SpeechBrain), for Tools > AI > Speaker recognition.

A long-running worker, started by backend/src/helpers/speakerRecognition.js.
It only turns speech into a voiceprint: a 192-number embedding. Comparing
voiceprints, and keeping them, is done by the server.

Protocol, one JSON object per line:
  in  {"id": "...", "model": "<folder of spkrec-ecapa-voxceleb>", "audio": "<path to WAV>"}
  out {"id": "...", "ok": true, "embedding": [192 floats], "seconds": 6.1, "speechSeconds": 4.8}
      {"id": "...", "ok": false, "error": "..."}
The first line out is {"ready": true, ...} or {"fatal": "..."}.

The model is built from its hyperparams.yaml and embedding_model.ckpt
directly. SpeechBrain's own loader (EncoderClassifier.from_hparams) asks the
Hugging Face Hub for the files even when given a local folder, so it fails
offline; this gives the identical embedding (checked: max difference 0.0)
without the network.
"""
import json
import os
import sys
import time
import wave

REPLY = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1)
os.dup2(2, 1)
sys.stdout = sys.stderr

SAMPLE_RATE = 16000
MAX_SECONDS = 120
FRAME = 480  # 30 ms


def reply(message):
    REPLY.write(json.dumps(message) + "\n")
    REPLY.flush()


def read_wav(path):
    """A PCM WAV as mono float32 at 16 kHz (the page sends exactly that)."""
    import numpy as np

    try:
        with wave.open(path, "rb") as handle:
            channels, width, rate = handle.getnchannels(), handle.getsampwidth(), handle.getframerate()
            frames = handle.readframes(handle.getnframes())
    except (wave.Error, EOFError) as error:
        raise ValueError(f"not a PCM WAV file ({str(error) or 'it is cut short'})") from error
    if width == 2:
        audio = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768
    elif width == 4:
        audio = np.frombuffer(frames, dtype="<i4").astype(np.float32) / 2147483648
    else:
        raise ValueError(f"{width * 8}-bit WAV is not supported; send 16-bit PCM")
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    if rate != SAMPLE_RATE and audio.size:
        length = int(round(audio.size * SAMPLE_RATE / rate))
        audio = np.interp(np.linspace(0, audio.size - 1, length), np.arange(audio.size), audio).astype(np.float32)
    return audio[: MAX_SECONDS * SAMPLE_RATE]


def speech_only(audio):
    """The clip without its silent stretches, and how much speech that left.

    A voiceprint of a clip that is half silence is half a voiceprint of the
    room. 30 ms frames count as speech when they are within 30 dB of the
    loudest part; gaps shorter than 0.3 s are kept so words are not chopped.
    """
    import numpy as np

    frames = audio.size // FRAME
    if frames == 0:
        return audio, 0.0
    energy = np.sqrt((audio[: frames * FRAME].reshape(frames, FRAME) ** 2).mean(axis=1) + 1e-12)
    loud = energy > max(energy.max() * 10 ** (-30 / 20), 1e-3)
    keep = loud.copy()
    bridge = int(0.3 * SAMPLE_RATE / FRAME)
    last = None
    for index in np.flatnonzero(loud):
        if last is not None and 1 < index - last <= bridge:
            keep[last:index] = True
        last = index
    if not keep.any():
        return audio[:0], 0.0
    voiced = audio[: frames * FRAME].reshape(frames, FRAME)[keep].reshape(-1)
    return voiced, float(loud.sum() * FRAME / SAMPLE_RATE)


def main():
    try:
        import numpy as np  # noqa: F401
        import torch
        from hyperpyyaml import load_hyperpyyaml
    except ImportError as error:
        reply({"fatal": f"Speaker recognition needs SpeechBrain for {sys.executable} ({error}). "
                        "Run: pip install speechbrain"})
        return

    torch.set_num_threads(max(1, min(os.cpu_count() or 4, 8)))
    loaded = {}

    def model_for(folder):
        if folder in loaded:
            return loaded[folder]
        with open(os.path.join(folder, "hyperparams.yaml"), encoding="utf-8") as handle:
            # pretrained_path pointed at the local folder: nothing is fetched.
            hparams = load_hyperpyyaml(handle, overrides={"pretrained_path": folder.replace("\\", "/")})
        embedding = hparams["embedding_model"]
        embedding.load_state_dict(torch.load(os.path.join(folder, "embedding_model.ckpt"), map_location="cpu"))
        embedding.eval()
        loaded.clear()  # One speaker model at a time is plenty.
        loaded[folder] = (hparams["compute_features"], hparams["mean_var_norm"], embedding)
        return loaded[folder]

    reply({"ready": True, "python": sys.version.split()[0], "torch": torch.__version__})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            if not request.get("model") or not request.get("audio"):
                raise ValueError("the request needs both a model folder and an audio file")
            started = time.time()
            audio = read_wav(request["audio"])
            voiced, speech_seconds = speech_only(audio)
            if voiced.size < SAMPLE_RATE // 2:
                raise ValueError("there is too little speech in this clip (under half a second)")
            features, normalize, embedding = model_for(request["model"])
            with torch.no_grad():
                signal = torch.from_numpy(voiced.copy())[None]
                lengths = torch.ones(1)
                vector = embedding(normalize(features(signal), lengths), lengths).squeeze()
            reply({
                "id": request_id,
                "ok": True,
                "embedding": [round(float(value), 6) for value in vector],
                "seconds": round(audio.size / SAMPLE_RATE, 2),
                "speechSeconds": round(speech_seconds, 2),
                "took": round(time.time() - started, 3),
            })
        except Exception as error:  # noqa: BLE001  (one bad request must not end the worker)
            reply({"id": request_id, "ok": False, "error": str(error) or error.__class__.__name__})


if __name__ == "__main__":
    main()
