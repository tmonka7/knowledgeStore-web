"""Voice recognition with whisper.cpp (ggml models), for the Speech to Text page.

A long-running worker, started by backend/src/helpers/whisperCpp.js: loading
a model takes a moment, a short phrase then takes a fraction of one, so the
models stay loaded between requests instead of loading per request.

Protocol, one JSON object per line:
  in  {"id": "...", "model": "<path to ggml-*.bin>", "audio": "<path to WAV>",
       "language": "auto" | "en" | ..., "translate": false, "prompt": ""}
  out {"id": "...", "ok": true, "text": "...", "segments": [{"start", "end", "text"}],
       "language": "en", "audioSeconds": 3.2, "seconds": 0.4}
      {"id": "...", "ok": false, "error": "..."}
The first line out is {"ready": true, ...} or {"fatal": "..."}.

whisper.cpp prints its logs from C. Standard output is moved to standard
error before anything loads, and replies go to a private copy of the real
standard output, so no log line can ever be mistaken for a reply.
"""
import json
import os
import sys
import time
import wave

REPLY = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1)
os.dup2(2, 1)
sys.stdout = sys.stderr

MAX_LOADED = 2
SAMPLE_RATE = 16000


def reply(message):
    REPLY.write(json.dumps(message, ensure_ascii=False) + "\n")
    REPLY.flush()


def read_wav(path):
    """A PCM WAV file as mono float32 at 16 kHz (the page already sends exactly that)."""
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
    elif width == 1:
        audio = (np.frombuffer(frames, dtype=np.uint8).astype(np.float32) - 128) / 128
    else:
        raise ValueError(f"{width * 8}-bit WAV is not supported; send 16-bit PCM")
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    if rate != SAMPLE_RATE and audio.size:
        # Linear interpolation: enough for speech, and the page resamples anyway.
        length = int(round(audio.size * SAMPLE_RATE / rate))
        audio = np.interp(np.linspace(0, audio.size - 1, length), np.arange(audio.size), audio).astype(np.float32)
    return np.ascontiguousarray(audio, dtype=np.float32)


def main():
    try:
        import numpy as np  # noqa: F401  (pywhispercpp needs it; say so if it is missing)
        import _pywhispercpp as pw
        from pywhispercpp.model import Model
    except ImportError as error:
        reply({"fatal": f"whisper.cpp is not installed for {sys.executable} ({error}). "
                        "Run: pip install pywhispercpp"})
        return

    threads = max(1, min(int(os.environ.get("WHISPER_CPP_THREADS") or 0) or (os.cpu_count() or 4), 16))
    loaded = {}  # path -> Model, most recently used last

    def model_for(path):
        if path in loaded:
            loaded[path] = loaded.pop(path)
            return loaded[path]
        if not os.path.isfile(path):
            raise ValueError(f"model file not found: {path}")
        while len(loaded) >= MAX_LOADED:
            loaded.pop(next(iter(loaded)))
        loaded[path] = Model(
            path,
            redirect_whispercpp_logs_to=None,
            n_threads=threads,
            print_progress=False,
            print_realtime=False,
            print_timestamps=False,
        )
        return loaded[path]

    reply({"ready": True, "threads": threads, "python": sys.version.split()[0]})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            started = time.time()
            audio = read_wav(request["audio"])
            if audio.size < SAMPLE_RATE // 10:
                reply({"id": request_id, "ok": True, "text": "", "segments": [], "language": None,
                       "audioSeconds": audio.size / SAMPLE_RATE, "seconds": 0})
                continue
            model = model_for(request["model"])
            language = str(request.get("language") or "auto")
            segments = model.transcribe(
                audio,
                language=language,
                translate=bool(request.get("translate")),
                initial_prompt=str(request.get("prompt") or "")[-400:],
                # Each request stands alone; context carries over only via the prompt.
                no_context=True,
            )
            try:
                detected = pw.whisper_lang_str(pw.whisper_full_lang_id(model._ctx))
            except Exception:  # noqa: BLE001  (older bindings: just leave it out)
                detected = None
            parts = [{"start": segment.t0 / 100, "end": segment.t1 / 100, "text": segment.text.strip()}
                     for segment in segments]
            parts = [part for part in parts if part["text"]]
            reply({
                "id": request_id,
                "ok": True,
                "text": " ".join(part["text"] for part in parts).strip(),
                "segments": parts,
                "language": detected if language == "auto" else language,
                "audioSeconds": round(audio.size / SAMPLE_RATE, 2),
                "seconds": round(time.time() - started, 2),
            })
        except Exception as error:  # noqa: BLE001  (one bad request must not end the worker)
            reply({"id": request_id, "ok": False, "error": str(error) or error.__class__.__name__})


if __name__ == "__main__":
    main()
