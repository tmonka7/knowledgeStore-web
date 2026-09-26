"""Audio and Whisper helpers shared by the speech scripts."""
import json
import os
import wave

from ks_common import LANGUAGE_ALIASES, fail

SAMPLE_RATE = 16000  # What Whisper was trained on, and what the STT page records.
MAX_SECONDS = 30  # Whisper sees 30 s windows; longer clips are cut off, not learned.

# Languages written without spaces: word error rate is meaningless there, so
# they are scored per character instead.
CHARACTER_SCORED = {"zh", "ja", "ko", "th", "lo", "my", "km", "yue"}


def read_wav(path):
    """A WAV file as mono float32 samples at 16 kHz.

    The STT page only accepts 16 kHz mono PCM, so resampling is the exception;
    it is done by linear interpolation, which is enough for speech.
    """
    import numpy as np

    try:
        with wave.open(path, "rb") as handle:
            channels = handle.getnchannels()
            width = handle.getsampwidth()
            rate = handle.getframerate()
            frames = handle.readframes(handle.getnframes())
    except (wave.Error, EOFError) as error:
        fail(f"{os.path.basename(path)} is not a PCM WAV file ({error}).")

    if width == 1:
        audio = (np.frombuffer(frames, dtype=np.uint8).astype(np.float32) - 128) / 128
    elif width == 2:
        audio = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768
    elif width == 3:
        raw = np.frombuffer(frames, dtype=np.uint8).reshape(-1, 3)
        audio = (raw[:, 0].astype(np.int32) | (raw[:, 1].astype(np.int32) << 8)
                 | (raw[:, 2].astype(np.int8).astype(np.int32) << 16)).astype(np.float32) / 8388608
    elif width == 4:
        audio = np.frombuffer(frames, dtype="<i4").astype(np.float32) / 2147483648
    else:
        fail(f"{os.path.basename(path)} has an unsupported sample width ({width} bytes).")

    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    if rate != SAMPLE_RATE and len(audio):
        positions = np.linspace(0, len(audio) - 1, int(round(len(audio) * SAMPLE_RATE / rate)))
        audio = np.interp(positions, np.arange(len(audio)), audio).astype(np.float32)
    return audio


def whisper_language(code):
    """A dataset language code ("ko", "zh-Hans", "jp") as Whisper's ("ko")."""
    primary = str(code or "").split("-")[0].split("_")[0].lower()
    return LANGUAGE_ALIASES.get(primary, primary) or None


def load_clips(data):
    """[(audio path, transcript)] from an uploaded speech dataset folder."""
    path = os.path.join(data, "metadata.jsonl")
    if not os.path.exists(path):
        fail("The dataset has not been uploaded completely. Save it to the server again from the Speech to Text page.")
    clips = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            audio = os.path.join(data, row["audio"])
            if row.get("text", "").strip() and os.path.exists(audio):
                clips.append((audio, row["text"].strip()))
    return clips


def error_rate(references, hypotheses, language):
    """Word error rate, or character error rate for languages without spaces."""
    by_character = whisper_language(language) in CHARACTER_SCORED
    errors = total = 0
    for reference, hypothesis in zip(references, hypotheses):
        ref = list(reference.replace(" ", "")) if by_character else reference.lower().split()
        hyp = list(hypothesis.replace(" ", "")) if by_character else hypothesis.lower().split()
        previous = list(range(len(hyp) + 1))
        for i, ref_token in enumerate(ref, 1):
            current = [i] + [0] * len(hyp)
            for j, hyp_token in enumerate(hyp, 1):
                current[j] = min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ref_token != hyp_token))
            previous = current
        errors += previous[-1]
        total += len(ref)
    return round(errors / total, 4) if total else None, "CER" if by_character else "WER"


def prepare_whisper(processor, model, language):
    """Set the language and task on a Whisper model; returns generate() arguments.

    Old checkpoints carry forced_decoder_ids that newer transformers refuse to
    combine with language/task, so those are cleared. The language goes into
    the generation config too, so a fine-tuned model saved afterwards
    transcribes in that language without being told.
    """
    language = whisper_language(language)
    config = model.generation_config
    config.forced_decoder_ids = None
    if language:
        config.language = language
    config.task = "transcribe"
    if language:
        processor.tokenizer.set_prefix_tokens(language=language, task="transcribe")
    return {"language": language, "task": "transcribe"} if language else {"task": "transcribe"}
