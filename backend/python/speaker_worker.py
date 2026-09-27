"""Speaker recognition with ECAPA-TDNN (SpeechBrain), for Tools > AI > Speaker recognition.

A long-running worker, started by backend/src/helpers/speakerRecognition.js.
It only turns speech into a voiceprint: a 192-number embedding. Comparing
voiceprints, and keeping them, is done by the server.

Protocol, one JSON object per line:
  in  {"id": "...", "model": "<folder of spkrec-ecapa-voxceleb>", "audio": "<path to WAV>"}
  out {"id": "...", "ok": true, "embedding": [192 floats], "seconds": 6.1, "speechSeconds": 4.8}
      {"id": "...", "ok": false, "error": "..."}
The first line out is {"ready": true, ...} or {"fatal": "..."}.

The model is built offline by speaker_common.load_ecapa.
"""
import json
import os
import sys
import time

REPLY = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1)
os.dup2(2, 1)
sys.stdout = sys.stderr

from speaker_common import SAMPLE_RATE, load_ecapa, read_wav, speech_only  # noqa: E402  (after the redirect)


def reply(message):
    REPLY.write(json.dumps(message) + "\n")
    REPLY.flush()


def main():
    try:
        import numpy as np  # noqa: F401
        import torch
        import hyperpyyaml  # noqa: F401
    except ImportError as error:
        reply({"fatal": f"Speaker recognition needs SpeechBrain for {sys.executable} ({error}). "
                        "Run: pip install speechbrain"})
        return

    torch.set_num_threads(max(1, min(os.cpu_count() or 4, 8)))
    loaded = {}

    def model_for(folder):
        if folder not in loaded:
            # Two at a time: enough to compare a fine-tuned model with its base.
            while len(loaded) >= 2:
                loaded.pop(next(iter(loaded)))
            loaded[folder] = load_ecapa(folder)
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
