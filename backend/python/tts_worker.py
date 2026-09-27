"""Text to Speech with Supertonic (Supertone, ONNX), for Tools > AI > Text to Speech.

A long-running worker, started by backend/src/helpers/textToSpeech.js: the four
ONNX models take a few seconds to load and a sentence then takes a fraction of
one, so they stay loaded between requests. The model folder is what
download_models.py supertonic-3 fetches: onnx/ (duration_predictor,
text_encoder, vector_estimator, vocoder, tts.json, unicode_indexer.json) and
voice_styles/<voice>.json.

Protocol, one JSON object per line:
  in  {"id": "...", "model": "<folder>", "text": "...", "language": "en", "voice": "F1",
       "voiceFile": "<path of a trained voice.json>" | null,
       "speed": 1.05, "steps": 8, "out": "<path of the WAV to write>"}
  out {"id": "...", "progress": true, "done": 2, "total": 5}   after each piece of the text
      {"id": "...", "ok": true, "seconds": 12.4, "took": 1.3, "sampleRate": 44100, "pieces": 5,
       "dropped": ""}
      {"id": "...", "ok": false, "error": "..."}
The first line out is {"ready": true, ...} or {"fatal": "..."}.

Long text is read a piece at a time \u2014 paragraphs, split at sentences, at most
300 characters (120 in Korean, Japanese and Chinese) \u2014 with a short pause
between pieces and a longer one between paragraphs. "dropped" lists the
characters the model has no sound for, which are left out.

The inference follows Supertone's reference code (github.com/supertone-inc/
supertonic, py/helper.py, MIT): the duration predictor sets the length, the
text encoder reads the text, the vector estimator turns noise into speech in
"steps" flow-matching steps (more is cleaner and slower), and the vocoder
makes the waveform. "speed" divides the predicted duration.
"""
import json
import os
import re
import sys
import time
import unicodedata
import wave

# Replies go to a private copy of standard output, set up by main(); anything
# else printed goes to standard error. Not done on import: tts_train_voice.py
# imports this module and reports its progress on standard output.
REPLY = None

MAX_LOADED = 1
PIECE_PAUSE = 0.3
PARAGRAPH_PAUSE = 0.6
SHORT_PIECES = {"ko", "ja", "zh"}
# The languages Supertonic 3 reads: its reference code's list (not Chinese).
LANGUAGES = ["en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et", "fi", "fr", "hi", "hr", "hu",
             "id", "it", "lt", "lv", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "tr", "uk", "vi"]
CJK_END = re.compile("[\u3000-\u30ff\u4e00-\u9fff\uff00-\uffef]$")

EMOJI = re.compile(
    "[\U0001f600-\U0001f64f\U0001f300-\U0001f5ff\U0001f680-\U0001f6ff\U0001f700-\U0001f77f"
    "\U0001f780-\U0001f7ff\U0001f800-\U0001f8ff\U0001f900-\U0001f9ff\U0001fa00-\U0001fa6f"
    "\U0001fa70-\U0001faff\u2600-\u26ff\u2700-\u27bf\U0001f1e6-\U0001f1ff]+")
REPLACE = {
    "\u2013": "-", "\u2011": "-", "\u2014": "-", "_": " ", "\u201c": '"', "\u201d": '"',
    "\u2018": "'", "\u2019": "'", "\u00b4": "'", "`": "'", "[": " ", "]": " ", "|": " ",
    "/": " ", "#": " ", "\u2192": " ", "\u2190": " ",
}
ENDS = "[.!?;:,'\")\\]}\u2026\u3002\u300d\u300f\u3011\u3009\u300b\u203a\u00bb\uff01\uff1f]$"
# A sentence ends at . ! ? (and their full-width forms), not after a title or
# an initial: "Dr. Kim" and "J. Smith" stay in one piece.
SENTENCE = re.compile(r"(?<!\bMr\.)(?<!\bMrs\.)(?<!\bMs\.)(?<!\bDr\.)(?<!\bProf\.)(?<!\bSt\.)(?<!\bvs\.)"
                      r"(?<!\betc\.)(?<!\be\.g\.)(?<!\bi\.e\.)(?<!\b[A-Z]\.)"
                      r"(?:(?<=[.!?])\s+|(?<=[\u3002\uff01\uff1f])\s*)")


def reply(message):
    REPLY.write(json.dumps(message, ensure_ascii=False) + "\n")
    REPLY.flush()


def pieces(text, max_len):
    """The text as [(piece, ends a paragraph)], each piece at most max_len characters."""
    out = []
    for paragraph in (p.strip() for p in re.split(r"\n\s*\n+", text.strip())):
        if not paragraph:
            continue
        paragraph = re.sub(r"\s+", " ", paragraph)
        current = ""
        parts = []
        for sentence in SENTENCE.split(paragraph):
            for part in split_long(sentence.strip(), max_len):
                if current and len(current) + 1 + len(part) > max_len:
                    parts.append(current)
                    current = part
                else:
                    # Chinese and Japanese sentences follow one another without a space.
                    space = "" if CJK_END.search(current) else " "
                    current = f"{current}{space}{part}" if current else part
        if current:
            parts.append(current)
        out.extend((part, index == len(parts) - 1) for index, part in enumerate(parts))
    return out


def split_long(sentence, max_len):
    """A sentence longer than max_len, split after commas, then before spaces, then anywhere.

    Each part keeps the space before it, so joining parts back needs no
    separator \u2014 which is also right for Chinese and Japanese, written without spaces.
    """
    if len(sentence) <= max_len:
        return [sentence] if sentence else []
    for pattern in (r"(?<=[,;:\u3001\uff0c\uff1b])", r"(?=\s)"):
        parts = [part for part in re.split(pattern, sentence) if part.strip()]
        if len(parts) > 1:
            packed, current = [], ""
            for part in parts:
                if current and len(current) + len(part) > max_len:
                    packed.append(current.strip())
                    current = part
                else:
                    current += part
            packed.append(current.strip())
            return [piece for part in packed for piece in split_long(part, max_len)]
    return [sentence[i:i + max_len] for i in range(0, len(sentence), max_len)]


class Voice:
    def __init__(self, path, np):
        with open(path, encoding="utf-8") as handle:
            style = json.load(handle)
        self.ttl = np.array(style["style_ttl"]["data"], dtype=np.float32).reshape(1, *style["style_ttl"]["dims"][1:])
        self.dp = np.array(style["style_dp"]["data"], dtype=np.float32).reshape(1, *style["style_dp"]["dims"][1:])


class Supertonic:
    def __init__(self, folder, ort, np):
        onnx = os.path.join(folder, "onnx")
        if not os.path.isfile(os.path.join(onnx, "vector_estimator.onnx")):
            raise ValueError(f"{folder} is not a Supertonic model folder (onnx/vector_estimator.onnx is missing)")
        self.np = np
        self.folder = folder
        with open(os.path.join(onnx, "tts.json"), encoding="utf-8") as handle:
            config = json.load(handle)
        with open(os.path.join(onnx, "unicode_indexer.json"), encoding="utf-8") as handle:
            self.indexer = json.load(handle)
        self.sample_rate = config["ae"]["sample_rate"]
        self.chunk = config["ae"]["base_chunk_size"] * config["ttl"]["chunk_compress_factor"]
        self.latent_dim = config["ttl"]["latent_dim"] * config["ttl"]["chunk_compress_factor"]
        options = ort.SessionOptions()
        threads = int(os.environ.get("TTS_THREADS") or 0)
        if threads > 0:
            options.intra_op_num_threads = threads
        session = lambda name: ort.InferenceSession(os.path.join(onnx, f"{name}.onnx"), sess_options=options,
                                                    providers=["CPUExecutionProvider"])
        self.duration = session("duration_predictor")
        self.encoder = session("text_encoder")
        self.estimator = session("vector_estimator")
        self.vocoder = session("vocoder")
        self.voices = {}

    def voice(self, name):
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", name or ""):
            raise ValueError("unknown voice")
        if name not in self.voices:
            path = os.path.join(self.folder, "voice_styles", f"{name}.json")
            if not os.path.isfile(path):
                raise ValueError(f"the voice {name} is not in this model")
            self.voices[name] = Voice(path, self.np)
        return self.voices[name]

    def voice_file(self, path):
        """A trained voice (tts_train_voice.py writes voice.json), by path."""
        if not os.path.isfile(path):
            raise ValueError("the trained voice file is missing")
        key = os.path.abspath(path)
        if key not in self.voices:
            self.voices[key] = Voice(path, self.np)
        return self.voices[key]

    def prepare(self, text, language, dropped):
        """Supertone's normalisation, then the model's character ids; characters it lacks are dropped."""
        text = unicodedata.normalize("NFKD", text)
        text = EMOJI.sub("", text)
        for old, new in REPLACE.items():
            text = text.replace(old, new)
        text = re.sub(r"[\u2665\u2606\u2661\u00a9\\]", "", text)
        for old, new in {"@": " at ", "e.g.,": "for example, ", "i.e.,": "that is, "}.items():
            text = text.replace(old, new)
        text = re.sub(r" ([,.!?;:'])", r"\1", text)
        text = re.sub(r'"{2,}', '"', text)
        text = re.sub(r"'{2,}", "'", text)
        text = re.sub(r"\s+", " ", text).strip()
        if not re.search(ENDS, text):
            text += "."
        kept = []
        for char in text:
            code = ord(char)
            if code < len(self.indexer) and self.indexer[code] >= 0:
                kept.append(char)
            else:
                dropped.add(unicodedata.normalize("NFC", char))
        tagged = f"<{language}>{''.join(kept)}</{language}>"
        return [self.indexer[ord(char)] for char in tagged]

    def speak(self, ids, voice, steps, speed):
        np = self.np
        text_ids = np.array([ids], dtype=np.int64)
        text_mask = np.ones((1, 1, len(ids)), dtype=np.float32)
        duration = self.duration.run(None, {"text_ids": text_ids, "style_dp": voice.dp, "text_mask": text_mask})[0]
        duration = duration / speed
        text_emb = self.encoder.run(None, {"text_ids": text_ids, "style_ttl": voice.ttl, "text_mask": text_mask})[0]
        samples = int(float(duration[0]) * self.sample_rate)
        latent_len = max(1, (samples + self.chunk - 1) // self.chunk)
        latent = np.random.randn(1, self.latent_dim, latent_len).astype(np.float32)
        latent_mask = np.ones((1, 1, latent_len), dtype=np.float32)
        total = np.array([steps], dtype=np.float32)
        for step in range(steps):
            latent = self.estimator.run(None, {
                "noisy_latent": latent, "text_emb": text_emb, "style_ttl": voice.ttl, "text_mask": text_mask,
                "latent_mask": latent_mask, "current_step": np.array([step], dtype=np.float32), "total_step": total,
            })[0]
        audio = self.vocoder.run(None, {"latent": latent})[0][0]
        return audio[:samples]


def write_wav(path, audio, rate, np):
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(path, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(pcm.tobytes())


def main():
    global REPLY
    REPLY = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1)
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    try:
        import numpy as np
        import onnxruntime as ort
    except ImportError as error:
        reply({"fatal": f"Text to Speech needs onnxruntime for {sys.executable} ({error}). "
                        "Run: pip install onnxruntime numpy"})
        return
    ort.set_default_logger_severity(3)
    reply({"ready": True, "python": sys.version.split()[0], "onnxruntime": ort.__version__})

    loaded = {}

    def model_for(folder):
        if folder not in loaded:
            loaded.clear()
            loaded[folder] = Supertonic(folder, ort, np)
        return loaded[folder]

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            started = time.time()
            language = str(request.get("language") or "en")
            if not re.fullmatch(r"[a-z]{2}", language):
                raise ValueError("unknown language")
            steps = max(1, min(int(request.get("steps") or 8), 32))
            speed = max(0.5, min(float(request.get("speed") or 1.05), 2.0))
            model = model_for(request["model"])
            voice = model.voice_file(request["voiceFile"]) if request.get("voiceFile")                 else model.voice(str(request.get("voice") or "F1"))
            dropped = set()
            parts = pieces(str(request.get("text") or ""), 120 if language in SHORT_PIECES else 300)
            if not parts:
                raise ValueError("there is no text to read")
            audio = []
            for index, (part, paragraph_end) in enumerate(parts):
                audio.append(model.speak(model.prepare(part, language, dropped), voice, steps, speed))
                if index < len(parts) - 1:
                    pause = PARAGRAPH_PAUSE if paragraph_end else PIECE_PAUSE
                    audio.append(np.zeros(int(pause * model.sample_rate), dtype=np.float32))
                reply({"id": request_id, "progress": True, "done": index + 1, "total": len(parts)})
            audio = np.concatenate(audio)
            write_wav(request["out"], audio, model.sample_rate, np)
            reply({
                "id": request_id, "ok": True, "seconds": round(audio.size / model.sample_rate, 2),
                "took": round(time.time() - started, 2), "sampleRate": model.sample_rate, "pieces": len(parts),
                "dropped": "".join(sorted(char for char in dropped if not char.isspace()))[:40],
            })
        except Exception as error:  # noqa: BLE001  (one bad request must not end the worker)
            reply({"id": request_id, "ok": False, "error": str(error) or error.__class__.__name__})


if __name__ == "__main__":
    main()
