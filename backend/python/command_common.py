"""Helpers shared by the Speech to Command scripts: Moonshine, and matching what was said to a command.

A command set is a list of commands, each with the phrases that say it:
    [{"id": "c1", "name": "Lights on", "phrases": ["turn on the lights", "lights on"]}, ...]
Speech is transcribed by Moonshine, and the transcript is matched to the
closest phrase. The match is by characters, not words, so it forgives the
small slips a speech model makes ("turn on the light" for "... lights") and
works for languages written without spaces.
"""
import json
import math
import os
import re
import unicodedata

from ks_common import fail
from speech_common import SAMPLE_RATE, load_clips  # noqa: F401  (re-exported)

# Moonshine emits about 6.5 tokens per second of speech; a little headroom
# stops a clip being cut short, and a cap stops a hallucination running on.
TOKENS_PER_SECOND = 6.5
MAX_SECONDS = 30
DEFAULT_THRESHOLD = 0.7
# How far the best command must be ahead of the next one to be chosen.
MARGIN = 0.05
# Scripts where a space means little: compared with spaces removed.
NO_SPACES = {"ja", "zh", "ko", "th", "lo", "my", "km"}


def normalise(text, language="en"):
    """Lower case, no punctuation or symbols, single spaces (none for NO_SPACES languages)."""
    text = unicodedata.normalize("NFKC", str(text or "")).lower()
    text = "".join(" " if unicodedata.category(ch)[0] in "PSZC" else ch for ch in text)
    text = re.sub(r"\s+", " ", text).strip()
    if str(language or "").split("-")[0].lower() in NO_SPACES:
        text = text.replace(" ", "")
    return text


def _distance(a, b):
    previous = list(range(len(b) + 1))
    for i, left in enumerate(a, 1):
        current = [i] + [0] * len(b)
        for j, right in enumerate(b, 1):
            current[j] = min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (left != right))
        previous = current
    return previous[-1]


def _within(phrase, text):
    """Edit distance from `phrase` to its best-matching stretch of `text` (free start and end in text)."""
    previous = [0] * (len(text) + 1)
    for i, left in enumerate(phrase, 1):
        current = [i] + [0] * len(text)
        for j, right in enumerate(text, 1):
            current[j] = min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (left != right))
        previous = current
    return min(previous)


def similarity(text, phrase):
    """How well a normalised transcript says a normalised phrase, 0 to 1.

    The whole transcript against the phrase; or, when more was said than the
    phrase ("please turn on the lights now"), the phrase against the part of
    the transcript it matches best, with a small discount for the extra words.
    """
    if not text or not phrase:
        return 0.0
    whole = 1 - _distance(text, phrase) / max(len(text), len(phrase))
    if len(text) <= len(phrase):
        return whole
    part = 1 - _within(phrase, text) / len(phrase)
    return max(whole, part * 0.95)


def match(text, commands, threshold=DEFAULT_THRESHOLD, language="en", margin=MARGIN):
    """The command a transcript says, if any.

    Returns {"command": {id, name} or None, "score", "phrase", "ambiguous", "alternatives": [{id, name, score}]}.
    A command is chosen only when its best phrase scores at least `threshold`
    and beats every other command by `margin`: "lights are" is about as close
    to "lights on" as to "lights off", and doing neither is safer than
    guessing.
    """
    said = normalise(text, language)
    scored = []
    for command in commands or []:
        best, best_phrase = 0.0, ""
        for phrase in command.get("phrases") or [command.get("name", "")]:
            score = similarity(said, normalise(phrase, language))
            if score > best:
                best, best_phrase = score, phrase
        scored.append((best, best_phrase, command))
    scored.sort(key=lambda item: item[0], reverse=True)
    alternatives = [{"id": c.get("id"), "name": c.get("name"), "score": round(s, 3)} for s, _, c in scored[:3]]
    if not scored or scored[0][0] < threshold:
        return {"command": None, "score": round(scored[0][0], 3) if scored else 0.0, "phrase": "",
                "ambiguous": False, "alternatives": alternatives}
    score, phrase, command = scored[0]
    if len(scored) > 1 and score - scored[1][0] < margin:
        return {"command": None, "score": round(score, 3), "phrase": "", "ambiguous": True,
                "alternatives": alternatives}
    return {"command": {"id": command.get("id"), "name": command.get("name")}, "score": round(score, 3),
            "phrase": phrase, "ambiguous": False, "alternatives": alternatives}


def read_commands(folder):
    """The command set stored with a dataset (ks-dataset.json) or a trained model (commands.json)."""
    for name, key in (("commands.json", None), ("ks-dataset.json", "commands")):
        path = os.path.join(folder, name)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as handle:
                data = json.load(handle)
            commands = data.get(key) if key else data.get("commands", data)
            if isinstance(commands, list):
                return commands
    return []


def load_command_clips(data):
    """[(audio path, spoken text, command id)] from a command dataset folder."""
    path = os.path.join(data, "metadata.jsonl")
    if not os.path.exists(path):
        fail("The command set has no recordings yet. Record some on the Commands tab.")
    clips = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            audio = os.path.join(data, row["audio"])
            if row.get("text", "").strip() and os.path.exists(audio):
                clips.append((audio, row["text"].strip(), row.get("command")))
    return clips


def processor_from_files(folder):
    """Moonshine's processor built from tokenizer.json and preprocessor_config.json.

    For a folder AutoProcessor cannot read: transformers 5 saves the tokenizer
    class as "TokenizersBackend", which transformers 4 does not know, and it
    then falls back to a tokenizer that needs a vocab file Moonshine has not
    got. tokenizer.json holds the whole tokenizer in either version.
    """
    from transformers import PreTrainedTokenizerFast, Wav2Vec2FeatureExtractor, Wav2Vec2Processor

    tokenizer_file = os.path.join(folder, "tokenizer.json")
    if not os.path.exists(tokenizer_file):
        fail(f"The model in {folder} has no tokenizer.json, and transformers cannot read its tokenizer.")
    try:
        with open(os.path.join(folder, "tokenizer_config.json"), encoding="utf-8") as handle:
            config = json.load(handle)
    except (OSError, ValueError):
        config = {}
    special = {key: config[key] for key in ("bos_token", "eos_token", "unk_token", "pad_token")
               if isinstance(config.get(key), str)}
    tokenizer = PreTrainedTokenizerFast(tokenizer_file=tokenizer_file, clean_up_tokenization_spaces=False, **special)
    feature_extractor = Wav2Vec2FeatureExtractor.from_pretrained(folder, local_files_only=True)
    return Wav2Vec2Processor(feature_extractor=feature_extractor, tokenizer=tokenizer)


def load_moonshine(folder, device):
    """(processor, model) for a Moonshine folder, in float32 and eval mode."""
    try:
        from transformers import AutoProcessor, MoonshineForConditionalGeneration
    except ImportError as error:
        fail(f"{getattr(error, 'name', None) or error} is not installed, or transformers is too old for "
             "Moonshine (4.48 or later). Run: pip install -r backend/python/requirements.txt")
    try:
        processor = AutoProcessor.from_pretrained(folder, local_files_only=True)
    except (ValueError, TypeError, OSError):
        processor = processor_from_files(folder)
    model =MoonshineForConditionalGeneration.from_pretrained(folder, local_files_only=True).float().to(device).eval()
    return processor, model


def inputs_for(processor, samples, device):
    """Moonshine's inputs for a batch of 16 kHz clips, padded to the longest."""
    batch = processor(samples, sampling_rate=SAMPLE_RATE, return_tensors="pt", padding=True)
    return {key: value.to(device) for key, value in batch.items()}


def transcribe(processor, model, samples, device):
    """Transcripts of a batch of clips."""
    import torch

    longest = max(len(clip) for clip in samples) / SAMPLE_RATE
    # The model's generation config sets max_length too; max_new_tokens is the
    # limit meant here, and passing both makes transformers warn on every clip.
    model.generation_config.max_length = None
    with torch.no_grad():
        output = model.generate(**inputs_for(processor, samples, device),
                                max_new_tokens=int(math.ceil(longest * TOKENS_PER_SECOND)) + 10)
    return [text.strip() for text in processor.batch_decode(output, skip_special_tokens=True)]


def label_ids(processor, model, texts, device):
    """Training labels: each text's tokens without the start token (the model adds it), then the end token."""
    import torch

    start = model.config.decoder_start_token_id
    end = model.config.eos_token_id
    rows = []
    for text in texts:
        ids = processor.tokenizer(text).input_ids
        if ids and ids[0] == start:
            ids = ids[1:]
        rows.append(ids + [end])
    width = max(len(row) for row in rows)
    return torch.tensor([row + [-100] * (width - len(row)) for row in rows], device=device)
