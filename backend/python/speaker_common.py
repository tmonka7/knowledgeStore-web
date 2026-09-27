"""What speaker_worker.py and speaker_export.py share: reading a clip, keeping
only its speech, and building ECAPA-TDNN from a downloaded model folder.

The model is built from its hyperparams.yaml and embedding_model.ckpt
directly. SpeechBrain's own loader (EncoderClassifier.from_hparams) asks the
Hugging Face Hub for the files even when given a local folder, so it fails
offline; this gives the identical embedding (checked: max difference 0.0)
without the network.
"""
import os
import wave

SAMPLE_RATE = 16000
MAX_SECONDS = 120
FRAME = 480  # 30 ms


def read_wav(path):
    """A PCM WAV as mono float32 at 16 kHz (the page sends exactly that)."""
    import numpy as np

    try:
        with wave.open(path, "rb") as handle:
            channels, width, rate = handle.getnchannels(), handle.getsampwidth(), handle.getframerate()
            frames = handle.readframes(handle.getnframes())
    except (wave.Error, EOFError) as error:
        raise ValueError(f"not a PCM WAV file ({str(error) or 'it is cut short'})") from error
    if width == 2:
        audio = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768
    elif width == 4:
        audio = np.frombuffer(frames, dtype="<i4").astype(np.float32) / 2147483648
    else:
        raise ValueError(f"{width * 8}-bit WAV is not supported; send 16-bit PCM")
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    if rate != SAMPLE_RATE and audio.size:
        length = int(round(audio.size * SAMPLE_RATE / rate))
        audio = np.interp(np.linspace(0, audio.size - 1, length), np.arange(audio.size), audio).astype(np.float32)
    return audio[: MAX_SECONDS * SAMPLE_RATE]


def speech_only(audio):
    """The clip without its silent stretches, and how much speech that left.

    A voiceprint of a clip that is half silence is half a voiceprint of the
    room. 30 ms frames count as speech when they are within 30 dB of the
    loudest part; gaps shorter than 0.3 s are kept so words are not chopped.
    """
    import numpy as np

    frames = audio.size // FRAME
    if frames == 0:
        return audio, 0.0
    energy = np.sqrt((audio[: frames * FRAME].reshape(frames, FRAME) ** 2).mean(axis=1) + 1e-12)
    loud = energy > max(energy.max() * 10 ** (-30 / 20), 1e-3)
    keep = loud.copy()
    bridge = int(0.3 * SAMPLE_RATE / FRAME)
    last = None
    for index in np.flatnonzero(loud):
        if last is not None and 1 < index - last <= bridge:
            keep[last:index] = True
        last = index
    if not keep.any():
        return audio[:0], 0.0
    voiced = audio[: frames * FRAME].reshape(frames, FRAME)[keep].reshape(-1)
    return voiced, float(loud.sum() * FRAME / SAMPLE_RATE)


def load_ecapa(folder):
    """(compute_features, mean_var_norm, embedding_model) of a model folder, in eval mode.

    embedding_model(mean_var_norm(compute_features(wav), lengths), lengths) is
    the voiceprint of a [batch, samples] float32 16 kHz clip; lengths are
    relative (all ones for whole clips).
    """
    import torch
    from hyperpyyaml import load_hyperpyyaml

    with open(os.path.join(folder, "hyperparams.yaml"), encoding="utf-8") as handle:
        # pretrained_path pointed at the local folder: nothing is fetched.
        hparams = load_hyperpyyaml(handle, overrides={"pretrained_path": folder.replace("\\", "/")})
    embedding = hparams["embedding_model"]
    embedding.load_state_dict(torch.load(os.path.join(folder, "embedding_model.ckpt"), map_location="cpu"))
    embedding.eval()
    return hparams["compute_features"], hparams["mean_var_norm"], embedding
