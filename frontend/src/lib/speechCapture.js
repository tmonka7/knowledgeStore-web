/*
 * Audio for voice recognition: the microphone, or a file, turned into the
 * 16 kHz mono 16-bit WAV that whisper.cpp reads.
 *
 * Everything is done here in the browser — decoding (mp3, m4a, ogg, webm, the
 * sound of a video …), mixing to mono and resampling — so the server receives
 * one plain format and needs no ffmpeg.
 */

export const TARGET_RATE = 16000;

/** Mono float samples → 16 kHz 16-bit PCM WAV. The browser's own resampler does the work. */
export async function encodeWav16k(samples, sampleRate) {
  let audio = samples;
  if (sampleRate !== TARGET_RATE && samples.length) {
    const length = Math.max(1, Math.ceil((samples.length * TARGET_RATE) / sampleRate));
    const offline = new OfflineAudioContext(1, length, TARGET_RATE);
    const buffer = offline.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start();
    audio = (await offline.startRendering()).getChannelData(0);
  }

  const view = new DataView(new ArrayBuffer(44 + audio.length * 2));
  const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + audio.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, TARGET_RATE, true);
  view.setUint32(28, TARGET_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, audio.length * 2, true);
  for (let i = 0; i < audio.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, audio[i]));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return { blob: new Blob([view], { type: 'audio/wav' }), seconds: audio.length / TARGET_RATE };
}

/** Any audio (or video) file the browser can decode → 16 kHz mono WAV. */
export async function fileToWav16k(file) {
  const context = new AudioContext();
  try {
    let decoded;
    try {
      decoded = await context.decodeAudioData(await file.arrayBuffer());
    } catch {
      throw new Error('This browser cannot decode that file. Try WAV, MP3, M4A, OGG or WebM.');
    }
    const mono = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const data = decoded.getChannelData(channel);
      for (let i = 0; i < data.length; i += 1) mono[i] += data[i] / decoded.numberOfChannels;
    }
    return encodeWav16k(mono, decoded.sampleRate);
  } finally {
    context.close();
  }
}

// Batches the 128-sample blocks the audio thread delivers into ~40 ms pieces.
const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(2048); this.filled = 0; }
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const channels = input.length;
      for (let i = 0; i < input[0].length; i += 1) {
        let sum = 0;
        for (let c = 0; c < channels; c += 1) sum += input[c][i];
        this.buffer[this.filled++] = sum / channels;
        if (this.filled === this.buffer.length) {
          this.port.postMessage(this.buffer.slice(0));
          this.filled = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('ks-tap', Tap);
`;

const concat = (chunks) => {
  const out = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

/**
 * Listen to the microphone.
 *
 *   onLevel(0..1)            — loudness, for a meter, ~25 times a second
 *   onPhrase(samples, rate)  — live mode: each stretch of speech once a pause
 *                              ends it (or it reaches maxPhraseSeconds)
 *
 * Resolves to { stop }: stop() ends the recording and resolves to
 * { samples, sampleRate } — everything heard (in live mode, only what was
 * not yet passed to onPhrase).
 */
export async function openMicrophone({
  onLevel, onPhrase, live = false, pauseSeconds = 0.8, maxPhraseSeconds = 20,
} = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('The microphone needs a secure page: open the app over https (or on localhost).');
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  } catch (error) {
    throw new Error(error?.name === 'NotAllowedError'
      ? 'Microphone access was refused. Allow it in the browser (the icon in the address bar) and try again.'
      : `The microphone could not be opened (${error?.message || error}).`);
  }

  const context = new AudioContext();
  const moduleUrl = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
  try {
    await context.audioWorklet.addModule(moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
  const source = context.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(context, 'ks-tap');
  // Connected through a silent gain so the graph runs without playing the voice back.
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(tap).connect(mute).connect(context.destination);

  const rate = context.sampleRate;
  let all = [];
  // Voice detection for live mode: a phrase starts when the level rises well
  // above the room's noise floor, and ends after `pauseSeconds` below it.
  let noise = 0.005;
  let phrase = null; // { chunks, samples, lastVoice }
  let preroll = [];
  let heard = 0;

  tap.port.onmessage = ({ data: chunk }) => {
    let sum = 0;
    for (let i = 0; i < chunk.length; i += 1) sum += chunk[i] * chunk[i];
    const rms = Math.sqrt(sum / chunk.length);
    onLevel?.(Math.min(1, rms * 8));
    heard += chunk.length;

    if (!live) {
      all.push(chunk);
      return;
    }
    const threshold = Math.max(0.015, noise * 3);
    const voiced = rms > threshold;
    if (!voiced && !phrase) noise = noise * 0.95 + rms * 0.05;

    if (!phrase) {
      preroll.push(chunk);
      // Keep ~0.3 s before the voice starts, or the first syllable is clipped.
      while (preroll.length > Math.ceil((0.3 * rate) / chunk.length)) preroll.shift();
      if (voiced) {
        phrase = { chunks: [...preroll], samples: preroll.reduce((n, c) => n + c.length, 0), lastVoice: heard };
        preroll = [];
      }
      return;
    }
    phrase.chunks.push(chunk);
    phrase.samples += chunk.length;
    if (voiced) phrase.lastVoice = heard;
    const paused = heard - phrase.lastVoice > pauseSeconds * rate;
    if (paused || phrase.samples > maxPhraseSeconds * rate) {
      const done = phrase;
      phrase = null;
      // Mostly silence (a cough, a click): not worth sending.
      if (done.samples > 0.5 * rate) onPhrase?.(concat(done.chunks), rate);
    }
  };

  const stop = async () => {
    tap.port.onmessage = null;
    stream.getTracks().forEach((track) => track.stop());
    await context.close();
    const rest = live ? (phrase ? phrase.chunks : []) : all;
    all = [];
    onLevel?.(0);
    return { samples: concat(rest), sampleRate: rate };
  };

  return { stop, sampleRate: rate };
}
