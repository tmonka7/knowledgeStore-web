// Helpers for the Text to Speech page (pages/TextToSpeechPage.jsx): the text
// split into the parts sent to the server one at a time, and the WAV files
// that come back joined into one.

/**
 * The text as parts of at most `max` characters, split between paragraphs,
 * then between sentences, then at spaces. The first part is kept short, so
 * the first words play within a second or two while the rest is read.
 */
export const splitForSpeech = (text, max = 600, first = 200) => {
  const parts = [];
  const paragraphs = String(text || '').split(/\n\s*\n+/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  paragraphs.forEach((paragraph, index) => {
    // Sentence ends: . ! ? followed by a space, or their full-width forms.
    const sentences = paragraph.match(/[^.!?。！？]+(?:[.!?]+(?=\s|$)|[。！？]+|$)\s*/g) || [paragraph];
    let current = '';
    const push = () => {
      if (current.trim()) parts.push({ text: current.trim(), paragraphEnd: false });
      current = '';
    };
    sentences.forEach((sentence) => {
      const limit = parts.length ? max : first;
      if (current && current.length + sentence.length > limit) push();
      if (sentence.length > max) {
        // One very long sentence: at spaces, or anywhere in text without them.
        const words = sentence.includes(' ') ? sentence.split(/(?<=\s)/) : sentence.match(new RegExp(`.{1,${max}}`, 'gs'));
        words.forEach((word) => {
          if (current && current.length + word.length > max) push();
          current += word;
        });
      } else {
        current += sentence;
      }
    });
    push();
    if (parts.length && index < paragraphs.length - 1) parts[parts.length - 1].paragraphEnd = true;
  });
  return parts;
};

const fourCC = (view, offset) => String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(offset + i)));

/** A PCM WAV file's format and samples: { sampleRate, channels, bits, data: Uint8Array }. */
export const readWav = (buffer) => {
  const view = new DataView(buffer);
  if (buffer.byteLength < 12 || fourCC(view, 0) !== 'RIFF' || fourCC(view, 8) !== 'WAVE') throw new Error('Not a WAV file.');
  let format = null;
  for (let offset = 12; offset + 8 <= buffer.byteLength;) {
    const id = fourCC(view, offset);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      format = { channels: view.getUint16(offset + 10, true), sampleRate: view.getUint32(offset + 12, true), bits: view.getUint16(offset + 22, true) };
    } else if (id === 'data' && format) {
      return { ...format, data: new Uint8Array(buffer, offset + 8, Math.min(size, buffer.byteLength - offset - 8)) };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('The WAV file has no audio.');
};

/** Seconds of audio in a WAV file. */
export const wavSeconds = (buffer) => {
  const wav = readWav(buffer);
  return wav.data.length / (wav.sampleRate * wav.channels * (wav.bits / 8));
};

/**
 * WAV files of one format joined into one, with `pauses[i]` seconds of
 * silence after the i-th.
 */
export const joinWavs = (buffers, pauses = []) => {
  const wavs = buffers.map(readWav);
  const { sampleRate, channels, bits } = wavs[0];
  const frame = channels * (bits / 8);
  const silence = (seconds) => Math.round((seconds || 0) * sampleRate) * frame;
  const length = wavs.reduce((sum, wav, i) => sum + wav.data.length + (i < wavs.length - 1 ? silence(pauses[i]) : 0), 0);
  const out = new Uint8Array(44 + length);
  const view = new DataView(out.buffer);
  const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * frame, true);
  view.setUint16(32, frame, true);
  view.setUint16(34, bits, true);
  text(36, 'data');
  view.setUint32(40, length, true);
  let at = 44;
  wavs.forEach((wav, i) => {
    if (wav.sampleRate !== sampleRate || wav.channels !== channels || wav.bits !== bits) throw new Error('The parts differ in format.');
    out.set(wav.data, at);
    at += wav.data.length + (i < wavs.length - 1 ? silence(pauses[i]) : 0); // silence is already zeros
  });
  return new Blob([out], { type: 'audio/wav' });
};
