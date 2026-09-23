/**
 * Reading a WAV header, without decoding the audio.
 *
 * A speech corpus is only usable if every clip agrees on its format, so the
 * folder has to be checked rather than trusted. Decoding each file to find out
 * would mean pulling an entire dataset through the browser's audio decoder to
 * learn something the first few dozen bytes already say.
 *
 * So this walks the RIFF chunks and stops at `data`. The whole check is one
 * 64 KB read per file, whatever the file's size.
 */

/*
 * Far more than a header needs, and deliberately so: a WAV written by a real
 * recorder often carries LIST/INFO, bext or iXML metadata ahead of the audio,
 * and `fmt ` and `data` sit after all of it.
 */
const SCAN_BYTES = 65_536;

/** What this dataset builder accepts, and nothing else. */
export const REQUIRED_SAMPLE_RATE = 16_000;
export const REQUIRED_CHANNELS = 1;

/** Uncompressed PCM. */
const WAVE_FORMAT_PCM = 0x0001;
/** A wrapper whose real format sits in the SubFormat GUID. */
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

const fourCC = (view, offset) => String.fromCharCode(
  view.getUint8(offset),
  view.getUint8(offset + 1),
  view.getUint8(offset + 2),
  view.getUint8(offset + 3),
);

export const isWavFile = (file) => /\.wav$/i.test(file?.name || '')
  || file?.type === 'audio/wav'
  || file?.type === 'audio/x-wav';

/**
 * @returns {Promise<object>} `{ ok }` plus sampleRate, channels, bits, format
 *   and seconds; or `{ ok: false, reason }` when the file is not a WAV at all.
 */
export const inspectWav = async (file) => {
  const header = await file.slice(0, SCAN_BYTES).arrayBuffer();
  const view = new DataView(header);

  if (view.byteLength < 12) return { ok: false, reason: 'The file is too short to be a WAV.' };
  if (fourCC(view, 0) !== 'RIFF' || fourCC(view, 8) !== 'WAVE') {
    return { ok: false, reason: 'Not a RIFF/WAVE file, whatever the extension says.' };
  }

  let offset = 12;
  let fmt = null;
  let dataSize = 0;
  let dataStart = 0;

  while (offset + 8 <= view.byteLength) {
    const id = fourCC(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (id === 'fmt ' && body + 16 <= view.byteLength) {
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        byteRate: view.getUint32(body + 8, true),
        bits: view.getUint16(body + 14, true),
      };

      // EXTENSIBLE is a container: the format that matters is the first two
      // bytes of the SubFormat GUID, 24 bytes into the chunk body. Without
      // this, ordinary 16-bit PCM written by some recorders reads as
      // "compressed" and the whole folder is refused.
      if (fmt.format === WAVE_FORMAT_EXTENSIBLE && body + 26 <= view.byteLength) {
        fmt.format = view.getUint16(body + 24, true);
      }
    }

    if (id === 'data') {
      dataStart = body;
      dataSize = size;
      break;
    }

    // Chunks are word-aligned: an odd length is followed by a pad byte that
    // the declared size does not count.
    offset = body + size + (size % 2);
  }

  if (!fmt) return { ok: false, reason: 'No fmt chunk was found in the first 64 KB.' };
  if (!fmt.sampleRate || !fmt.channels) return { ok: false, reason: 'The fmt chunk is malformed.' };

  const bytesPerSecond = fmt.byteRate || (fmt.sampleRate * fmt.channels * Math.ceil(fmt.bits / 8));

  /*
   * A streaming writer that never went back to fix its header leaves the data
   * size at 0 or at 0xFFFFFFFF, and either would give a nonsense duration. The
   * bytes actually on disk are the answer in that case.
   */
  const available = dataStart ? file.size - dataStart : Math.max(0, file.size - 44);
  const usable = dataSize > 0 && dataSize <= available ? dataSize : available;

  return {
    ok: true,
    format: fmt.format,
    channels: fmt.channels,
    sampleRate: fmt.sampleRate,
    bits: fmt.bits,
    seconds: bytesPerSecond ? usable / bytesPerSecond : 0,
    // True when the duration came from the file size rather than the header.
    estimated: !(dataSize > 0 && dataSize <= available),
  };
};

/**
 * Why this file cannot join the dataset, or '' when it can.
 *
 * Returns a reason rather than a boolean because the reason is the useful
 * part: "44100 Hz" tells somebody what to run on the folder, where "rejected"
 * sends them looking through it one file at a time.
 */
export const wavProblem = (info) => {
  if (!info?.ok) return info?.reason || 'The file could not be read.';
  if (info.format !== WAVE_FORMAT_PCM) return `Compressed WAV (format 0x${info.format.toString(16)}); only PCM is supported.`;
  if (info.sampleRate !== REQUIRED_SAMPLE_RATE) return `${info.sampleRate} Hz; 16000 Hz is required.`;
  if (info.channels !== REQUIRED_CHANNELS) {
    return `${info.channels === 2 ? 'Stereo' : `${info.channels} channels`}; mono is required.`;
  }
  return '';
};

/** mm:ss.s — clips are seconds long, so the tenth matters and the hour does not. */
export const formatSeconds = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00.0';
  const whole = Math.floor(seconds);
  const tenths = Math.floor((seconds - whole) * 10);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${tenths}`;
};
