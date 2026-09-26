// Audio and video conversion jobs for Tools > Converting.
//
// An upload becomes a job: ffmpeg runs in the background with "-progress" on
// stdout, and the page polls the job for how far it has got. The finished file
// stays in a temp folder for a while so it can be previewed and downloaded
// (natively, through an unguessable link) and is then deleted.
//
// Every ffmpeg argument is built here from whitelisted settings and passed to
// spawn() as an array — no shell, and nothing from the request reaches the
// command line except numbers that have been clamped.

import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export class ConvertError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const envNumber = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const MAX_UPLOAD_MB = envNumber('CONVERT_MAX_UPLOAD_MB', 1024);
const MAX_RUNNING = envNumber('CONVERT_MAX_JOBS', 2);
const TIMEOUT_MS = envNumber('CONVERT_TIMEOUT_MINUTES', 60) * 60 * 1000;
const KEEP_MS = envNumber('CONVERT_KEEP_MINUTES', 60) * 60 * 1000;
const MAX_JOBS_PER_USER = 20;
const WORK_DIR = path.join(os.tmpdir(), 'ks-convert');

/* ------------------------------------------------------------------ codecs */

// Speed choices shown to the user, fastest first; each encoder maps them onto
// its own knob.
const SPEEDS = ['fastest', 'fast', 'medium', 'slow', 'slowest'];
const X26X_PRESETS = { fastest: 'ultrafast', fast: 'veryfast', medium: 'medium', slow: 'slow', slowest: 'veryslow' };
const VPX_CPU_USED = { fastest: 8, fast: 5, medium: 3, slow: 1, slowest: 0 };
const AOM_CPU_USED = { fastest: 8, fast: 7, medium: 6, slow: 4, slowest: 2 };
const SVT_PRESETS = { fastest: 12, fast: 10, medium: 8, slow: 6, slowest: 4 };

/**
 * Video codecs. `encoders` lists what ffmpeg may call it, best first; the
 * first one the installed ffmpeg has is used. `crf` is the constant-quality
 * scale (lower is better) with its default.
 */
const VIDEO_CODECS = {
  h264: { label: 'H.264 / AVC', encoders: ['libx264'], crf: { min: 0, max: 51, default: 23 }, bitrate: 4000 },
  h265: { label: 'H.265 / HEVC', encoders: ['libx265'], crf: { min: 0, max: 51, default: 28 }, bitrate: 2500 },
  vp9: { label: 'VP9', encoders: ['libvpx-vp9'], crf: { min: 0, max: 63, default: 32 }, bitrate: 2500 },
  vp8: { label: 'VP8', encoders: ['libvpx'], crf: { min: 4, max: 63, default: 10 }, bitrate: 3000 },
  av1: { label: 'AV1', encoders: ['libsvtav1', 'libaom-av1'], crf: { min: 0, max: 63, default: 32 }, bitrate: 2000 },
  mpeg4: { label: 'MPEG-4 Part 2 (Xvid)', encoders: ['mpeg4'], crf: { min: 1, max: 31, default: 4 }, bitrate: 5000, noSpeed: true },
  gif: { label: 'GIF', encoders: ['gif'], noQuality: true, noSpeed: true },
};

/** Audio codecs; `bitrate` is null for lossless ones. */
const AUDIO_CODECS = {
  aac: { label: 'AAC', encoders: ['aac'], bitrate: 192 },
  mp3: { label: 'MP3', encoders: ['libmp3lame'], bitrate: 192 },
  opus: { label: 'Opus', encoders: ['libopus'], bitrate: 128, sampleRates: [8000, 12000, 16000, 24000, 48000] },
  vorbis: { label: 'Vorbis', encoders: ['libvorbis'], bitrate: 160 },
  flac: { label: 'FLAC', encoders: ['flac'], bitrate: null },
  alac: { label: 'ALAC', encoders: ['alac'], bitrate: null },
  pcm: { label: 'PCM', encoders: ['pcm_s16le'], bitrate: null },
};

/** Video containers and the codecs each can hold, the default first. */
const VIDEO_FORMATS = {
  mp4: { label: 'MP4', mime: 'video/mp4', video: ['h264', 'h265', 'av1'], audio: ['aac', 'mp3', 'opus'] },
  mkv: { label: 'MKV', mime: 'video/x-matroska', video: ['h264', 'h265', 'vp9', 'av1'], audio: ['aac', 'opus', 'mp3', 'vorbis', 'flac'] },
  mov: { label: 'MOV', mime: 'video/quicktime', video: ['h264', 'h265'], audio: ['aac', 'alac'] },
  webm: { label: 'WebM', mime: 'video/webm', video: ['vp9', 'vp8', 'av1'], audio: ['opus', 'vorbis'] },
  avi: { label: 'AVI', mime: 'video/x-msvideo', video: ['mpeg4', 'h264'], audio: ['mp3'] },
  gif: { label: 'GIF (animated)', mime: 'image/gif', video: ['gif'], audio: [] },
};

/** Audio file formats. */
const AUDIO_FORMATS = {
  mp3: { label: 'MP3', mime: 'audio/mpeg', codec: 'mp3', extension: 'mp3' },
  m4a: { label: 'M4A (AAC)', mime: 'audio/mp4', codec: 'aac', extension: 'm4a' },
  ogg: { label: 'OGG (Vorbis)', mime: 'audio/ogg', codec: 'vorbis', extension: 'ogg' },
  opus: { label: 'Opus', mime: 'audio/ogg', codec: 'opus', extension: 'opus' },
  wav: { label: 'WAV', mime: 'audio/wav', codec: 'pcm', extension: 'wav', bitDepths: [16, 24, 32] },
  flac: { label: 'FLAC', mime: 'audio/flac', codec: 'flac', extension: 'flac', bitDepths: [16, 24], compression: { min: 0, max: 12, default: 5 } },
};

const SAMPLE_RATES = [8000, 11025, 16000, 22050, 24000, 32000, 44100, 48000, 96000];
const RESOLUTIONS = [2160, 1440, 1080, 720, 576, 480, 360, 240, 144];
const PCM_ENCODERS = { 16: 'pcm_s16le', 24: 'pcm_s24le', 32: 'pcm_f32le' };

/* ------------------------------------------------------------------ ffmpeg */

let ffmpegInfo;

const run = (binary, args, { timeout = 30000 } = {}) => new Promise((resolve, reject) => {
  const child = spawn(binary, args, { windowsHide: true });
  let stdout = '';
  let stderr = '';
  const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', (error) => { clearTimeout(timer); reject(error); });
  child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
});

/**
 * Find ffmpeg — FFMPEG_PATH, then the ffmpeg-static package, then one on the
 * PATH — and read which encoders it was built with. Cached; a failure is
 * cached too, until `refresh`.
 */
export const loadFfmpeg = async ({ refresh = false } = {}) => {
  if (ffmpegInfo && !refresh) return ffmpegInfo;

  const candidates = [];
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
  try {
    const { default: bundled } = await import('ffmpeg-static');
    if (bundled) candidates.push(bundled);
  } catch {
    // Not installed; try the PATH.
  }
  candidates.push('ffmpeg');

  for (const binary of candidates) {
    try {
      const version = await run(binary, ['-hide_banner', '-version']);
      if (version.code !== 0) continue;
      const listing = await run(binary, ['-hide_banner', '-encoders']);
      const encoders = new Set(
        listing.stdout.split('\n')
          .map((line) => line.match(/^\s[VAS][.A-Z]{5}\s+(\S+)/)?.[1])
          .filter(Boolean),
      );
      ffmpegInfo = {
        binary,
        encoders,
        version: version.stdout.match(/ffmpeg version (\S+)/)?.[1] || 'unknown',
      };
      return ffmpegInfo;
    } catch {
      // Not runnable; try the next one.
    }
  }

  ffmpegInfo = null;
  return null;
};

const encoderFor = (codec, info) => codec.encoders.find((name) => info.encoders.has(name)) || null;

const available = (table, info) => Object.fromEntries(
  Object.entries(table).filter(([, codec]) => encoderFor(codec, info)),
);

/** What the page may offer: only codecs the installed ffmpeg can encode. */
export const capabilities = async ({ refresh = false } = {}) => {
  const info = await loadFfmpeg({ refresh });
  if (!info) {
    return {
      available: false,
      message: 'Conversion needs ffmpeg. Run "npm install" in backend/ (it installs ffmpeg-static), or set FFMPEG_PATH to an ffmpeg binary, and restart the API.',
    };
  }

  const videoCodecs = available(VIDEO_CODECS, info);
  const audioCodecs = available(AUDIO_CODECS, info);
  const describeVideo = ([id, codec]) => ({
    id,
    label: codec.label,
    crf: codec.noQuality ? null : codec.crf,
    bitrate: codec.bitrate || null,
    speeds: !codec.noSpeed,
  });
  const describeAudio = ([id, codec]) => ({
    id, label: codec.label, bitrate: codec.bitrate, sampleRates: codec.sampleRates || SAMPLE_RATES,
  });

  return {
    available: true,
    version: info.version,
    maxUploadMb: MAX_UPLOAD_MB,
    keepMinutes: Math.round(KEEP_MS / 60000),
    speeds: SPEEDS,
    resolutions: RESOLUTIONS,
    sampleRates: SAMPLE_RATES,
    video: {
      codecs: Object.entries(videoCodecs).map(describeVideo),
      audioCodecs: Object.entries(audioCodecs).map(describeAudio),
      formats: Object.entries(VIDEO_FORMATS)
        .map(([value, format]) => ({
          value,
          label: format.label,
          videoCodecs: format.video.filter((id) => videoCodecs[id]),
          audioCodecs: format.audio.filter((id) => audioCodecs[id]),
        }))
        .filter((format) => format.videoCodecs.length),
    },
    audio: {
      formats: Object.entries(AUDIO_FORMATS)
        .filter(([, format]) => audioCodecs[format.codec])
        .map(([value, format]) => ({
          value,
          label: format.label,
          bitrate: AUDIO_CODECS[format.codec].bitrate,
          sampleRates: AUDIO_CODECS[format.codec].sampleRates || SAMPLE_RATES,
          bitDepths: format.bitDepths || null,
          compression: format.compression || null,
        })),
    },
  };
};

/* ------------------------------------------------------------------- probe */

const parseClock = (text) => {
  const match = String(text || '').match(/(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
};

/**
 * What is in the file, read from "ffmpeg -i" (ffprobe is not always shipped
 * alongside). Only the first video and audio streams matter: they are the
 * ones converted.
 */
export const probe = async (inputPath) => {
  const info = await loadFfmpeg();
  const { stderr } = await run(info.binary, ['-hide_banner', '-nostdin', '-i', inputPath]);

  const videoLine = stderr.match(/Stream #\d+:\d+[^:]*: Video: ([^\n]+)/)?.[1] || '';
  const audioLine = stderr.match(/Stream #\d+:\d+[^:]*: Audio: ([^\n]+)/)?.[1] || '';
  if (!videoLine && !audioLine) {
    throw new ConvertError('ffmpeg cannot read this file: it has no audio or video it recognises.');
  }

  const size = videoLine.match(/, (\d{2,5})x(\d{2,5})/);
  const rotation = Number(stderr.match(/rotation of (-?[\d.]+) degrees/)?.[1] || 0);
  const turned = Math.abs(Math.round(rotation)) % 180 === 90;

  return {
    duration: parseClock(stderr.match(/Duration: ([\d:.]+)/)?.[1]),
    bitrate: Number(stderr.match(/Duration: [^\n]*bitrate: (\d+) kb\/s/)?.[1]) || null,
    video: videoLine ? {
      codec: videoLine.match(/^(\w+)/)?.[1] || '',
      // Players show a phone video upright, so report the size they will show.
      width: size ? Number(size[turned ? 2 : 1]) : null,
      height: size ? Number(size[turned ? 1 : 2]) : null,
      fps: Number(videoLine.match(/, ([\d.]+) fps/)?.[1] || videoLine.match(/, ([\d.]+) tbr/)?.[1]) || null,
    } : null,
    audio: audioLine ? {
      codec: audioLine.match(/^(\w+)/)?.[1] || '',
      sampleRate: Number(audioLine.match(/, (\d+) Hz/)?.[1]) || null,
      channels: audioLine.match(/ Hz, ([^,]+)/)?.[1]?.trim() || '',
    } : null,
  };
};

/* --------------------------------------------------------------- settings */

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  if (value === '' || value == null || !Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};

const even = (value) => Math.max(2, Math.round(value / 2) * 2);

/** Start and length in seconds, from the requested start/end and the file's duration. */
const trimWindow = (settings, duration) => {
  const start = clamp(settings.start, 0, 24 * 3600, 0);
  let end = clamp(settings.end, 0, 24 * 3600, null);
  if (duration != null) {
    if (start >= duration) throw new ConvertError('The start time is past the end of the file.');
    if (end != null && end > duration) end = null;
  }
  if (end != null && end <= start) throw new ConvertError('The end time must be after the start time.');
  const length = end != null ? end - start : (duration != null ? duration - start : null);
  return { start, end, length };
};

const trimArgs = ({ start, end }) => [
  ...(start > 0 ? ['-ss', start.toFixed(3)] : []),
  ...(end != null ? ['-t', (end - start).toFixed(3)] : []),
];

const audioEncoderArgs = (codecId, settings, info, { bitDepth } = {}) => {
  const codec = AUDIO_CODECS[codecId];
  const encoder = codecId === 'pcm' ? PCM_ENCODERS[bitDepth || 16] : encoderFor(codec, info);
  const args = ['-c:a', encoder];
  if (codec.bitrate) args.push('-b:a', `${Math.round(clamp(settings.audioBitrate, 16, 512, codec.bitrate))}k`);
  const rates = codec.sampleRates || SAMPLE_RATES;
  const rate = Number(settings.sampleRate);
  if (rates.includes(rate)) args.push('-ar', String(rate));
  const channels = pick(String(settings.channels || ''), ['1', '2'], '');
  if (channels) args.push('-ac', channels);
  return args;
};

const volumeFilters = (settings) => {
  const filters = [];
  const gain = clamp(settings.volume, -30, 30, 0);
  if (gain) filters.push(`volume=${gain}dB`);
  if (settings.normalize) filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  return filters;
};

/** ffmpeg output arguments for a video job, and a one-line summary of them. */
const videoArgs = (settings, media, info) => {
  if (!media.video) throw new ConvertError('This file has no video stream. Use the Audio tab to convert audio.');

  const formatId = pick(settings.format, Object.keys(VIDEO_FORMATS), 'mp4');
  const format = VIDEO_FORMATS[formatId];
  const codecId = pick(settings.videoCodec, format.video, format.video[0]);
  const codec = VIDEO_CODECS[codecId];
  const encoder = encoderFor(codec, info);
  if (!encoder) throw new ConvertError(`This server's ffmpeg cannot encode ${codec.label}.`);

  const args = ['-map', '0:v:0'];
  const summary = [format.label, codec.label];

  // Picture: rotate / flip, then size, then (for GIF) frame rate.
  const filters = [];
  const rotate = Number(pick(Number(settings.rotate), [0, 90, 180, 270], 0));
  if (rotate === 90) filters.push('transpose=1');
  if (rotate === 270) filters.push('transpose=2');
  if (rotate === 180) filters.push('hflip', 'vflip');
  if (settings.flipH) filters.push('hflip');
  if (settings.flipV) filters.push('vflip');
  if (rotate) summary.push(`${rotate}°`);

  const resolution = String(settings.resolution || 'original');
  let scale = '';
  if (resolution === 'custom') {
    const width = clamp(settings.width, 16, 7680, null);
    const height = clamp(settings.height, 16, 4320, null);
    if (width || height) scale = `${width ? even(width) : -2}:${height ? even(height) : -2}`;
  } else if (RESOLUTIONS.includes(Number(resolution))) {
    scale = `-2:${Number(resolution)}`;
  }
  const fps = clamp(settings.fps, 1, 120, null);

  const lossy420 = ['h264', 'h265', 'vp9', 'vp8', 'av1', 'mpeg4'].includes(codecId);
  if (codecId === 'gif') {
    filters.push(`fps=${fps || 12}`);
    // A GIF is always scaled: full-size ones are enormous.
    filters.push(`scale=${scale || '480:-1'}:flags=lanczos`);
    filters.push('split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5');
    args.push('-vf', filters.join(','), '-loop', '0', '-an');
    summary.push(`${fps || 12} fps`);
    return { args, summary, format, extension: formatId, hasAudio: false };
  }

  // 4:2:0 encoders need even dimensions, which a phone video need not have.
  filters.push(scale ? `scale=${scale}` : 'scale=trunc(iw/2)*2:trunc(ih/2)*2');
  if (scale) summary.push(resolution === 'custom' ? scale.replace(/-2/g, 'auto').replace(':', '×') : `${resolution}p`);
  args.push('-vf', filters.join(','));
  if (fps) {
    args.push('-r', String(fps));
    summary.push(`${fps} fps`);
  }

  // Quality: constant quality (CRF), or a target bitrate.
  args.push('-c:v', encoder);
  const speed = pick(settings.speed, SPEEDS, 'medium');
  const byBitrate = settings.rateMode === 'bitrate';
  const crf = Math.round(clamp(settings.crf, codec.crf.min, codec.crf.max, codec.crf.default));
  const kbps = Math.round(clamp(settings.videoBitrate, 100, 100000, codec.bitrate));
  const rate = byBitrate ? ['-b:v', `${kbps}k`] : [];
  summary.push(byBitrate ? `${kbps} kb/s` : `CRF ${crf}`);

  if (encoder === 'libx264' || encoder === 'libx265') {
    args.push('-preset', X26X_PRESETS[speed], ...(byBitrate ? rate : ['-crf', String(crf)]));
    if (encoder === 'libx265') {
      args.push('-x265-params', 'log-level=error');
      // Apple players only accept HEVC in MP4/MOV under this tag.
      if (formatId === 'mp4' || formatId === 'mov') args.push('-tag:v', 'hvc1');
    }
  } else if (encoder === 'libvpx-vp9' || encoder === 'libvpx') {
    // VP9 constant quality needs -b:v 0; VP8's CRF is capped by -b:v instead.
    const quality = encoder === 'libvpx-vp9' ? ['-crf', String(crf), '-b:v', '0'] : ['-crf', String(crf), '-b:v', '50M'];
    args.push(...(byBitrate ? rate : quality), '-deadline', speed === 'fastest' ? 'realtime' : 'good',
      '-cpu-used', String(VPX_CPU_USED[speed]), '-row-mt', '1');
  } else if (encoder === 'libsvtav1') {
    args.push('-preset', String(SVT_PRESETS[speed]), ...(byBitrate ? rate : ['-crf', String(crf)]));
  } else if (encoder === 'libaom-av1') {
    args.push(...(byBitrate ? rate : ['-crf', String(crf), '-b:v', '0']), '-cpu-used', String(AOM_CPU_USED[speed]), '-row-mt', '1');
  } else if (encoder === 'mpeg4') {
    args.push(...(byBitrate ? rate : ['-q:v', String(crf)]));
    if (formatId === 'avi') args.push('-vtag', 'XVID');
  }
  if (lossy420) args.push('-pix_fmt', 'yuv420p');
  if (!codec.noSpeed) summary.push(speed);

  // Sound: kept (re-encoded) or dropped.
  const keepAudio = !settings.removeAudio && media.audio && format.audio.length;
  if (keepAudio) {
    const usable = format.audio.filter((id) => encoderFor(AUDIO_CODECS[id], info));
    const audioCodec = pick(settings.audioCodec, usable, usable[0]);
    if (!audioCodec) throw new ConvertError(`This server's ffmpeg has no audio encoder for ${format.label}.`);
    args.push('-map', '0:a:0', ...audioEncoderArgs(audioCodec, settings, info));
    const audioFilters = volumeFilters(settings);
    if (audioFilters.length) args.push('-af', audioFilters.join(','));
    summary.push(AUDIO_CODECS[audioCodec].label);
  } else {
    args.push('-an');
    if (media.audio) summary.push('no sound');
  }

  if (formatId === 'mp4' || formatId === 'mov') args.push('-movflags', '+faststart');
  return { args, summary, format, extension: formatId, hasAudio: Boolean(keepAudio) };
};

/** ffmpeg output arguments for an audio job. */
const audioArgs = (settings, media, info, trim) => {
  if (!media.audio) throw new ConvertError('This file has no audio stream.');

  const formatId = pick(settings.format, Object.keys(AUDIO_FORMATS), 'mp3');
  const format = AUDIO_FORMATS[formatId];
  const codec = AUDIO_CODECS[format.codec];
  if (!encoderFor(codec, info)) throw new ConvertError(`This server's ffmpeg cannot encode ${codec.label}.`);

  const bitDepth = format.bitDepths ? Number(pick(Number(settings.bitDepth), format.bitDepths, format.bitDepths[0])) : null;
  const args = ['-map', '0:a:0', '-vn', ...audioEncoderArgs(format.codec, { ...settings, audioBitrate: settings.bitrate }, info, { bitDepth })];
  const summary = [format.label];
  if (codec.bitrate) summary.push(`${Math.round(clamp(settings.bitrate, 16, 512, codec.bitrate))} kb/s`);
  if (formatId === 'flac') {
    const level = Math.round(clamp(settings.compression, 0, 12, format.compression.default));
    args.push('-compression_level', String(level));
    // FLAC has no 24-bit sample format in ffmpeg: s32 carrying 24 bits.
    args.push('-sample_fmt', bitDepth === 24 ? 's32' : 's16');
    if (bitDepth === 24) args.push('-bits_per_raw_sample', '24');
  }
  if (bitDepth) summary.push(`${bitDepth}-bit`);
  if (args.includes('-ar')) summary.push(`${Number(args[args.indexOf('-ar') + 1]) / 1000} kHz`);
  if (args.includes('-ac')) summary.push(args[args.indexOf('-ac') + 1] === '1' ? 'mono' : 'stereo');

  const filters = volumeFilters(settings);
  const fadeIn = clamp(settings.fadeIn, 0, 600, 0);
  const fadeOut = clamp(settings.fadeOut, 0, 600, 0);
  if (fadeIn) filters.push(`afade=t=in:st=0:d=${fadeIn}`);
  if (fadeOut) {
    if (trim.length == null) throw new ConvertError('A fade-out needs the file\'s length, which ffmpeg could not read.');
    filters.push(`afade=t=out:st=${Math.max(0, trim.length - fadeOut).toFixed(3)}:d=${fadeOut}`);
  }
  if (filters.length) args.push('-af', filters.join(','));
  if (settings.normalize) summary.push('normalised');

  return { args, summary, format, extension: format.extension, hasAudio: true };
};

/* -------------------------------------------------------------------- jobs */

const jobs = new Map();
const queue = [];
let running = 0;

// Leftovers from before a restart are unreachable: no job knows them.
await fs.rm(WORK_DIR, { recursive: true, force: true }).catch(() => {});

const removeFiles = (job) => Promise.all(
  [job.inputPath, job.outputPath].filter(Boolean).map((file) => fs.unlink(file).catch(() => {})),
);

const publicJob = (job) => ({
  id: job.id,
  kind: job.kind,
  status: job.status,
  fileName: job.fileName,
  inputBytes: job.inputBytes,
  outputName: job.outputName,
  outputBytes: job.outputBytes,
  mime: job.mime,
  summary: job.summary,
  media: job.media,
  percent: job.percent,
  processed: job.processed,
  duration: job.duration,
  speed: job.speed,
  fps: job.fps,
  eta: job.eta,
  queuePosition: job.status === 'queued' ? queue.indexOf(job) + 1 : null,
  createdAt: job.createdAt,
  startedAt: job.startedAt,
  finishedAt: job.finishedAt,
  error: job.error,
  downloadPath: job.status === 'done' ? `/tools/convert/files/${job.token}` : null,
});

const expire = (job) => {
  clearTimeout(job.expiry);
  job.expiry = setTimeout(() => {
    jobs.delete(job.id);
    removeFiles(job);
  }, KEEP_MS);
  job.expiry.unref?.();
};

const finish = (job, status, error = null) => {
  if (job.status !== 'running' && job.status !== 'queued') return;
  job.status = status;
  job.error = error;
  job.finishedAt = new Date().toISOString();
  job.eta = null;
  if (status === 'done') job.percent = 100;
  // The upload is never needed again; a failed output is not wanted.
  fs.unlink(job.inputPath).catch(() => {});
  job.inputPath = null;
  if (status !== 'done') {
    fs.unlink(job.outputPath).catch(() => {});
    job.outputPath = null;
  }
  expire(job);
};

/** The last few meaningful lines of ffmpeg's log: where it says what went wrong. */
const ffmpegError = (stderr) => {
  const lines = stderr.split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line && !/^(frame=|size=|Press \[q\]|\s*Stream mapping|Input #|Output #|  )/.test(line));
  return lines.slice(-4).join(' · ').slice(0, 600) || 'ffmpeg failed.';
};

const startNext = () => {
  while (running < MAX_RUNNING && queue.length) {
    const job = queue.shift();
    if (job.status !== 'queued') continue;
    running += 1;
    execute(job).finally(() => {
      running -= 1;
      startNext();
    });
  }
};

const execute = async (job) => {
  const info = await loadFfmpeg();
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  const began = Date.now();

  try {
    job.media = await probe(job.inputPath);
    const trim = trimWindow(job.settings, job.media.duration);
    const built = (job.kind === 'video' ? videoArgs : audioArgs)(job.settings, job.media, info, trim);
    job.duration = trim.length;
    job.summary = built.summary.join(' · ');
    job.mime = built.format.mime;
    job.outputName = `${job.baseName}.${built.extension}`;
    job.outputPath = path.join(WORK_DIR, `${job.id}.${built.extension}`);
    if (job.status !== 'running') return; // cancelled while probing

    const args = [
      '-hide_banner', '-nostdin', '-y', '-nostats', '-progress', 'pipe:1',
      ...trimArgs(trim),
      '-i', job.inputPath,
      '-map_metadata', '0', '-sn', '-dn',
      ...built.args,
      job.outputPath,
    ];
    // Seeking with -ss before -i starts the output clock at zero, so -t is the length.

    await new Promise((resolve, reject) => {
      const child = spawn(info.binary, args, { windowsHide: true });
      job.child = child;
      let stderr = '';
      let pending = '';
      const timer = setTimeout(() => {
        job.timedOut = true;
        child.kill('SIGKILL');
      }, TIMEOUT_MS);

      child.stdout.on('data', (chunk) => {
        pending += chunk;
        const lines = pending.split('\n');
        pending = lines.pop();
        for (const line of lines) {
          const [key, value] = line.trim().split('=');
          if (key === 'out_time_us' || key === 'out_time_ms') {
            // Both are microseconds (out_time_ms is misnamed); N/A before the first frame.
            const seconds = Number(value) / 1e6;
            if (Number.isFinite(seconds) && seconds >= 0) job.processed = seconds;
          } else if (key === 'total_size') {
            const bytes = Number(value);
            if (Number.isFinite(bytes)) job.outputBytes = bytes;
          } else if (key === 'fps') {
            job.fps = Number(value) || null;
          } else if (key === 'speed') {
            job.speed = Number.parseFloat(value) || null;
          } else if (key === 'progress') {
            if (job.duration) {
              job.percent = Math.min(99.9, (job.processed / job.duration) * 100);
              const elapsed = (Date.now() - began) / 1000;
              const rate = job.processed / Math.max(elapsed, 0.001);
              job.eta = rate > 0 ? Math.max(0, (job.duration - job.processed) / rate) : null;
            }
          }
        }
      });
      child.stderr.on('data', (chunk) => {
        stderr = (stderr + chunk).slice(-20000);
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        job.child = null;
        if (job.status === 'cancelled') resolve();
        else if (job.timedOut) reject(new ConvertError(`Conversion stopped after ${TIMEOUT_MS / 60000} minutes.`));
        else if (code !== 0) reject(new ConvertError(ffmpegError(stderr)));
        else resolve();
      });
    });

    if (job.status !== 'running') return;
    job.outputBytes = (await fs.stat(job.outputPath)).size;
    finish(job, 'done');
  } catch (error) {
    finish(job, 'failed', error?.message || 'The conversion failed.');
  }
};

const ownJob = (ownerId, id) => {
  const job = jobs.get(String(id));
  if (!job || job.ownerId !== ownerId) throw new ConvertError('Conversion not found.', 404);
  return job;
};

/**
 * Queue a conversion of an uploaded file. The settings are validated when it
 * starts (they depend on what is in the file); the obvious mistakes are
 * rejected here, before the caller waits in the queue.
 */
export const createJob = async ({ ownerId, kind, upload, settings }) => {
  if (!['video', 'audio'].includes(kind)) throw new ConvertError('Kind must be "video" or "audio".');
  if (!upload) throw new ConvertError('Choose a file to convert.');
  const info = await loadFfmpeg();
  if (!info) {
    await fs.unlink(upload.path).catch(() => {});
    throw new ConvertError((await capabilities()).message, 503);
  }

  // A user keeps at most MAX_JOBS_PER_USER; the oldest finished ones make room.
  const own = [...jobs.values()].filter((job) => job.ownerId === ownerId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const job of own.slice(0, Math.max(0, own.length - MAX_JOBS_PER_USER + 1))) {
    if (job.status === 'running' || job.status === 'queued') continue;
    clearTimeout(job.expiry);
    jobs.delete(job.id);
    removeFiles(job);
  }

  await fs.mkdir(WORK_DIR, { recursive: true });
  const id = randomUUID();
  const originalName = Buffer.from(upload.originalname || kind, 'latin1').toString('utf8');
  const job = {
    id,
    ownerId,
    kind,
    status: 'queued',
    settings: settings && typeof settings === 'object' ? settings : {},
    token: randomBytes(24).toString('hex'),
    fileName: originalName,
    baseName: (path.parse(originalName).name || kind).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120),
    inputPath: upload.path,
    inputBytes: upload.size,
    outputPath: null,
    outputBytes: 0,
    percent: 0,
    processed: 0,
    createdAt: new Date().toISOString(),
  };
  jobs.set(id, job);
  queue.push(job);
  startNext();
  return publicJob(job);
};

export const listJobs = (ownerId, kind) => [...jobs.values()]
  .filter((job) => job.ownerId === ownerId && (!kind || job.kind === kind))
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  .map(publicJob);

export const getJob = (ownerId, id) => publicJob(ownJob(ownerId, id));

export const cancelJob = (ownerId, id) => {
  const job = ownJob(ownerId, id);
  const child = job.child;
  finish(job, 'cancelled');
  child?.kill('SIGKILL');
  return publicJob(job);
};

export const deleteJob = (ownerId, id) => {
  const job = ownJob(ownerId, id);
  job.child?.kill('SIGKILL');
  finish(job, 'cancelled');
  clearTimeout(job.expiry);
  jobs.delete(job.id);
  removeFiles(job);
};

/** The finished file behind a download link, or null. */
export const fileForToken = (token) => {
  if (!/^[0-9a-f]{48}$/.test(String(token))) return null;
  const job = [...jobs.values()].find((item) => item.token === token && item.status === 'done');
  return job ? { path: job.outputPath, name: job.outputName, mime: job.mime } : null;
};
