"""Convert a Whisper model (a fine-tuned one, or a downloaded base) to a
whisper.cpp ggml-*.bin file, for the Voice recognition tab.

    python speech_ggml.py --model models/finetuned/<id> --output out.bin [--sample clip.wav]

The file layout is whisper.cpp's own (models/convert-h5-to-ggml.py in its
repository), written here directly so nothing beyond transformers is needed:
  magic "lmgg", 11 hyper-parameters, the mel filter bank, the vocabulary,
  then every tensor under the name whisper.cpp expects.
Three differences from that script, none of them visible to whisper.cpp:
  - the mel filters come from the model's own feature extractor instead of
    the openai/whisper repository's mel_filters.npz (the same numbers);
  - tensors kept in float32 are converted from the original weights, not
    rounded through float16 first;
  - special tokens are left out of the vocabulary, as in the official files.
For openai/whisper-tiny the result matches ggml-tiny.bin: identical tensors,
mel filters within 2e-9.

Always half precision (f16), like the official files. whisper.cpp's CPU
convolution requires f16 kernels and the format ties them to the file's
precision, so an all-f32 file loads and then aborts on the first clip.

With --sample, one clip is transcribed by PyTorch and by the new file
(through pywhispercpp, when installed), so the page can show they agree.
"""
import argparse
import json
import os
import struct

from ks_common import check_model, emit, fail, go_offline, read_meta
from speech_common import MAX_SECONDS, SAMPLE_RATE, prepare_whisper, read_wav

go_offline()

GGML_MAGIC = 0x67676D6C
BASE_VOCAB = 50257  # GPT-2's byte-level tokens

# Hugging Face names → whisper.cpp names, for everything inside a layer.
LAYER_NAMES = {
    "self_attn.k_proj": "attn.key",
    "self_attn.q_proj": "attn.query",
    "self_attn.v_proj": "attn.value",
    "self_attn.out_proj": "attn.out",
    "self_attn_layer_norm": "attn_ln",
    "encoder_attn.q_proj": "cross_attn.query",
    "encoder_attn.k_proj": "cross_attn.key",
    "encoder_attn.v_proj": "cross_attn.value",
    "encoder_attn.out_proj": "cross_attn.out",
    "encoder_attn_layer_norm": "cross_attn_ln",
    "fc1": "mlp.0",
    "fc2": "mlp.2",
    "final_layer_norm": "mlp_ln",
}
# …and for the rest.
TOP_NAMES = {
    "encoder.layer_norm.bias": "encoder.ln_post.bias",
    "encoder.layer_norm.weight": "encoder.ln_post.weight",
    "encoder.embed_positions.weight": "encoder.positional_embedding",
    "decoder.layer_norm.bias": "decoder.ln.bias",
    "decoder.layer_norm.weight": "decoder.ln.weight",
    "decoder.embed_positions.weight": "decoder.positional_embedding",
    "decoder.embed_tokens.weight": "decoder.token_embedding.weight",
}
# Kept in float32 even in an f16 file, as whisper.cpp expects.
FLOAT32_NAMES = {"encoder.conv1.bias", "encoder.conv2.bias", "encoder.positional_embedding",
                 "decoder.positional_embedding"}


def bytes_to_unicode():
    """GPT-2's byte ↔ printable-character table, which vocab.json keys are written in."""
    bs = list(range(ord("!"), ord("~") + 1)) + list(range(ord("¡"), ord("¬") + 1)) + list(range(ord("®"), ord("ÿ") + 1))
    cs = bs[:]
    n = 0
    for b in range(256):
        if b not in bs:
            bs.append(b)
            cs.append(256 + n)
            n += 1
    return dict(zip(bs, (chr(c) for c in cs)))


def ggml_name(hf_name):
    """model.encoder.layers.3.fc1.weight → encoder.blocks.3.mlp.0.weight; None to leave out."""
    if hf_name == "proj_out.weight":
        return None  # Tied to the token embedding; whisper.cpp reuses that.
    parts = hf_name.split(".")[1:]  # drop "model."
    if len(parts) > 3 and parts[1] == "layers":
        inner = ".".join(parts[3:-1])
        if inner not in LAYER_NAMES:
            raise ValueError(f"unexpected tensor {hf_name}")
        return ".".join([parts[0], "blocks", parts[2], LAYER_NAMES[inner], parts[-1]])
    name = ".".join(parts)
    return TOP_NAMES.get(name, name)


def read_vocab(model_dir):
    """{token: id} of the byte-level BPE vocabulary.

    Downloaded models have vocab.json. Models saved by transformers 5 (every
    model trained here) have only tokenizer.json, which holds the same table
    under model.vocab.
    """
    vocab_file = os.path.join(model_dir, "vocab.json")
    if os.path.exists(vocab_file):
        with open(vocab_file, encoding="utf-8") as handle:
            return json.load(handle)
    tokenizer_file = os.path.join(model_dir, "tokenizer.json")
    if not os.path.exists(tokenizer_file):
        raise ValueError("the model folder has neither vocab.json nor tokenizer.json")
    with open(tokenizer_file, encoding="utf-8") as handle:
        tokenizer = json.load(handle)
    vocab = (tokenizer.get("model") or {}).get("vocab")
    if not isinstance(vocab, dict):
        raise ValueError("tokenizer.json has no BPE vocabulary")
    return vocab


def convert(model_dir, output):
    import numpy as np
    import torch
    from transformers import WhisperForConditionalGeneration, WhisperProcessor

    with open(os.path.join(model_dir, "config.json"), encoding="utf-8") as handle:
        config = json.load(handle)
    vocab = read_vocab(model_dir)

    model = WhisperForConditionalGeneration.from_pretrained(model_dir, local_files_only=True, dtype=torch.float32)
    # Through the processor: transformers 5 saves the feature extractor inside
    # processor_config.json rather than as preprocessor_config.json.
    # (n_fft / 2 + 1, n_mels) in transformers; whisper.cpp wants (n_mels, n_fft / 2 + 1).
    extractor = WhisperProcessor.from_pretrained(model_dir, local_files_only=True).feature_extractor
    filters = np.asarray(extractor.mel_filters, dtype=np.float32).T
    n_mels = config["num_mel_bins"]
    if filters.shape[0] != n_mels:
        raise ValueError(f"the feature extractor has {filters.shape[0]} mel bins, the model {n_mels}")

    decoder = bytes_to_unicode()
    decoder = {char: byte for byte, char in decoder.items()}
    state = model.state_dict()
    tensors = [(name, ggml_name(name)) for name in state]
    tensors = [(source, target) for source, target in tensors if target]

    with open(output, "wb") as out:
        out.write(struct.pack("i", GGML_MAGIC))
        for value in (
            config["vocab_size"],
            config["max_source_positions"],   # n_audio_ctx
            config["d_model"],                # n_audio_state
            config["encoder_attention_heads"],
            config["encoder_layers"],
            config["max_target_positions"],   # n_text_ctx
            config["d_model"],                # n_text_state
            config["decoder_attention_heads"],
            config["decoder_layers"],
            n_mels,
            1,  # f16
        ):
            out.write(struct.pack("i", int(value)))

        out.write(struct.pack("ii", *filters.shape))
        out.write(np.ascontiguousarray(filters, dtype="<f4").tobytes())

        # The byte-level vocabulary only: ids from 50257 on are special tokens
        # (<|endoftext|> in multilingual models, then <|en|> …), which
        # whisper.cpp numbers itself. Official ggml files hold exactly these.
        words = sorted(((token, index) for token, index in vocab.items() if index < BASE_VOCAB), key=lambda item: item[1])
        out.write(struct.pack("i", len(words)))
        for token, _ in words:
            text = bytes(decoder[char] for char in token)
            out.write(struct.pack("i", len(text)))
            out.write(text)

        for index, (source, name) in enumerate(tensors):
            data = state[source].detach().squeeze().cpu().numpy()
            if name in ("encoder.conv1.bias", "encoder.conv2.bias"):
                data = data.reshape(data.shape[0], 1)
            f16 = data.ndim >= 2 and name not in FLOAT32_NAMES
            data = data.astype("<f2" if f16 else "<f4")
            encoded = name.encode("utf-8")
            out.write(struct.pack("iii", data.ndim, len(encoded), 1 if f16 else 0))
            for dim in reversed(data.shape):
                out.write(struct.pack("i", dim))
            out.write(encoded)
            out.write(np.ascontiguousarray(data).tobytes())
            if index % 20 == 0:
                emit("status", message=f"Writing tensors ({index + 1}/{len(tensors)})")

    return {"tensors": len(tensors), "vocab": len(words), "nVocab": config["vocab_size"],
            "englishOnly": config["vocab_size"] < 51865}


def verify(model_dir, output, language, sample):
    """Transcribe one clip with PyTorch and with the new ggml file."""
    if not sample or not os.path.exists(sample):
        return {"verified": False, "reason": "No sample clip was available to test-run the file."}
    try:
        from pywhispercpp.model import Model
    except ImportError:
        return {"verified": False, "reason": "pywhispercpp is not installed, so the file was not test-run."}

    import torch
    from transformers import WhisperForConditionalGeneration, WhisperProcessor

    samples = read_wav(sample)[: MAX_SECONDS * SAMPLE_RATE]
    processor = WhisperProcessor.from_pretrained(model_dir, local_files_only=True)
    model = WhisperForConditionalGeneration.from_pretrained(model_dir, local_files_only=True).float().eval()
    generate_args = prepare_whisper(processor, model, language)
    features = processor.feature_extractor(samples, sampling_rate=SAMPLE_RATE, return_tensors="pt").input_features
    with torch.no_grad():
        ids = model.generate(features, num_beams=1, do_sample=False, max_new_tokens=128, **generate_args)
    torch_text = processor.batch_decode(ids, skip_special_tokens=True)[0].strip()

    ggml = Model(output, redirect_whispercpp_logs_to=None, print_progress=False, print_realtime=False)
    segments = ggml.transcribe(samples, language=language or "auto", no_context=True)
    ggml_text = " ".join(segment.text.strip() for segment in segments).strip()

    def words(text):
        return [word.strip(".,!?;:\"'").lower() for word in text.split() if word.strip(".,!?;:\"'")]

    return {"verified": True, "input": os.path.basename(sample), "converted": ggml_text, "pytorch": torch_text,
            "match": words(ggml_text) == words(torch_text)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--sample")
    args = parser.parse_args()

    check_model(args.model)
    meta = read_meta(args.model)
    language = meta.get("language") or ""

    emit("status", message="Converting to ggml")
    try:
        info = convert(args.model, args.output)
    except Exception as error:  # noqa: BLE001 — reported to the page
        if os.path.exists(args.output):
            os.remove(args.output)
        fail(f"Conversion to ggml failed: {error}")

    emit("status", message="Checking the ggml file")
    try:
        check = verify(args.model, args.output, language, args.sample)
    except Exception as error:  # noqa: BLE001
        check = {"verified": False, "reason": f"The check could not run: {error}"}

    emit("done", bytes=os.path.getsize(args.output), language=language, check=check, **info)


if __name__ == "__main__":
    main()
