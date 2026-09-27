"""Export a Moonshine model in ONNX Runtime's ORT format, as Moonshine's own apps load it.

    python ort_export.py --model <folder> --output models/ort/<id>.partial \
        [--precision int8|float32] [--sample file.wav]

Moonshine Voice (moonshine-ai/moonshine-v2: its C++ core, and the Android, iOS
and Python libraries on top of it) reads a folder of three files:

  encoder_model.ort          audio in, hidden states out
  decoder_model_merged.ort   Optimum's merged decoder: one graph for the first
                             step and the cached steps (use_cache_branch)
  tokenizer.bin              every token's bytes, in id order

The model goes PyTorch -> ONNX (Optimum, automatic-speech-recognition-with-past)
-> int8 (optional: onnxruntime's dynamic quantisation, MatMul only in the
encoder, whose ConvInteger layers Moonshine's runtime cannot run) -> .ort
(onnxruntime.tools.convert_onnx_models_to_ort). This is how Moonshine's own
downloads are made: for moonshine-tiny the files come out the same size as
theirs and tokenizer.bin byte for byte the same.

The result is checked by running the .ort files the way the C++ runtime does
(the same inputs, cache handling and token limit, and tokenizer.bin to turn
tokens into text) next to PyTorch, on --sample or a built-in clip.
"""
import argparse
import importlib.util
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time

from ks_common import check_model, emit, fail, read_meta

SAMPLE_RATE = 16000
# The C++ runtime stops after this many tokens per second of audio (moonshine-model.h).
MAX_TOKENS_PER_SECOND = 6.5
# The architectures Moonshine's runtime knows, by name: ModelArch.TINY and ModelArch.BASE,
# with the layer count, key/value heads and head size it expects.
ARCHES = {"TINY": (6, 8, 36), "BASE": (8, 8, 52)}
FILES = ("encoder_model.ort", "decoder_model_merged.ort", "tokenizer.bin")


# ------------------------------------------------------------------ tokenizer

def write_tokenizer_bin(tokenizer_json, path):
    """tokenizer.bin: for each token id in order, its length (one byte, or two
    for 128 and up: low 7 bits + 128, then the rest) and its UTF-8 bytes. A
    byte-fallback token <0xNN> is that one byte; an unused id is length 0.
    This is what BinTokenizer (core/bin-tokenizer) reads."""
    with open(tokenizer_json, encoding="utf-8") as handle:
        spec = json.load(handle)
    vocab = spec["model"]["vocab"]
    pieces = {index: piece for piece, index in vocab.items()} if isinstance(vocab, dict) \
        else {index: entry[0] for index, entry in enumerate(vocab)}
    for added in spec.get("added_tokens", []):
        pieces[added["id"]] = added["content"]

    out = bytearray()
    for index in range(max(pieces) + 1):
        piece = pieces.get(index) or ""
        byte = re.fullmatch(r"<0x([0-9A-Fa-f]{2})>", piece)
        data = bytes([int(byte.group(1), 16)]) if byte else piece.encode("utf-8")
        if len(data) >= 128 * 128:
            raise ValueError(f"Token {index} is {len(data)} bytes long; tokenizer.bin allows {128 * 128 - 1}.")
        out += bytes([len(data)]) if len(data) < 128 else bytes([len(data) % 128 + 128, len(data) // 128])
        out += data
    with open(path, "wb") as handle:
        handle.write(out)
    return len(pieces)


def read_tokenizer_bin(path):
    """The token byte strings in tokenizer.bin, as BinTokenizer reads them."""
    with open(path, "rb") as handle:
        data = handle.read()
    tokens, offset = [], 0
    while offset < len(data):
        count = data[offset]
        offset += 1
        if count >= 128:
            count = data[offset] * 128 + count - 128
            offset += 1
        tokens.append(data[offset:offset + count])
        offset += count
    return tokens


def tokens_to_text(table, tokens):
    """BinTokenizer::tokens_to_text: special tokens (<...>) dropped, ▁ -> space, trimmed."""
    out = b""
    for token in tokens:
        piece = table[token]
        if len(piece) > 2 and piece[:1] == b"<" and piece[-1:] == b">":
            continue
        out += piece
    return out.decode("utf-8", errors="replace").replace("▁", " ").strip()


# ------------------------------------------------------------------- convert

def run_quietly(command):
    """Run a converter command; on failure, its last lines are the error."""
    done = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if done.returncode != 0:
        tail = [line for line in (done.stdout + done.stderr).splitlines() if line.strip()][-4:]
        raise RuntimeError(" | ".join(tail)[:600] or f"exit code {done.returncode}")


def arch_of(config):
    """(name, layers, heads, head size): name is TINY or BASE when the runtime knows the shape, else ''."""
    heads = config.decoder_num_key_value_heads or config.decoder_num_attention_heads
    shape = (config.decoder_num_hidden_layers, heads, config.hidden_size // config.decoder_num_attention_heads)
    return next((name for name, known in ARCHES.items() if known == shape), ""), *shape


def export_onnx(model_dir, work, precision):
    """encoder_model.onnx and decoder_model_merged.onnx in work/final."""
    from optimum.exporters.onnx import main_export
    from tflite_export import quietly

    raw = os.path.join(work, "onnx")
    final = os.path.join(work, "final")
    os.makedirs(final)
    emit("status", message="Exporting to ONNX with Optimum")
    quietly(lambda: main_export(model_name_or_path=model_dir, output=raw, task="automatic-speech-recognition-with-past",
                                device="cpu", do_validation=False, local_files_only=True))
    if precision == "float32":
        for name in ("encoder_model.onnx", "decoder_model_merged.onnx"):
            shutil.move(os.path.join(raw, name), os.path.join(final, name))
        return raw, final

    # int8: the two decoders are quantised apart and merged again, as the
    # quantiser does not reach into the merged graph's If branches.
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from optimum.onnx import merge_decoders

    emit("status", message="Quantising to int8")
    quantised = os.path.join(work, "int8")
    os.makedirs(quantised)
    quietly(lambda: quantize_dynamic(os.path.join(raw, "encoder_model.onnx"), os.path.join(final, "encoder_model.onnx"),
                                     weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul", "Gemm"]))
    for name in ("decoder_model", "decoder_with_past_model"):
        quietly(lambda name=name: quantize_dynamic(os.path.join(raw, f"{name}.onnx"), os.path.join(quantised, f"{name}.onnx"),
                                                   weight_type=QuantType.QInt8))
    quietly(lambda: merge_decoders(os.path.join(quantised, "decoder_model.onnx"),
                                   os.path.join(quantised, "decoder_with_past_model.onnx"),
                                   save_path=os.path.join(final, "decoder_model_merged.onnx"), strict=False))
    return raw, final


def to_ort(final, out):
    """The .ort files, optimised once for any CPU (the runtime loads them without re-optimising)."""
    emit("status", message="Converting to ORT format")
    run_quietly([sys.executable, "-m", "onnxruntime.tools.convert_onnx_models_to_ort", final,
                 "--optimization_style", "Fixed"])
    for name in FILES[:2]:
        shutil.move(os.path.join(final, name), os.path.join(out, name))


# --------------------------------------------------------------------- check

class Runtime:
    """The .ort files run as core/moonshine-model.cpp runs them."""

    def __init__(self, folder, layers, heads, head_size):
        import onnxruntime as ort

        options = ort.SessionOptions()
        options.add_session_config_entry("session.load_model_format", "ORT")
        self.encoder = ort.InferenceSession(os.path.join(folder, FILES[0]), options, providers=["CPUExecutionProvider"])
        self.decoder = ort.InferenceSession(os.path.join(folder, FILES[1]), options, providers=["CPUExecutionProvider"])
        self.table = read_tokenizer_bin(os.path.join(folder, FILES[2]))
        self.layers, self.heads, self.head_size = layers, heads, head_size
        expected = {layers * 4 + 3, layers * 4 + 4}
        if len(self.decoder.get_inputs()) not in expected:
            raise RuntimeError(f"The decoder has {len(self.decoder.get_inputs())} inputs; Moonshine's runtime "
                               f"expects {' or '.join(map(str, sorted(expected)))}.")

    def encode(self, audio):
        import numpy as np

        feed = {"input_values": audio[None, :].astype(np.float32)}
        self.mask = None
        if len(self.encoder.get_inputs()) > 1:
            self.mask = np.ones((1, len(audio)), np.int64)
            feed[self.encoder.get_inputs()[1].name] = self.mask
        return self.encoder.run(None, feed)[0]

    def steps(self, hidden, forced=None, limit=0):
        """Greedy decoding; with `forced`, those tokens are fed instead of the
        model's own (teacher forcing). Yields each step's argmax."""
        import numpy as np

        names = [output.name for output in self.decoder.get_outputs()]
        past = {f"past_key_values.{layer}.{side}.{kind}": np.zeros((1, self.heads, 1, self.head_size), np.float32)
                for layer in range(self.layers) for side in ("decoder", "encoder") for kind in ("key", "value")}
        token, index = 1, 0
        while index < (len(forced) if forced is not None else limit):
            feed = {"input_ids": np.array([[token]], np.int64), "encoder_hidden_states": hidden,
                    "use_cache_branch": np.array([index > 0]), **past}
            if self.mask is not None:
                feed["encoder_attention_mask"] = self.mask
            outputs = dict(zip(names, self.decoder.run(None, feed)))
            for name in past:
                # The encoder's keys and values are made on the first step and kept.
                if index == 0 or ".decoder." in name:
                    past[name] = outputs[name.replace("past_key_values.", "present.")]
            best = int(outputs["logits"][0, -1].argmax())
            yield best
            token = forced[index] if forced is not None else best
            index += 1
            if forced is None and best == 2:
                return


def check(args, out, arch, layers, heads, head_size):
    import numpy as np
    import torch
    from command_common import load_moonshine
    from speech_common import read_wav

    source, clip = "a synthetic clip", None
    if args.sample and os.path.exists(args.sample):
        clip, source = read_wav(args.sample)[: 20 * SAMPLE_RATE], os.path.basename(args.sample)
    if clip is None or not len(clip):
        clip = (np.sin(2 * np.pi * 220 * np.arange(SAMPLE_RATE) / SAMPLE_RATE) * 0.1).astype(np.float32)
    limit = int(math.ceil(len(clip) / SAMPLE_RATE * MAX_TOKENS_PER_SECOND))

    runtime = Runtime(out, layers, heads, head_size)
    started = time.time()
    hidden = runtime.encode(clip)
    tokens = list(runtime.steps(hidden, limit=limit))
    per_token = (time.time() - started) / max(1, len(tokens))
    converted = tokens_to_text(runtime.table, tokens)

    processor, model = load_moonshine(args.model, torch.device("cpu"))
    with torch.no_grad():
        model.generation_config.max_length = None
        reference = model.generate(**processor(clip, sampling_rate=SAMPLE_RATE, return_tensors="pt"),
                                   max_new_tokens=limit, num_beams=1, do_sample=False)[0].tolist()
    reference = reference[1:] if reference[:1] == [1] else reference
    pytorch = processor.tokenizer.decode(reference, skip_special_tokens=True).strip()
    # Teacher forcing: PyTorch's tokens fed in, counting the steps whose next token matches.
    predicted = list(runtime.steps(hidden, forced=reference)) if reference else []
    agree = sum(int(a == b) for a, b in zip(predicted, reference))

    result = {"verified": True, "input": source, "converted": converted or "(nothing)", "pytorch": pytorch or "(nothing)",
              "match": converted == pytorch, "agreement": f"{agree}/{len(reference)} next tokens",
              "msPerToken": round(per_token * 1000)}
    if not arch:
        result["note"] = (f"This model has {layers} decoder layers, {heads} heads of {head_size}; Moonshine's runtime "
                          "only knows tiny (6, 8, 36) and base (8, 8, 52), so it will not load these files.")
    return result


# -------------------------------------------------------------------- README

README = """{name} — Moonshine speech recognition, ORT format

Language: {language}   Architecture: {arch_line}   Precision: {precision}

Files
  encoder_model.ort          16 kHz mono float audio [1, samples] (+ attention_mask) -> hidden states
  decoder_model_merged.ort   Optimum's merged decoder with a key/value cache ({layers} layers)
  tokenizer.bin              the {vocab} tokens' bytes, in id order
{commands}
These are the files Moonshine Voice loads (github.com/moonshine-ai/moonshine-v2):
put them in one folder and give it the model architecture.

  Python:   pip install moonshine-voice
            from moonshine_voice import Transcriber, ModelArch
            transcriber = Transcriber("this-folder", ModelArch.{arch_name})
            transcriber.transcribe_without_streaming(samples, 16000)
  Android:  copy the folder into app/src/main/assets/ and load it with
            ai.moonshine.voice.Transcriber: loadFromAssets(activity, "folder",
            JNI.MOONSHINE_MODEL_ARCH_{arch_name})
  iOS/macOS: add the folder to the app bundle and load it with the Swift package

Made with ONNX Runtime {ort_version}: ORT files load in that version or a newer
one, so an app with an older onnxruntime needs this exported again with it.
Plain ONNX Runtime runs them too. Decoding, greedy:
start with token 1; the first step has use_cache_branch = false and empty
past_key_values [1, {heads}, 1, {head_size}]; after it feed one token at a
time with use_cache_branch = true, keeping present.*.decoder.* each step and
present.*.encoder.* from the first; stop at token 2 or after 6.5 tokens per
second of audio.
{command_help}"""

COMMAND_HELP = """
To turn the transcript into a command, the app lower-cases it, drops
punctuation, and picks the command in commands.json whose phrase is closest by
edit distance (at least the saved threshold alike).
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--precision", choices=["int8", "float32"], default="int8")
    parser.add_argument("--sample")
    args = parser.parse_args()

    check_model(args.model)
    meta = read_meta(args.model)
    missing = [name for name in ("torch", "onnx", "onnxruntime", "optimum") if importlib.util.find_spec(name) is None]
    if not missing and importlib.util.find_spec("optimum.exporters.onnx") is None:
        missing = ["optimum-onnx"]
    if missing:
        fail(f"ORT export needs {', '.join(missing)}, which {'is' if len(missing) == 1 else 'are'} not installed. "
             "Run: pip install -r backend/python/requirements.txt")

    from transformers import AutoConfig

    config = AutoConfig.from_pretrained(args.model, local_files_only=True)
    if config.model_type != "moonshine":
        fail(f"ORT export is for Moonshine models; this one is {config.model_type}.")
    arch, layers, heads, head_size = arch_of(config)

    if os.path.exists(args.output):
        shutil.rmtree(args.output)
    os.makedirs(args.output)
    work = os.path.join(args.output, "_work")
    os.makedirs(work)
    started = time.time()
    try:
        raw, final = export_onnx(args.model, work, args.precision)
        to_ort(final, args.output)
        vocab = write_tokenizer_bin(os.path.join(raw, "tokenizer.json"), os.path.join(args.output, "tokenizer.bin"))
        commands = os.path.join(args.model, "commands.json")
        if os.path.exists(commands):
            shutil.copyfile(commands, os.path.join(args.output, "commands.json"))
        emit("status", message="Checking the exported model")
        result = check(args, args.output, arch, layers, heads, head_size)
    except SystemExit:
        raise
    except Exception as error:  # noqa: BLE001 — reported to the page
        fail(f"ORT export failed: {str(error)[:600]}")
    finally:
        shutil.rmtree(work, ignore_errors=True)

    import onnxruntime

    with open(os.path.join(args.output, "README.txt"), "w", encoding="utf-8") as handle:
        handle.write(README.format(
            name=meta.get("name", os.path.basename(args.model)), language=meta.get("language", "en"),
            arch_name=arch or "TINY", arch_line=arch.lower() if arch else f"not tiny or base ({result.get('note', '')})",
            precision=args.precision, ort_version=onnxruntime.__version__, layers=layers, heads=heads, head_size=head_size, vocab=vocab,
            commands="  commands.json              the commands and phrases it was trained on\n"
            if os.path.exists(commands) else "",
            command_help=COMMAND_HELP if os.path.exists(commands) else ""))

    emit("status", message="Creating the zip")
    archive = shutil.make_archive(args.output, "zip", args.output)
    emit("done", method="optimum+ort", precision=args.precision, arch=arch, files=sorted(os.listdir(args.output)),
         archive=os.path.basename(archive), bytes=os.path.getsize(archive), check=result,
         seconds=round(time.time() - started))


if __name__ == "__main__":
    sys.exit(main())
