"""Speech to Command: Moonshine transcribes a clip, and the transcript is matched to a command.

A long-running worker, started by backend/src/helpers/speechCommand.js, so the
model stays loaded and a command is recognised in a fraction of a second.

Protocol, one JSON object per line:
  in  {"id", "model": "<Moonshine folder>", "audio": "<WAV path>", "commands": [{id, name, phrases}],
       "threshold": 0.7, "language": "en"}
  out {"id", "ok": true, "text": "...", "command": {"id", "name"} | null, "score", "phrase",
       "alternatives": [{id, name, score}], "seconds", "took"}
      {"id", "ok": false, "error": "..."}
The first line out is {"ready": true, ...} or {"fatal": "..."}.
"""
import json
import os
import sys
import time

REPLY = None


def reply(message):
    REPLY.write(json.dumps(message, ensure_ascii=False) + "\n")
    REPLY.flush()


def main():
    global REPLY
    # Replies go on the real stdout; anything a library prints goes to stderr.
    REPLY = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1)
    os.dup2(2, 1)
    sys.stdout = sys.stderr

    try:
        import torch
        # Imported now, before "ready", rather than with the first model: it
        # takes several seconds, which would otherwise land on the first command.
        import transformers  # noqa: F401
        from transformers import AutoProcessor, MoonshineForConditionalGeneration  # noqa: F401
        from command_common import DEFAULT_THRESHOLD, MAX_SECONDS, SAMPLE_RATE, load_moonshine, match, transcribe
        from ks_common import go_offline, pick_device
        from speech_common import read_wav
    except ImportError as error:
        reply({"fatal": f"Speech to Command needs torch and transformers 4.48 or later for {sys.executable} ({error}). "
                        "Run: pip install -r backend/python/requirements.txt"})
        return

    # The helpers end a script with fail(); here a failure answers one request instead.
    import command_common
    import speech_common

    def raise_error(message, code=1):  # noqa: ARG001
        raise ValueError(message)

    command_common.fail = speech_common.fail = raise_error

    go_offline()
    torch.set_num_threads(max(1, min(os.cpu_count() or 4, 8)))
    device = pick_device(os.environ.get("COMMAND_DEVICE") or "auto")
    loaded = {}

    def model_for(folder):
        if folder not in loaded:
            # Two at a time: enough to compare a fine-tuned model with its base.
            while len(loaded) >= 2:
                loaded.pop(next(iter(loaded)))
            loaded[folder] = load_moonshine(folder, device)
        return loaded[folder]

    reply({"ready": True, "python": sys.version.split()[0], "torch": torch.__version__, "device": device.type})

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
            samples = read_wav(request["audio"])[: MAX_SECONDS * SAMPLE_RATE]
            if len(samples) < SAMPLE_RATE // 10:
                raise ValueError("the recording is too short")
            processor, model = model_for(request["model"])
            text = transcribe(processor, model, [samples], device)[0]
            found = match(text, request.get("commands") or [], float(request.get("threshold") or DEFAULT_THRESHOLD),
                          request.get("language") or "en")
            reply({
                "id": request_id,
                "ok": True,
                "text": text,
                **found,
                "seconds": round(len(samples) / SAMPLE_RATE, 2),
                "took": round(time.time() - started, 3),
            })
        except Exception as error:  # noqa: BLE001  (one bad request must not end the worker)
            reply({"id": request_id, "ok": False, "error": str(error) or error.__class__.__name__})


if __name__ == "__main__":
    main()
