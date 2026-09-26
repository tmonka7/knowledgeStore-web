"""Export a local translation model to ONNX, and zip it for download.

    python export_onnx.py --model models/finetuned/<id> --output models/onnx/<id>.partial

The result is the layout Hugging Face Optimum uses — encoder_model.onnx and
decoder_model.onnx beside the tokenizer and config — so
`optimum.onnxruntime.ORTModelForSeq2SeqLM.from_pretrained(folder)` loads it,
and so can any ONNX Runtime code that drives the two graphs itself.

Optimum is used when it is installed; it also writes a decoder that reuses
past keys/values, which is much faster to generate with. Without it the
export falls back to torch.onnx, which needs nothing beyond torch and writes
the two plain graphs.

When onnxruntime is installed the export is checked: a sample sentence is
translated with the ONNX graphs and compared with the PyTorch model.
"""
import argparse
import inspect
import os
import shutil
import sys

from ks_common import META_FILE, emit, fail, go_offline, read_meta

go_offline()

SAMPLE_TEXTS = {"en": "The weather is nice today.", "es": "Hoy hace buen tiempo."}


def export_with_optimum(model_dir, output):
    from optimum.exporters.onnx import main_export
    main_export(model_name_or_path=model_dir, output=output, task="text2text-generation-with-past",
                local_files_only=True, do_validation=False)


def export_with_torch(model_dir, output):
    import torch
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(model_dir, local_files_only=True)
    model = AutoModelForSeq2SeqLM.from_pretrained(model_dir, local_files_only=True).eval()
    model.config.use_cache = False

    class Encoder(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.encoder = model.get_encoder()

        def forward(self, input_ids, attention_mask):
            return self.encoder(input_ids=input_ids, attention_mask=attention_mask, return_dict=False)[0]

    class Decoder(torch.nn.Module):
        """Decoder plus the LM head, taking the inputs Optimum's decoder takes."""

        def __init__(self):
            super().__init__()
            self.decoder = model.get_decoder()
            self.lm_head = model.lm_head
            self.register_buffer("final_logits_bias", getattr(model, "final_logits_bias", torch.zeros(1)))

        def forward(self, input_ids, encoder_hidden_states, encoder_attention_mask):
            hidden = self.decoder(input_ids=input_ids, encoder_hidden_states=encoder_hidden_states,
                                  encoder_attention_mask=encoder_attention_mask, use_cache=False,
                                  return_dict=False)[0]
            return self.lm_head(hidden) + self.final_logits_bias

    sample = tokenizer(["Hello world, this is a test."], return_tensors="pt")
    with torch.no_grad():
        hidden = Encoder()(sample["input_ids"], sample["attention_mask"])
    start = torch.full((1, 1), model.config.decoder_start_token_id, dtype=torch.long)

    # torch 2.9 made the dynamo exporter the default; the TorchScript one is
    # the one that handles these models with dynamic axes reliably.
    extra = {"dynamo": False} if "dynamo" in inspect.signature(torch.onnx.export).parameters else {}
    batch_and_sequence = {0: "batch_size", 1: "sequence_length"}

    torch.onnx.export(
        Encoder(), (sample["input_ids"], sample["attention_mask"]),
        os.path.join(output, "encoder_model.onnx"),
        input_names=["input_ids", "attention_mask"], output_names=["last_hidden_state"],
        dynamic_axes={"input_ids": batch_and_sequence, "attention_mask": batch_and_sequence,
                      "last_hidden_state": {0: "batch_size", 1: "encoder_sequence_length"}},
        opset_version=17, **extra,
    )
    torch.onnx.export(
        Decoder(), (start, hidden, sample["attention_mask"]),
        os.path.join(output, "decoder_model.onnx"),
        input_names=["input_ids", "encoder_hidden_states", "encoder_attention_mask"], output_names=["logits"],
        dynamic_axes={"input_ids": {0: "batch_size", 1: "decoder_sequence_length"},
                      "encoder_hidden_states": {0: "batch_size", 1: "encoder_sequence_length"},
                      "encoder_attention_mask": {0: "batch_size", 1: "encoder_sequence_length"},
                      "logits": {0: "batch_size", 1: "decoder_sequence_length"}},
        opset_version=17, **extra,
    )
    tokenizer.save_pretrained(output)
    model.config.save_pretrained(output)
    if getattr(model, "generation_config", None) is not None:
        model.generation_config.save_pretrained(output)


def verify(model_dir, output, source):
    """Greedy-decode one sentence through the ONNX graphs and through PyTorch."""
    try:
        import numpy as np
        import onnxruntime as ort
    except ImportError:
        return {"verified": False, "reason": "onnxruntime is not installed, so the export was not test-run."}

    import torch
    from transformers import AutoConfig, AutoModelForSeq2SeqLM, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(model_dir, local_files_only=True)
    config = AutoConfig.from_pretrained(model_dir, local_files_only=True)
    text = SAMPLE_TEXTS.get(source, SAMPLE_TEXTS["en"])
    encoded = tokenizer([text], return_tensors="np")

    encoder = ort.InferenceSession(os.path.join(output, "encoder_model.onnx"), providers=["CPUExecutionProvider"])
    decoder = ort.InferenceSession(os.path.join(output, "decoder_model.onnx"), providers=["CPUExecutionProvider"])
    wanted = {item.name for item in decoder.get_inputs()}

    hidden = encoder.run(None, {"input_ids": encoded["input_ids"].astype(np.int64),
                                "attention_mask": encoded["attention_mask"].astype(np.int64)})[0]
    tokens = [config.decoder_start_token_id]
    for _ in range(64):
        feed = {"input_ids": np.array([tokens], dtype=np.int64),
                "encoder_hidden_states": hidden,
                "encoder_attention_mask": encoded["attention_mask"].astype(np.int64)}
        logits = decoder.run(["logits"], {key: value for key, value in feed.items() if key in wanted})[0]
        # Marian never generates <pad>; generate() masks it the same way.
        logits[0, -1, config.pad_token_id] = -np.inf
        token = int(logits[0, -1].argmax())
        tokens.append(token)
        if token == config.eos_token_id:
            break
    onnx_text = tokenizer.decode(tokens, skip_special_tokens=True)

    model = AutoModelForSeq2SeqLM.from_pretrained(model_dir, local_files_only=True).eval()
    with torch.no_grad():
        reference = model.generate(**tokenizer([text], return_tensors="pt"), num_beams=1, do_sample=False,
                                   max_new_tokens=64)
    torch_text = tokenizer.decode(reference[0], skip_special_tokens=True)
    return {"verified": True, "input": text, "onnx": onnx_text, "pytorch": torch_text, "match": onnx_text == torch_text}


README = """{name} — ONNX export

Language pair: {source} -> {target}
Exported with: {method}

Files
  encoder_model.onnx   input_ids, attention_mask -> last_hidden_state
  decoder_model.onnx   input_ids (decoder), encoder_hidden_states, encoder_attention_mask -> logits
  tokenizer files, config.json, generation_config.json

Load with Hugging Face Optimum (offline):
  from optimum.onnxruntime import ORTModelForSeq2SeqLM
  from transformers import AutoTokenizer
  tokenizer = AutoTokenizer.from_pretrained(".")
  model = ORTModelForSeq2SeqLM.from_pretrained(".", use_cache={use_cache})
  print(tokenizer.batch_decode(model.generate(**tokenizer(["Hello"], return_tensors="pt")), skip_special_tokens=True))
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--method", choices=["auto", "optimum", "torch"], default="auto")
    args = parser.parse_args()

    try:
        import torch  # noqa: F401
        import transformers  # noqa: F401
    except ImportError as error:
        fail(f"{error.name or error} is not installed. Run: pip install -r backend/python/requirements.txt")

    meta = read_meta(args.model)
    if os.path.exists(args.output):
        shutil.rmtree(args.output)
    os.makedirs(args.output)

    method = args.method
    if method == "auto":
        try:
            import optimum.exporters.onnx  # noqa: F401
            method = "optimum"
        except ImportError:
            method = "torch"

    emit("status", message=f"Exporting with {method}", method=method)
    try:
        if method == "optimum":
            try:
                export_with_optimum(args.model, args.output)
            except Exception as error:  # noqa: BLE001
                # Optimum trails transformers releases; a version it does not
                # support yet should cost the faster decoder, not the export.
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
        check = verify(args.model, args.output, meta.get("source", "en"))
    except Exception as error:  # noqa: BLE001
        check = {"verified": False, "reason": f"The check could not run: {error}"}

    with open(os.path.join(args.output, "README.txt"), "w", encoding="utf-8") as handle:
        handle.write(README.format(name=meta.get("name", os.path.basename(args.model)),
                                   source=meta.get("source", "?"), target=meta.get("target", "?"),
                                   method=method, use_cache=method == "optimum"))
    # The model's own metadata belongs to the source folder, not the export.
    stale = os.path.join(args.output, META_FILE)
    if os.path.exists(stale):
        os.remove(stale)

    emit("status", message="Creating the zip")
    archive = shutil.make_archive(args.output, "zip", args.output)
    files = sorted(os.listdir(args.output))
    emit("done", method=method, files=files, archive=os.path.basename(archive),
         bytes=os.path.getsize(archive), check=check)


if __name__ == "__main__":
    main()
