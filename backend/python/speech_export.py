"""Export a local Whisper model to ONNX, check it, and zip it for download.

    python speech_export.py --model models/finetuned/<id> --output models/onnx/<id>.partial [--sample clip.wav]

The layout is Hugging Face Optimum's: encoder_model.onnx and
decoder_model.onnx beside the processor files, so
`optimum.onnxruntime.ORTModelForSpeechSeq2Seq.from_pretrained(folder)` loads
it. Optimum is used when installed (it adds a faster decoder that reuses past
keys/values); otherwise torch.onnx writes the two plain graphs.

With --sample, one clip is transcribed through the ONNX graphs and through
PyTorch and the two texts compared.
"""
import argparse
import importlib.util
import inspect
import os
import shutil
import sys

from ks_common import META_FILE, check_model, emit, fail, go_offline, read_meta
from speech_common import MAX_SECONDS, SAMPLE_RATE, prepare_whisper, read_wav

go_offline()

README = """{name} — Whisper ONNX export

Language: {language}   Exported with: {method}

Files
  encoder_model.onnx   input_features [batch, 80, 3000] -> last_hidden_state
  decoder_model.onnx   input_ids, encoder_hidden_states -> logits
  preprocessor_config.json, tokenizer files, config.json, generation_config.json

Audio must be 16 kHz mono; the feature extractor turns it into the 80x3000
log-mel input. Decoding starts from these tokens, then greedy or beam search
until <|endoftext|>:
  {prompt}

Load with Hugging Face Optimum (offline):
  from optimum.onnxruntime import ORTModelForSpeechSeq2Seq
  from transformers import WhisperProcessor
  processor = WhisperProcessor.from_pretrained(".")
  model = ORTModelForSpeechSeq2Seq.from_pretrained(".", use_cache={use_cache})
"""


def export_with_optimum(model_dir, output):
    from optimum.exporters.onnx import main_export
    main_export(model_name_or_path=model_dir, output=output, task="automatic-speech-recognition-with-past",
                local_files_only=True, do_validation=False)


def export_with_torch(model_dir, output):
    import torch
    from transformers import WhisperForConditionalGeneration, WhisperProcessor

    processor = WhisperProcessor.from_pretrained(model_dir, local_files_only=True)
    model = WhisperForConditionalGeneration.from_pretrained(model_dir, local_files_only=True).float().eval()
    model.config.use_cache = False

    class Encoder(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.encoder = model.get_encoder()

        def forward(self, input_features):
            return self.encoder(input_features=input_features, return_dict=False)[0]

    class Decoder(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.decoder = model.get_decoder()
            self.proj_out = model.proj_out

        def forward(self, input_ids, encoder_hidden_states):
            # An explicit all-ones mask: without one, transformers 5 inspects
            # position ids with torch.diff to detect packed sequences, and
            # aten::diff has no ONNX equivalent.
            hidden = self.decoder(input_ids=input_ids, attention_mask=torch.ones_like(input_ids),
                                  encoder_hidden_states=encoder_hidden_states, use_cache=False, return_dict=False)[0]
            return self.proj_out(hidden)

    features = torch.zeros(1, model.config.num_mel_bins, 3000)
    with torch.no_grad():
        hidden = Encoder()(features)
    # Tracing input only: any valid token ids, three of them so the decoder's
    # sequence axis is exported as dynamic rather than fixed at 1.
    start = torch.full((1, 3), model.config.decoder_start_token_id, dtype=torch.long)
    extra = {"dynamo": False} if "dynamo" in inspect.signature(torch.onnx.export).parameters else {}

    torch.onnx.export(
        Encoder(), (features,), os.path.join(output, "encoder_model.onnx"),
        input_names=["input_features"], output_names=["last_hidden_state"],
        dynamic_axes={"input_features": {0: "batch_size"}, "last_hidden_state": {0: "batch_size"}},
        opset_version=17, **extra,
    )
    torch.onnx.export(
        Decoder(), (start, hidden), os.path.join(output, "decoder_model.onnx"),
        input_names=["input_ids", "encoder_hidden_states"], output_names=["logits"],
        dynamic_axes={"input_ids": {0: "batch_size", 1: "decoder_sequence_length"},
                      "encoder_hidden_states": {0: "batch_size"},
                      "logits": {0: "batch_size", 1: "decoder_sequence_length"}},
        opset_version=17, **extra,
    )
    processor.save_pretrained(output)
    model.config.save_pretrained(output)
    model.generation_config.save_pretrained(output)


def verify(model_dir, output, language, sample):
    """Greedy-decode one clip through the ONNX graphs and through PyTorch."""
    try:
        import numpy as np
        import onnxruntime as ort
    except ImportError:
        return {"verified": False, "reason": "onnxruntime is not installed, so the export was not test-run."}
    if not sample or not os.path.exists(sample):
        return {"verified": False, "reason": "No sample clip was available to test-run the export."}

    import torch
    from transformers import WhisperForConditionalGeneration, WhisperProcessor

    processor = WhisperProcessor.from_pretrained(model_dir, local_files_only=True)
    model = WhisperForConditionalGeneration.from_pretrained(model_dir, local_files_only=True).float().eval()
    generate_args = prepare_whisper(processor, model, language)
    samples = read_wav(sample)[: MAX_SECONDS * SAMPLE_RATE]
    features = processor.feature_extractor(samples, sampling_rate=SAMPLE_RATE, return_tensors="np").input_features

    encoder = ort.InferenceSession(os.path.join(output, "encoder_model.onnx"), providers=["CPUExecutionProvider"])
    decoder = ort.InferenceSession(os.path.join(output, "decoder_model.onnx"), providers=["CPUExecutionProvider"])
    wanted = {item.name for item in decoder.get_inputs()}
    hidden = encoder.run(None, {"input_features": features.astype(np.float32)})[0]

    # <|startoftranscript|><|lang|><|transcribe|><|notimestamps|>, as generate() starts.
    tokens = processor.tokenizer.prefix_tokens
    end = processor.tokenizer.eos_token_id
    for _ in range(128):
        feed = {"input_ids": np.array([tokens], dtype=np.int64), "encoder_hidden_states": hidden}
        logits = decoder.run(["logits"], {key: value for key, value in feed.items() if key in wanted})[0]
        token = int(logits[0, -1].argmax())
        tokens.append(token)
        if token == end:
            break
    onnx_text = processor.decode(tokens, skip_special_tokens=True).strip()

    with torch.no_grad():
        output_ids = model.generate(torch.from_numpy(features), num_beams=1, do_sample=False, max_new_tokens=128,
                                    **generate_args)
    torch_text = processor.batch_decode(output_ids, skip_special_tokens=True)[0].strip()
    return {"verified": True, "input": os.path.basename(sample), "onnx": onnx_text, "pytorch": torch_text,
            "match": onnx_text == torch_text}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--sample")
    parser.add_argument("--method", choices=["auto", "optimum", "torch"], default="auto")
    args = parser.parse_args()

    check_model(args.model)
    try:
        import torch  # noqa: F401
        import transformers  # noqa: F401
    except ImportError as error:
        fail(f"{error.name or error} is not installed. Run: pip install -r backend/python/requirements.txt")

    meta = read_meta(args.model)
    language = meta.get("language")
    if os.path.exists(args.output):
        shutil.rmtree(args.output)
    os.makedirs(args.output)

    method = args.method
    if method == "auto":
        # find_spec of a submodule raises, rather than returning None, when
        # the parent package is not installed at all.
        method = "optimum" if importlib.util.find_spec("optimum") and importlib.util.find_spec("optimum.exporters.onnx")             else "torch"
    emit("status", message=f"Exporting with {method}", method=method)
    try:
        if method == "optimum":
            try:
                export_with_optimum(args.model, args.output)
            except Exception as error:  # noqa: BLE001 — fall back rather than fail the export
                if args.method == "optimum":
                    raise
                print(f"Optimum export failed ({error}); falling back to torch.onnx.", file=sys.stderr)
                shutil.rmtree(args.output, ignore_errors=True)
                os.makedirs(args.output)
                method = "torch"
                emit("status", message="Optimum failed; exporting with torch", method=method)
                export_with_torch(args.model, args.output)
        else:
            export_with_torch(args.model, args.output)
    except Exception as error:  # noqa: BLE001 — reported to the page, not swallowed
        fail(f"ONNX export failed: {error}")

    emit("status", message="Checking the exported model")
    try:
        check = verify(args.model, args.output, language, args.sample)
    except Exception as error:  # noqa: BLE001
        check = {"verified": False, "reason": f"The check could not run: {error}"}

    from transformers import WhisperProcessor
    processor = WhisperProcessor.from_pretrained(args.model, local_files_only=True)
    if language:
        processor.tokenizer.set_prefix_tokens(language=language, task="transcribe")
    prompt = processor.tokenizer.convert_ids_to_tokens(processor.tokenizer.prefix_tokens)
    with open(os.path.join(args.output, "README.txt"), "w", encoding="utf-8") as handle:
        handle.write(README.format(name=meta.get("name", os.path.basename(args.model)), language=language or "any",
                                   method=method, prompt=" ".join(prompt), use_cache=method == "optimum"))
    stale = os.path.join(args.output, META_FILE)
    if os.path.exists(stale):
        os.remove(stale)

    emit("status", message="Creating the zip")
    archive = shutil.make_archive(args.output, "zip", args.output)
    emit("done", method=method, files=sorted(os.listdir(args.output)), archive=os.path.basename(archive),
         bytes=os.path.getsize(archive), check=check)


if __name__ == "__main__":
    main()
