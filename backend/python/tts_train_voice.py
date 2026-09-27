"""Train a Supertonic voice that sounds like the speaker of a Speech to Text dataset.

    python tts_train_voice.py --data datasets/speech/<id> --language en \
        --model models/base/supertonic-3 --ecapa models/base/spkrec-ecapa-voxceleb \
        --base-voice auto --steps 300 --output models/finetuned/<id>.partial

Supertonic is released as ONNX models only, with no training code, so the
model itself cannot be fine-tuned. What can be trained is a voice: the
50 x 256 style vector (style_ttl) a voice_styles/*.json file holds. The four
models are converted to PyTorch (onnx2torch) and frozen; speech is made from
the dataset's own transcripts, turned into a voiceprint by ECAPA-TDNN (the
Speaker recognition model), and the style is moved by gradient descent until
that voiceprint matches the voiceprint of the dataset's recordings. The
rhythm vector (style_dp) is kept from the starting voice. This is the method
of Kim (2026), "Extracting Voice Styles from Frozen TTS Models via
Gradient-Based Inverse Optimization", as implemented in
github.com/saurabhv749/supertonic3-voice-clone (MIT).

Written to --output: voice.json (a Supertonic voice style, usable like F1.json)
and target.json (the recordings' voiceprint, which the Test section scores
speech against). Progress is JSON lines; the similarity to the recordings is
measured on held-out sentences with the starting voice and with the trained one.
"""
import argparse
import json
import os
import random
import sys
import time

from ks_common import check_model, describe_device, emit, fail, go_offline, pick_device
from speech_common import load_clips

go_offline()

# Clips used for the target voiceprint, and speech per clip read; plenty for a mean.
MAX_TARGET_CLIPS = 60
MIN_SPEECH_SECONDS = 3.0
# Training sentences are kept short: every step makes their speech and back-propagates through it.
MAX_TEXT_CHARS = 110
MAX_TEXTS = 32
EVAL_TEXTS = 3


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--language", required=True)
    parser.add_argument("--model", required=True, help="the Supertonic model folder")
    parser.add_argument("--ecapa", required=True, help="the ECAPA-TDNN speaker model folder")
    parser.add_argument("--base-voice", default="auto", help="auto, or a voice of the model (F1 … M5) to start from")
    parser.add_argument("--steps", type=int, default=300)
    parser.add_argument("--learning-rate", type=float, default=0.003)
    parser.add_argument("--denoise-steps", type=int, default=4, help="flow-matching steps in each training pass")
    parser.add_argument("--speed", type=float, default=1.05)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", default="auto", help="auto, cpu, cuda, cuda:N or mps")
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def to_torch(onnx_path, device):
    """An ONNX model as a frozen PyTorch module (the same conversion the reference implementation makes)."""
    import onnx
    import onnx2torch
    import onnxslim
    from onnx import shape_inference

    # onnx2torch's own shape inference writes temporary files; in memory is enough.
    onnx2torch.converter.safe_shape_inference = (
        lambda model: shape_inference.infer_shapes(onnx.load(model) if isinstance(model, str) else model))
    model = onnxslim.slim(onnx_path)
    for opset in model.opset_import:
        if opset.domain in ("", "ai.onnx"):
            opset.version = 17
    # Clip nodes with empty trailing inputs are rejected by the converter.
    for node in model.graph.node:
        if node.op_type == "Clip":
            inputs = list(node.input)
            while inputs and inputs[-1] == "":
                inputs.pop()
            del node.input[:]
            node.input.extend(inputs)
    module = onnx2torch.convert(model).eval()
    for parameter in module.parameters():
        parameter.requires_grad_(False)
    return module.to(device)


def main():
    args = parse_args()
    check_model(args.model)
    check_model(args.ecapa)
    started = time.time()

    try:
        import numpy as np
        import onnxruntime as ort
        import torch
        import torchaudio.functional as audio_functional
        import onnx2torch  # noqa: F401
        import onnxslim  # noqa: F401
    except ImportError as error:
        fail(f"{error.name or error} is not installed. Run: pip install -r backend/python/requirements.txt")

    from speaker_common import load_ecapa, read_wav, speech_only
    from tts_worker import LANGUAGES, SHORT_PIECES, Supertonic, pieces

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    ort.set_default_logger_severity(3)

    supertonic = Supertonic(args.model, ort, np)
    language = args.language.lower().split("-")[0].split("_")[0]
    if language not in LANGUAGES:
        fail(f'Supertonic cannot read "{args.language}". Train on a dataset in one of: {", ".join(LANGUAGES)}.')

    # ---- The recordings: their voiceprint is the target.
    clips = load_clips(args.data)
    if not clips:
        fail("The dataset has no transcribed clips.")
    device = pick_device(args.device)
    emit("status", message=f"Reading the recordings on {describe_device(device)}", device=device.type)
    features, normalize, ecapa = load_ecapa(args.ecapa)
    ecapa = ecapa.to(device)
    for parameter in ecapa.parameters():
        parameter.requires_grad_(False)
    ones = torch.ones(1, device=device)

    def voiceprint(wave16k):
        """ECAPA voiceprint of a [1, samples] 16 kHz tensor, unit length; differentiable."""
        embedding = ecapa(normalize(features(wave16k), ones), ones).reshape(-1)
        return torch.nn.functional.normalize(embedding, dim=0)

    prints, speech_seconds = [], 0.0
    for path, _ in random.sample(clips, min(len(clips), MAX_TARGET_CLIPS)):
        try:
            voiced, seconds = speech_only(read_wav(path))
        except ValueError:
            continue
        if seconds < 0.5:
            continue
        with torch.no_grad():
            prints.append(voiceprint(torch.tensor(voiced, device=device)[None]))
        speech_seconds += seconds
    if speech_seconds < MIN_SPEECH_SECONDS:
        fail(f"The recordings hold {speech_seconds:.1f} s of speech; at least {MIN_SPEECH_SECONDS:.0f} s is needed "
             "(30 s or more gives a better likeness).")
    target = torch.nn.functional.normalize(torch.stack(prints).mean(dim=0), dim=0)
    # How alike the recordings are to each other: the best a voice could hope to score.
    consistency = float(torch.stack([p @ target for p in prints]).mean())

    # ---- The sentences: the dataset's own transcripts, in short pieces.
    max_len = 60 if language in SHORT_PIECES else MAX_TEXT_CHARS
    texts = []
    for _, transcript in clips:
        texts.extend(part for part, _ in pieces(transcript, max_len))
    texts = list(dict.fromkeys(text for text in texts if len(text) >= 8))
    random.shuffle(texts)
    if len(texts) < 2:
        fail("The transcripts are too short to train on; the dataset needs a few sentences.")
    held = texts[:EVAL_TEXTS] if len(texts) > EVAL_TEXTS + 1 else texts[:1]
    training = [text for text in texts if text not in held][:MAX_TEXTS] or held
    dropped = set()
    encoded = {text: supertonic.prepare(text, language, dropped) for text in held + training}

    emit("status", message="Converting Supertonic to PyTorch")
    onnx_dir = os.path.join(args.model, "onnx")
    encoder = to_torch(os.path.join(onnx_dir, "text_encoder.onnx"), device)
    estimator = to_torch(os.path.join(onnx_dir, "vector_estimator.onnx"), device)
    vocoder = to_torch(os.path.join(onnx_dir, "vocoder.onnx"), device)

    # Each sentence gets one fixed starting noise and length, so a step's loss
    # changes because the voice changed, not because the dice did.
    plans = {}

    def plan(text, voice_dp):
        if text not in plans:
            ids = np.array([encoded[text]], dtype=np.int64)
            mask = np.ones((1, 1, ids.shape[1]), dtype=np.float32)
            duration = supertonic.duration.run(None, {"text_ids": ids, "style_dp": voice_dp, "text_mask": mask})[0]
            samples = int(float(duration[0]) / args.speed * supertonic.sample_rate)
            length = max(1, (samples + supertonic.chunk - 1) // supertonic.chunk)
            generator = torch.Generator().manual_seed(args.seed + len(plans))
            plans[text] = {
                "ids": torch.tensor(ids, device=device),
                "mask": torch.tensor(mask, device=device),
                "noise": torch.randn(1, supertonic.latent_dim, length, generator=generator).to(device),
                "latent_mask": torch.ones(1, 1, length, device=device),
                "samples": samples,
            }
        return plans[text]

    def speak(text, style_ttl, voice_dp, steps):
        """The sentence spoken in style_ttl, as a [1, samples] 44.1 kHz tensor; differentiable."""
        item = plan(text, voice_dp)
        embedded = encoder(item["ids"], style_ttl, item["mask"])
        latent = item["noise"]
        total = torch.tensor([float(steps)], device=device)
        for step in range(steps):
            latent = estimator(latent, embedded, style_ttl, item["latent_mask"], item["mask"],
                               torch.tensor([float(step)], device=device), total)
        return vocoder(latent).reshape(1, -1)[:, :item["samples"]]

    def similarity(text, style_ttl, voice_dp, steps):
        wave = speak(text, style_ttl, voice_dp, steps)
        return voiceprint(audio_functional.resample(wave, supertonic.sample_rate, 16000)) @ target

    def score(style_ttl, voice_dp):
        """Mean similarity to the recordings on the held-out sentences, at the page's standard quality (8 steps)."""
        with torch.no_grad():
            return float(np.mean([float(similarity(text, style_ttl, voice_dp, 8)) for text in held]))

    # ---- The starting voice: the given one, or the one already most like the recordings.
    voices = sorted(name[:-5] for name in os.listdir(os.path.join(args.model, "voice_styles")) if name.endswith(".json"))
    if args.base_voice != "auto" and args.base_voice not in voices:
        fail(f"{args.base_voice} is not a voice of this model ({', '.join(voices)}).")
    candidates = voices if args.base_voice == "auto" else [args.base_voice]
    ranking = {}
    for name in candidates:
        voice = supertonic.voice(name)
        emit("status", message=f"Comparing the voice {name} with the recordings")
        ranking[name] = score(torch.tensor(voice.ttl, device=device), voice.dp)
    base_voice = max(ranking, key=ranking.get)
    voice = supertonic.voice(base_voice)
    style_dp = voice.dp
    before = ranking[base_voice]
    emit("status", message=f"Starting from {base_voice} (similarity {before:.3f})", baseVoice=base_voice,
         ranking={name: round(value, 4) for name, value in ranking.items()})

    # ---- Training: only style_ttl moves.
    style_ttl = torch.tensor(voice.ttl, device=device).clone().requires_grad_(True)
    optimizer = torch.optim.Adam([style_ttl], lr=args.learning_rate)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, factor=0.5, patience=40,
                                                           min_lr=args.learning_rate * 0.05)
    emit("start", totalSteps=args.steps, epochs=max(1, args.steps // 50))
    best, best_ttl = float("inf"), style_ttl.detach().clone()
    history, window = [], []
    train_started = time.time()
    last_report = 0.0
    for step in range(1, args.steps + 1):
        text = training[(step - 1) % len(training)]
        loss = 1 - similarity(text, style_ttl, style_dp, args.denoise_steps)
        if not torch.isfinite(loss):
            fail(f"Training diverged at step {step}. Nothing was saved. Try a lower learning rate.")
        optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_([style_ttl], 1.0)
        optimizer.step()
        value = float(loss)
        window.append(value)
        # The best voice is judged on a running mean: one sentence's loss says little alone.
        mean = float(np.mean(window[-len(training):]))
        scheduler.step(mean)
        if step >= min(len(training), 8) and mean < best:
            best, best_ttl = mean, style_ttl.detach().clone()
        if time.time() - last_report > 0.5 or step == args.steps:
            last_report = time.time()
            elapsed = time.time() - train_started
            emit("progress", step=step, totalSteps=args.steps, epoch=(step - 1) // 50 + 1, loss=round(mean, 4),
                 similarity=round(1 - mean, 4), etaSeconds=round(elapsed / step * (args.steps - step)))
        if step % 50 == 0 or step == args.steps:
            entry = {"epoch": step, "trainLoss": round(mean, 4), "similarity": round(1 - mean, 4)}
            history.append(entry)
            emit("epoch", **entry)

    # ---- The result, judged the way the page will use it.
    emit("status", message="Measuring the trained voice")
    after = score(best_ttl, style_dp)
    if after < before:
        # Training made it less alike on sentences it never saw: keep the starting voice's style.
        emit("status", message=f"The trained voice scored {after:.3f}, below {base_voice}'s {before:.3f}; keeping {base_voice}")
        best_ttl, after = torch.tensor(voice.ttl, device=device), before
    samples = []
    with torch.no_grad():
        start_ttl = torch.tensor(voice.ttl, device=device)
        for text in held:
            samples.append({
                "source": text,
                "reference": base_voice,
                "before": round(float(similarity(text, start_ttl, style_dp, 8)), 3),
                "after": round(float(similarity(text, best_ttl, style_dp, 8)), 3),
            })
    emit("samples", samples=samples)

    os.makedirs(args.output, exist_ok=True)
    ttl = best_ttl.detach().cpu().numpy().astype(np.float32)
    with open(os.path.join(args.output, "voice.json"), "w", encoding="utf-8") as handle:
        json.dump({
            "style_ttl": {"data": ttl.tolist(), "dims": list(ttl.shape), "type": "float32"},
            "style_dp": {"data": style_dp.tolist(), "dims": list(style_dp.shape), "type": "float32"},
            "metadata": {"baseVoice": base_voice, "language": language, "trainedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
        }, handle)
    with open(os.path.join(args.output, "target.json"), "w", encoding="utf-8") as handle:
        json.dump({"embedding": [round(float(value), 6) for value in target.cpu()], "clips": len(prints),
                   "speechSeconds": round(speech_seconds, 1)}, handle)

    emit("done", history=history, baseVoice=base_voice, ranking={name: round(value, 4) for name, value in ranking.items()},
         similarityBefore=round(before, 4), similarityAfter=round(after, 4), consistency=round(consistency, 4),
         clips=len(prints), speechSeconds=round(speech_seconds, 1), trainTexts=len(training),
         dropped="".join(sorted(char for char in dropped if not char.isspace()))[:40],
         final={"similarity": round(after, 3)}, seconds=round(time.time() - started), device=device.type)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
