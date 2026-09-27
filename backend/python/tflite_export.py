"""Export a model to TFLite (TensorFlow Lite / LiteRT), check it, and zip it for download.

    python tflite_export.py --kind yolo|whisper|translation|speaker|moonshine --model <folder> \
        --output models/tflite/<id>.partial [--sample file]

Every model goes PyTorch -> ONNX -> onnx2tf -> .tflite, offline. TFLite wants
fixed shapes, so each graph has batch size 1 and fixed lengths; the README in
the zip says what they are and how to feed them:

  yolo         model.tflite, 640x640 (the training size) NHWC input; the class
               names are embedded, so Ultralytics' YOLO("model.tflite") loads it.
  whisper      encoder.tflite + decoder.tflite: the decoder reads a fixed block
               of tokens (padded) and returns the next token's logits at a
               given position, so it runs in a simple loop without a cache.
  translation  the same encoder/decoder shape as Whisper, for Marian/M2M.
  speaker      ecapa.tflite: 3 s of 80 log-mel filterbank features in, a
               192-number voiceprint out.
  moonshine    encoder.tflite + decoder.tflite for up to --max-seconds of audio,
               with commands.json when the model was trained on a command set.

The models are float32. onnx2tf's float16 and int8 ("dynamic range") models
are not included: TFLite's CPU kernels refuse the float16 ones, and the int8
ones gave NaN or wrong answers on every model tried (onnx2tf 2.6). Each
export is run through TFLite next to PyTorch on --sample (or a built-in
input) and the two results compared.
"""
import argparse
import contextlib
import importlib.util
import io
import json
import math
import os
import shutil
import sys
import time
import zipfile

from ks_common import check_model, emit, fail, go_offline_yolo, read_meta

go_offline_yolo()
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

OPSET = 17
SAMPLE_RATE = 16000


# ----------------------------------------------------------------- plumbing

def quietly(work):
    """Run `work()` with converter chatter (progress bars, TensorFlow logs) kept out of the job's log.
    On failure the last lines are added to the error, which is what the page shows."""
    sink = io.StringIO()
    try:
        with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            return work()
    except Exception as error:
        tail = [line for line in sink.getvalue().splitlines() if line.strip() and "it/s" not in line][-3:]
        raise RuntimeError(f"{error}" + (f" ({' | '.join(tail)[:400]})" if tail else "")) from error


def to_onnx(module, example, path, input_names, output_names):
    """A fixed-shape ONNX graph of `module`, simplified so shape arithmetic is folded into constants."""
    import onnx
    import torch

    has_dynamo = "dynamo" in __import__("inspect").signature(torch.onnx.export).parameters
    with torch.no_grad():
        try:
            quietly(lambda: torch.onnx.export(module, example, path, input_names=input_names, output_names=output_names,
                                              opset_version=OPSET, **({"dynamo": False} if has_dynamo else {})))
        except Exception:  # noqa: BLE001 — some graphs (Moonshine's rotary embeddings) need the newer exporter
            if not has_dynamo:
                raise
            quietly(lambda: torch.onnx.export(module, example, path, input_names=input_names, output_names=output_names,
                                              opset_version=18, dynamo=True, external_data=False))
    model = onnx.load(path)
    if importlib.util.find_spec("onnxslim"):
        import onnxslim
        model = quietly(lambda: onnxslim.slim(model))
    onnx.save(model, path)
    return path


def to_tflite(onnx_path, folder, stem, keep_layout=True):
    """onnx2tf: `stem`.tflite (float32), in `folder`.

    `keep_layout` keeps every input of rank 3 or more in the ONNX layout;
    otherwise onnx2tf turns NCHW images into NHWC, which is what TFLite image
    models (and Ultralytics) expect.
    """
    import onnx
    import onnx2tf

    keep = [value.name for value in onnx.load(onnx_path).graph.input
            if len(value.type.tensor_type.shape.dim) >= 3] if keep_layout else None
    work = os.path.join(folder, f"_{stem}")
    quietly(lambda: onnx2tf.convert(
        input_onnx_file_path=onnx_path, output_folder_path=work, non_verbose=True,
        copy_onnx_input_output_names_to_tflite=True, keep_ncw_or_nchw_or_ncdhw_input_names=keep or None))
    base = os.path.splitext(os.path.basename(onnx_path))[0]
    target = os.path.join(folder, f"{stem}.tflite")
    shutil.move(os.path.join(work, f"{base}_float32.tflite"), target)
    shutil.rmtree(work, ignore_errors=True)
    return target


class Runner:
    """One .tflite model. TensorFlow's interpreter is preferred for the check:
    it applies XNNPACK on every platform, where LiteRT's Python package on
    Windows does not and runs many times slower."""

    def __init__(self, path, threads=None):
        threads = threads or min(8, os.cpu_count() or 4)
        interpreter = None
        if importlib.util.find_spec("tensorflow"):
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                import tensorflow as tf
                interpreter = tf.lite.Interpreter(model_path=path, num_threads=threads)
        else:
            from ai_edge_litert.interpreter import Interpreter
            interpreter = Interpreter(model_path=path, num_threads=threads)
        interpreter.allocate_tensors()
        self.interpreter = interpreter
        self.inputs = interpreter.get_input_details()
        self.outputs = interpreter.get_output_details()

    def signature(self):
        return [(item["name"], item["shape"].tolist(), item["dtype"].__name__) for item in self.inputs]

    def __call__(self, **feeds):
        import numpy as np

        for item in self.inputs:
            name = next((key for key in feeds if key == item["name"]), None) \
                or next((key for key in feeds if key in item["name"]), None)
            if name is None:
                raise ValueError(f"nothing to feed {item['name']}")
            self.interpreter.set_tensor(item["index"], np.asarray(feeds[name]).astype(item["dtype"]).reshape(item["shape"]))
        self.interpreter.invoke()
        return [self.interpreter.get_tensor(item["index"]) for item in self.outputs]


def pick(logits, step, suppress=(), begin_suppress=()):
    """The next token: the highest logit, leaving out the tokens the model's
    generation config suppresses (Whisper never writes some symbols, and not
    <|endoftext|> or a space as its first token)."""
    import numpy as np

    scores = np.array(logits, dtype=np.float64).reshape(-1)
    if suppress:
        scores[list(suppress)] = -np.inf
    if step == 0 and begin_suppress:
        scores[list(begin_suppress)] = -np.inf
    return int(scores.argmax())


def greedy(decoder, hidden, prompt, eos, pad, length, extra=None, suppress=(), begin_suppress=()):
    """Greedy decoding with a fixed-length decoder: the block holds the prompt and
    what has been said so far, padded; each step reads the logits at the last real token."""
    import numpy as np

    tokens = list(prompt)
    started = time.time()
    steps = 0
    while len(tokens) < length:
        block = np.full((1, length), pad, dtype=np.int32)
        block[0, :len(tokens)] = tokens
        logits = decoder(input_ids=block, position=np.array([len(tokens) - 1], dtype=np.int32),
                         encoder_hidden_states=hidden, **(extra or {}))[0]
        token = pick(logits, steps, suppress, begin_suppress)
        steps += 1
        if token == eos:
            break
        tokens.append(token)
    return tokens[len(prompt):], (time.time() - started) / max(steps, 1)


def agreement(decoder, hidden, prompt, reference, pad, length, extra=None, suppress=(), begin_suppress=()):
    """Teacher forcing: PyTorch's own tokens are fed to the TFLite decoder one
    at a time, counting the steps where it predicts the same next token.

    Two transcripts can part ways over one near-tie (common on a synthetic
    clip, where every token is a guess) while the conversion is exact; this
    says whether the models agree step by step.
    """
    import numpy as np

    reference = [int(token) for token in reference]
    if reference[:len(prompt)] == list(prompt):
        reference = reference[len(prompt):]
    tokens, agree, total = list(prompt), 0, 0
    for expected in reference:
        if len(tokens) >= length:
            break
        block = np.full((1, length), pad, dtype=np.int32)
        block[0, :len(tokens)] = tokens
        logits = decoder(input_ids=block, position=np.array([len(tokens) - 1], dtype=np.int32),
                         encoder_hidden_states=hidden, **(extra or {}))[0]
        agree += pick(logits, total, suppress, begin_suppress) == expected
        total += 1
        tokens.append(expected)
    return agree, total


def text_check(source, converted, pytorch, per_token, agreed):
    """The check result for a model that writes text."""
    agree, total = agreed
    return {"verified": True, "input": source, "converted": converted or "(nothing)", "pytorch": pytorch or "(nothing)",
            "match": converted == pytorch or (total > 0 and agree == total),
            "agreement": f"{agree}/{total} next tokens", "msPerToken": round(per_token * 1000)}


# -------------------------------------------------------------- seq2seq graphs

def seq2seq_modules(model, encoder_takes_mask, decoder_mask_name=None):
    """Encoder and fixed-length decoder wrappers for a Hugging Face seq2seq model."""
    import torch

    class Encoder(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.encoder = model.get_encoder()

        def forward(self, inputs, attention_mask=None):
            if encoder_takes_mask:
                return self.encoder(inputs, attention_mask=attention_mask.long()).last_hidden_state
            return self.encoder(inputs).last_hidden_state

    class Decoder(torch.nn.Module):
        """input_ids [1, T] (padded), position [1], encoder_hidden_states [1, S, D] (+ its mask) -> logits [1, vocab]."""

        def __init__(self):
            super().__init__()
            self.decoder = model.get_decoder()
            self.head = model.get_output_embeddings()

        def forward(self, input_ids, position, encoder_hidden_states, encoder_attention_mask=None):
            kwargs = {decoder_mask_name: encoder_attention_mask.long()} if decoder_mask_name else {}
            hidden = self.decoder(input_ids=input_ids.long(), encoder_hidden_states=encoder_hidden_states,
                                  **kwargs).last_hidden_state
            picked = torch.index_select(hidden, 1, position.long().reshape(1))
            logits = self.head(picked)[:, 0, :]
            bias = getattr(model, "final_logits_bias", None)  # Marian adds one after the head
            return logits + bias if bias is not None else logits

    return Encoder().eval(), Decoder().eval()


# ---------------------------------------------------------------------- kinds

def export_whisper(args, meta, out, work):
    import numpy as np
    import torch
    from transformers import WhisperForConditionalGeneration, WhisperProcessor
    from speech_common import prepare_whisper, read_wav

    processor = WhisperProcessor.from_pretrained(args.model, local_files_only=True)
    model = WhisperForConditionalGeneration.from_pretrained(args.model, local_files_only=True).float().eval()
    language = meta.get("language") or "en"
    prepare_whisper(processor, model, language)
    prompt = list(processor.tokenizer.prefix_tokens)
    no_timestamps = processor.tokenizer.convert_tokens_to_ids("<|notimestamps|>")
    if prompt[-1] != no_timestamps:
        prompt.append(no_timestamps)
    eos = processor.tokenizer.eos_token_id
    length = min(args.max_tokens or 224, model.config.max_target_positions)
    encoder, decoder = seq2seq_modules(model, encoder_takes_mask=False)

    frames = model.config.max_source_positions * 2
    features = torch.zeros(1, model.config.num_mel_bins, frames)
    with torch.no_grad():
        hidden = encoder(features)
    ids = torch.full((1, length), eos, dtype=torch.int32)
    ids[0, :len(prompt)] = torch.tensor(prompt)
    position = torch.tensor([len(prompt) - 1], dtype=torch.int32)

    emit("status", message="Converting the encoder")
    enc_path = to_tflite(to_onnx(encoder, (features,), os.path.join(work, "encoder.onnx"),
                                        ["input_features"], ["last_hidden_state"]), out, "encoder")
    emit("status", message="Converting the decoder")
    dec_path = to_tflite(to_onnx(decoder, (ids, position, hidden), os.path.join(work, "decoder.onnx"),
                                        ["input_ids", "position", "encoder_hidden_states"], ["logits"]), out, "decoder")
    processor.save_pretrained(out)
    model.generation_config.save_pretrained(out)

    emit("status", message="Checking the exported model")
    source, audio = "a synthetic clip", None
    if args.sample and os.path.exists(args.sample):
        audio, source = read_wav(args.sample)[: 30 * SAMPLE_RATE], os.path.basename(args.sample)
    if audio is None:
        audio = (np.sin(2 * np.pi * 220 * np.arange(2 * SAMPLE_RATE) / SAMPLE_RATE) * 0.1).astype(np.float32)
    feats = processor.feature_extractor(audio, sampling_rate=SAMPLE_RATE, return_tensors="np").input_features
    tfl_encoder, tfl_decoder = Runner(enc_path), Runner(dec_path)
    tfl_hidden = tfl_encoder(input_features=feats)[0]
    suppress = tuple(getattr(model.generation_config, "suppress_tokens", None) or ())
    begin_suppress = tuple(getattr(model.generation_config, "begin_suppress_tokens", None) or ())
    tokens, per_token = greedy(tfl_decoder, tfl_hidden, prompt, eos, eos, length,
                               suppress=suppress, begin_suppress=begin_suppress)
    with torch.no_grad():
        reference = model.generate(torch.from_numpy(feats), max_new_tokens=length - len(prompt), num_beams=1,
                                   do_sample=False, language=model.generation_config.language, task="transcribe")
    torch_text = processor.batch_decode(reference, skip_special_tokens=True)[0].strip()
    tfl_text = processor.tokenizer.decode(tokens, skip_special_tokens=True).strip()
    check = text_check(source, tfl_text, torch_text, per_token,
                       agreement(tfl_decoder, tfl_hidden, prompt, reference[0].tolist(), eos, length,
                                 suppress=suppress, begin_suppress=begin_suppress))
    readme = WHISPER_README.format(
        name=meta.get("name", os.path.basename(args.model)), language=language, length=length, frames=frames,
        mels=model.config.num_mel_bins, states=hidden.shape[1], width=hidden.shape[2], prompt=prompt, eos=eos,
        vocab=model.config.vocab_size, suppress=list(suppress), begin_suppress=list(begin_suppress))
    return check, readme


def export_translation(args, meta, out, work):
    import numpy as np
    import torch
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(args.model, local_files_only=True)
    model = AutoModelForSeq2SeqLM.from_pretrained(args.model, local_files_only=True).float().eval()
    source, target = meta.get("source") or "", meta.get("target") or ""
    if hasattr(tokenizer, "src_lang") and source:
        tokenizer.src_lang = source
    prompt = [model.config.decoder_start_token_id]
    if meta.get("multilingual") and target and hasattr(tokenizer, "get_lang_id"):
        prompt.append(tokenizer.get_lang_id(target))
    pad, eos = model.config.pad_token_id, model.config.eos_token_id
    length = args.max_tokens or 128
    encoder, decoder = seq2seq_modules(model, encoder_takes_mask=True, decoder_mask_name="encoder_attention_mask")

    ids = torch.full((1, length), pad, dtype=torch.int32)
    ids[0, :4] = torch.tensor(tokenizer("Hello there.").input_ids[:4])
    mask = torch.zeros(1, length, dtype=torch.int32)
    mask[0, :4] = 1
    with torch.no_grad():
        hidden = encoder(ids, mask)
    dec_ids = torch.full((1, length), pad, dtype=torch.int32)
    dec_ids[0, :len(prompt)] = torch.tensor(prompt)
    position = torch.tensor([len(prompt) - 1], dtype=torch.int32)

    emit("status", message="Converting the encoder")
    enc_path = to_tflite(to_onnx(encoder, (ids, mask), os.path.join(work, "encoder.onnx"),
                                        ["input_ids", "attention_mask"], ["last_hidden_state"]), out, "encoder")
    emit("status", message="Converting the decoder")
    dec_path = to_tflite(to_onnx(decoder, (dec_ids, position, hidden, mask), os.path.join(work, "decoder.onnx"),
                                        ["input_ids", "position", "encoder_hidden_states", "encoder_attention_mask"],
                                        ["logits"]), out, "decoder")
    tokenizer.save_pretrained(out)
    model.config.save_pretrained(out)

    emit("status", message="Checking the exported model")
    sentence = "The weather is lovely today, so we will take a walk in the park."
    encoded = tokenizer(sentence).input_ids[:length]
    feed_ids = np.full((1, length), pad, np.int32)
    feed_ids[0, :len(encoded)] = encoded
    feed_mask = np.zeros((1, length), np.int32)
    feed_mask[0, :len(encoded)] = 1
    tfl_hidden = Runner(enc_path)(input_ids=feed_ids, attention_mask=feed_mask)[0]
    tfl_decoder = Runner(dec_path)
    tokens, per_token = greedy(tfl_decoder, tfl_hidden, prompt, eos, pad, length, {"encoder_attention_mask": feed_mask})
    with torch.no_grad():
        kwargs = {"forced_bos_token_id": prompt[1]} if len(prompt) > 1 else {}
        reference = model.generate(torch.tensor([encoded]), max_new_tokens=length - len(prompt), num_beams=1,
                                   do_sample=False, **kwargs)
    torch_text = tokenizer.decode(reference[0], skip_special_tokens=True).strip()
    tfl_text = tokenizer.decode(tokens, skip_special_tokens=True).strip()
    check = text_check(f'"{sentence}"', tfl_text, torch_text, per_token,
                       agreement(tfl_decoder, tfl_hidden, prompt, reference[0].tolist(), pad, length,
                                 {"encoder_attention_mask": feed_mask}))
    readme = TRANSLATION_README.format(
        name=meta.get("name", os.path.basename(args.model)), pair=f"{source or '?'} -> {target or '?'}", length=length,
        width=hidden.shape[2], prompt=prompt, eos=eos, pad=pad)
    return check, readme


def export_moonshine(args, meta, out, work):
    import numpy as np
    import torch
    from command_common import load_moonshine
    from speech_common import read_wav

    processor, model = load_moonshine(args.model, torch.device("cpu"))
    seconds = args.max_seconds or 8
    samples = int(seconds * SAMPLE_RATE)
    length = args.max_tokens or int(math.ceil(seconds * 6.5)) + 10
    start, eos = model.config.decoder_start_token_id, model.config.eos_token_id
    encoder, decoder = seq2seq_modules(model, encoder_takes_mask=True, decoder_mask_name="encoder_attention_mask")

    # Traced with some padding, so the mask path (which the model skips when
    # nothing is padded) is part of the graph.
    audio = torch.zeros(1, samples)
    mask = torch.zeros(1, samples, dtype=torch.int32)
    mask[0, : samples // 2] = 1
    with torch.no_grad():
        hidden = encoder(audio, mask)
    ids = torch.full((1, length), eos, dtype=torch.int32)
    ids[0, 0] = start
    position = torch.tensor([0], dtype=torch.int32)

    emit("status", message="Converting the encoder")
    enc_path = to_tflite(to_onnx(encoder, (audio, mask), os.path.join(work, "encoder.onnx"),
                                        ["input_values", "attention_mask"], ["last_hidden_state"]), out, "encoder")
    emit("status", message="Converting the decoder")
    dec_path = to_tflite(to_onnx(decoder, (ids, position, hidden, mask), os.path.join(work, "decoder.onnx"),
                                        ["input_ids", "position", "encoder_hidden_states", "encoder_attention_mask"],
                                        ["logits"]), out, "decoder")
    processor.save_pretrained(out)
    commands = os.path.join(args.model, "commands.json")
    if os.path.exists(commands):
        shutil.copyfile(commands, os.path.join(out, "commands.json"))

    emit("status", message="Checking the exported model")
    source, clip = "a synthetic clip", None
    if args.sample and os.path.exists(args.sample):
        clip, source = read_wav(args.sample)[:samples], os.path.basename(args.sample)
    if clip is None:
        clip = (np.sin(2 * np.pi * 220 * np.arange(SAMPLE_RATE) / SAMPLE_RATE) * 0.1).astype(np.float32)
    feed_audio = np.zeros((1, samples), np.float32)
    feed_audio[0, :len(clip)] = clip
    feed_mask = np.zeros((1, samples), np.int32)
    feed_mask[0, :len(clip)] = 1
    tfl_hidden = Runner(enc_path)(input_values=feed_audio, attention_mask=feed_mask)[0]
    tfl_decoder = Runner(dec_path)
    tokens, per_token = greedy(tfl_decoder, tfl_hidden, [start], eos, eos, length, {"encoder_attention_mask": feed_mask})
    # PyTorch is given exactly what the TFLite graph gets: the clip padded to
    # the fixed length, with its mask.
    with torch.no_grad():
        model.generation_config.max_length = None
        reference = model.generate(input_values=torch.from_numpy(feed_audio), attention_mask=torch.from_numpy(feed_mask),
                                   max_new_tokens=length - 1, num_beams=1, do_sample=False)
    torch_text = processor.batch_decode(reference, skip_special_tokens=True)[0].strip()
    tfl_text = processor.tokenizer.decode(tokens, skip_special_tokens=True).strip()
    check = text_check(source, tfl_text, torch_text, per_token,
                       agreement(tfl_decoder, tfl_hidden, [start], reference[0].tolist(), eos, length,
                                 {"encoder_attention_mask": feed_mask}))
    readme = MOONSHINE_README.format(
        name=meta.get("name", os.path.basename(args.model)), language=meta.get("language", "en"), seconds=seconds,
        samples=samples, length=length, states=hidden.shape[1], width=hidden.shape[2], start=start, eos=eos,
        commands="  commands.json          the commands and phrases it was trained on\n" if os.path.exists(commands) else "")
    return check, readme


def export_speaker(args, meta, out, work):
    import numpy as np
    import torch
    from speaker_common import load_ecapa, read_wav, speech_only

    features, normalize, embedding = load_ecapa(args.model)

    class FromFeatures(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.normalize, self.embedding = normalize, embedding

        def forward(self, fbank):
            lengths = torch.ones(fbank.shape[0])
            return self.embedding(self.normalize(fbank, lengths), lengths).squeeze(1)

    module = FromFeatures().eval()
    window = int(args.max_seconds or 3) * SAMPLE_RATE
    with torch.no_grad():
        example = features(torch.randn(1, window) * 0.1)
    frames = example.shape[1]
    emit("status", message="Converting the speaker model")
    path = to_tflite(to_onnx(module, (example,), os.path.join(work, "ecapa.onnx"), ["fbank"], ["embedding"]),
                                out, "ecapa")

    emit("status", message="Checking the exported model")
    source, audio = "a synthetic clip", None
    if args.sample and os.path.exists(args.sample):
        voiced, _ = speech_only(read_wav(args.sample))
        if voiced.size >= window:
            audio, source = voiced[:window], f"{os.path.basename(args.sample)} (first {window // SAMPLE_RATE} s of speech)"
    if audio is None:
        t = np.arange(window) / SAMPLE_RATE
        phase = 2 * np.pi * np.cumsum(140 + 30 * np.sin(2 * np.pi * 2 * t)) / SAMPLE_RATE
        audio = (sum(np.sin(k * phase) / k for k in range(1, 12)) * 0.1).astype(np.float32)
    with torch.no_grad():
        fbank = features(torch.from_numpy(np.ascontiguousarray(audio, dtype=np.float32))[None])
        reference = module(fbank).numpy()[0]
    exported = Runner(path)(fbank=fbank.numpy())[0].reshape(-1)
    cosine = float(reference @ exported / (np.linalg.norm(reference) * np.linalg.norm(exported)))
    check = {"verified": True, "input": source, "converted": f"cosine {cosine:.6f} to PyTorch's",
             "pytorch": f"voiceprint of {reference.size}", "match": cosine > 0.9999}
    readme = SPEAKER_README.format(name=meta.get("name", os.path.basename(args.model)), frames=frames,
                                   seconds=window // SAMPLE_RATE, size=reference.size)
    return check, readme


def normalise_yolo_boxes(onnx_path, imgsz, end2end, task, classes):
    """Divide the boxes (and pose keypoints) in a YOLO ONNX graph's first output by the input size.

    TFLite YOLO models give coordinates in 0..1, and Ultralytics' TFLite
    backend multiplies them back by the image size; its ONNX export gives
    pixels. End-to-end (NMS-free) models output [1, detections, 6+] with the
    box in the last axis; the others [1, 4 + classes (+ …), anchors].
    """
    import numpy as np
    import onnx
    from onnx import helper, numpy_helper

    model = onnx.load(onnx_path)
    graph = model.graph
    output = graph.output[0]
    dims = [dim.dim_value for dim in output.type.tensor_type.shape.dim]
    width = dims[-1] if end2end else dims[1]
    scale = np.ones(width, dtype=np.float32)
    scale[:4] = 1.0 / imgsz
    if task == "pose":
        start = 6 if end2end else 4 + classes
        scale[start::3] = scale[start + 1::3] = 1.0 / imgsz
    scale = scale.reshape((1, 1, width) if end2end else (1, width, 1))
    pixels = f"{output.name}_pixels"
    for node in graph.node:
        node.output[:] = [pixels if name == output.name else name for name in node.output]
    graph.initializer.append(numpy_helper.from_array(scale, name=f"{output.name}_scale"))
    graph.node.append(helper.make_node("Mul", [pixels, f"{output.name}_scale"], [output.name], name="normalise_boxes"))
    onnx.save(model, onnx_path)


def export_yolo(args, meta, out, work):
    from ks_common import yolo_weights
    from ultralytics import YOLO
    from yolo_export import compare

    imgsz = args.imgsz or int(meta.get("imgsz") or 640)
    weights = os.path.join(work, "model.pt")
    shutil.copyfile(yolo_weights(args.model), weights)
    model = YOLO(weights)
    task = getattr(model, "task", "detect")
    names = model.names if isinstance(model.names, dict) else dict(enumerate(model.names))

    emit("status", message="Exporting to ONNX with Ultralytics")
    onnx_path = str(quietly(lambda: model.export(format="onnx", imgsz=imgsz, dynamic=False,
                                                 simplify=importlib.util.find_spec("onnxslim") is not None)))
    inner = model.model
    end2end = bool(getattr(inner, "end2end", False))
    normalise_yolo_boxes(onnx_path, imgsz, end2end, task, len(names))
    emit("status", message="Converting to TFLite")
    path = to_tflite(onnx_path, out, "model", keep_layout=False)
    # Ultralytics reads a TFLite model's names and size from a metadata.json
    # appended to the file as a zip entry, as its own exporter writes it.
    metadata = {
        "description": f"{meta.get('name', 'YOLO')} TFLite export", "author": "Knowledge Store", "task": task,
        "stride": int(max(inner.stride)), "batch": 1, "imgsz": [imgsz, imgsz], "names": names,
        "channels": inner.yaml.get("channels", 3) if hasattr(inner, "yaml") else 3,
        "end2end": end2end, "args": {"nms": False, "half": False, "int8": False},
    }
    with zipfile.ZipFile(path, "a", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("metadata.json", json.dumps(metadata, indent=2))
    with open(os.path.join(out, "classes.txt"), "w", encoding="utf-8") as handle:
        handle.write("\n".join(names[index] for index in sorted(names)) + "\n")

    check = {"verified": False, "reason": "No sample image was available to test-run the export."}
    if args.sample and os.path.exists(args.sample):
        emit("status", message="Checking the exported model")
        check = compare(weights, path, args.sample, imgsz, task)
        check["converted"] = check.pop("onnx", "")
    readme = YOLO_README.format(name=meta.get("name", os.path.basename(args.model)), task=task, imgsz=imgsz,
                                classes=", ".join(names[index] for index in sorted(names)))
    return check, readme


# ------------------------------------------------------------------ READMEs

COMMON = """
Run with LiteRT (TensorFlow Lite) on Android, iOS, a Raspberry Pi, or Python:
  pip install ai-edge-litert
  from ai_edge_litert.interpreter import Interpreter
  model = Interpreter(model_path="...tflite"); model.allocate_tensors()
Inputs have batch size 1 and the fixed shapes above; pad shorter inputs.
"""

YOLO_README = """{name} — YOLO, TFLite export

Task: {task}   Input size: {imgsz}x{imgsz}   Classes: {classes}

Files
  model.tflite        input float32 [1, {imgsz}, {imgsz}, 3] (NHWC), RGB, 0..1; box
                      coordinates come out as fractions of the image (0..1)
  classes.txt         one class name per line, in class-id order

The class names and input size are embedded, so Ultralytics loads it as-is:
  from ultralytics import YOLO
  results = YOLO("model.tflite", task="{task}").predict("image.jpg")
""" + COMMON

WHISPER_README = """{name} — Whisper, TFLite export

Language: {language}

Files
  encoder.tflite   input_features float32 [1, {mels}, {frames}] -> last_hidden_state [1, {states}, {width}]
  decoder.tflite   input_ids int32 [1, {length}], position int32 [1], encoder_hidden_states [1, {states}, {width}]
                   -> logits [1, {vocab}]: the next token after input_ids[position]
  tokenizer, preprocessor and generation config files (WhisperProcessor.from_pretrained reads them)

Audio: 16 kHz mono, turned into the log-mel input by WhisperFeatureExtractor
(30 s, padded). Decoding, greedy:
  tokens = {prompt}
  loop: block = tokens padded with {eos} to {length}
        logits = decoder(block, position = len(tokens) - 1, hidden)
        next = argmax(logits); stop at {eos}; else append
As Whisper's own generate() does, never pick these tokens (set their logits
to -infinity first): {suppress}
and, for the first token only, not these either: {begin_suppress}
The decoder has no cache: each step reads the whole block, which is simple
and fast enough for a {length}-token block.
""" + COMMON

TRANSLATION_README = """{name} — translation, TFLite export

Pair: {pair}

Files
  encoder.tflite   input_ids int32 [1, {length}], attention_mask int32 [1, {length}] -> last_hidden_state [1, {length}, {width}]
  decoder.tflite   input_ids int32 [1, {length}], position int32 [1], encoder_hidden_states, encoder_attention_mask
                   -> logits: the next token after input_ids[position]
  tokenizer and config files (AutoTokenizer.from_pretrained reads them)

Encode: tokenize the sentence, pad input_ids with {pad} to {length}, mask 1
for real tokens and 0 for padding. Decode, greedy:
  tokens = {prompt}
  loop: block = tokens padded with {pad} to {length}
        logits = decoder(block, position = len(tokens) - 1, hidden, mask)
        next = argmax(logits); stop at {eos}; else append
""" + COMMON

MOONSHINE_README = """{name} — Moonshine speech recognition, TFLite export

Language: {language}   Longest clip: {seconds} s

Files
  encoder.tflite   input_values float32 [1, {samples}] (16 kHz audio, zero-padded),
                   attention_mask int32 [1, {samples}] (1 for audio, 0 for padding)
                   -> last_hidden_state [1, {states}, {width}]
  decoder.tflite   input_ids int32 [1, {length}], position int32 [1], encoder_hidden_states,
                   encoder_attention_mask (the same mask as the encoder's) -> logits: the next token
  tokenizer and preprocessor files
{commands}
Decoding, greedy: tokens = [{start}]; pad the block with {eos} to {length},
read the logits at position len(tokens) - 1, append the argmax until {eos}.
To turn the transcript into a command, the app lower-cases it, drops
punctuation, and picks the command whose phrase is closest by edit distance.
""" + COMMON

SPEAKER_README = """{name} — ECAPA-TDNN speaker model, TFLite export

Files
  ecapa.tflite       fbank float32 [1, {frames}, 80] ({seconds} s of audio) -> embedding [1, {size}]

TFLite needs a fixed length, so the model reads {seconds} s at a time: cut
silence out, split the speech into {seconds} s windows (pad the last), and
average the windows' unit-length voiceprints. Features are 80 log-mel
filterbanks as SpeechBrain's Fbank computes them: n_fft 400, hop 160, 25 ms
Hamming window, centred frames; power spectrum -> 80 mel filters 0-8000 Hz ->
10*log10(max(x, 1e-10)), clipped 80 dB below the maximum. Compare voiceprints
by cosine similarity; the app counts 0.35 or more as the same speaker.
""" + COMMON

KINDS = {
    "yolo": export_yolo, "whisper": export_whisper, "translation": export_translation, "speaker": export_speaker,
    "moonshine": export_moonshine,
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", required=True, choices=sorted(KINDS))
    parser.add_argument("--model", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--sample")
    parser.add_argument("--imgsz", type=int, default=0)
    parser.add_argument("--max-tokens", type=int, default=0)
    parser.add_argument("--max-seconds", type=float, default=0)
    args = parser.parse_args()

    check_model(args.model)
    meta = read_meta(args.model)
    missing = [name for name in ("torch", "onnx", "onnx2tf", "tensorflow") if importlib.util.find_spec(name) is None]
    if missing:
        fail(f"TFLite export needs {', '.join(missing)}, which {'is' if len(missing) == 1 else 'are'} not installed. "
             "Run: pip install -r backend/python/requirements-tflite.txt")

    if os.path.exists(args.output):
        shutil.rmtree(args.output)
    os.makedirs(args.output)
    work = os.path.join(args.output, "_work")
    os.makedirs(work)
    started = time.time()
    try:
        check, readme = KINDS[args.kind](args, meta, args.output, work)
    except SystemExit:
        raise
    except Exception as error:  # noqa: BLE001 — reported to the page
        fail(f"TFLite export failed: {str(error)[:600]}")
    finally:
        shutil.rmtree(work, ignore_errors=True)

    with open(os.path.join(args.output, "README.txt"), "w", encoding="utf-8") as handle:
        handle.write(readme)

    emit("status", message="Creating the zip")
    archive = shutil.make_archive(args.output, "zip", args.output)
    emit("done", method="onnx2tf", kind=args.kind, files=sorted(os.listdir(args.output)),
         archive=os.path.basename(archive), bytes=os.path.getsize(archive), check=check,
         seconds=round(time.time() - started))


if __name__ == "__main__":
    sys.exit(main())
