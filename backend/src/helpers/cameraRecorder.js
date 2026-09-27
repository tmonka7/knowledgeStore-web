// Recording camera streams on the server, for Camera Management.
//
// The page shows a camera by loading its address directly, so nothing on the
// server ever touched the video. Recording has to: one ffmpeg process per
// camera reads the stream (RTSP or HTTP) and writes it in segments of
// CAMERA_SEGMENT_MINUTES, one MP4 each, named by the local time it starts:
//
//   CAMERA_RECORDINGS_DIR/<camera id>/20260926-143000.mp4
//
// The MP4s are fragmented, so the segment being written plays too, up to the
// last few seconds. H.264 is copied as it arrives (almost free); anything else
// (MJPEG from an HTTP camera, H.265) is encoded to H.264 so every browser can
// play it. Whether a camera should be recording is kept on the camera, so a
// restart resumes it; a recorder that dies is restarted, waiting longer each
// time the stream fails. Segments older than CAMERA_RECORDING_KEEP_DAYS go.
//
// The folder is outside /uploads on purpose: that is served without sign-in,
// and footage is not. It is played through short-lived links (playTicket).

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Camera } from '../models/cameraModel.js';
import { loadFfmpeg } from './mediaConvert.js';

const envNumber = (name, fallback, min, max) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && process.env[name] !== '' ? Math.min(max, Math.max(min, value)) : fallback;
};

export const RECORDINGS_DIR = path.resolve(process.env.CAMERA_RECORDINGS_DIR
  || path.join(path.dirname(fileURLToPath(import.meta.url)), '../../recordings'));
const SEGMENT_SECONDS = Math.round(envNumber('CAMERA_SEGMENT_MINUTES', 10, 1, 60) * 60);
const KEEP_DAYS = envNumber('CAMERA_RECORDING_KEEP_DAYS', 7, 0, 3650); // 0: keep for ever
const MAX_RECORDERS = envNumber('CAMERA_MAX_RECORDERS', 8, 1, 64);
const TICKET_MS = 2 * 60 * 60 * 1000;
const PROBE_MS = 20 * 1000;

const SAFE_CAMERA = /^[A-Za-z0-9-]{1,64}$/;
const SEGMENT_FILE = /^(\d{8})-(\d{6})\.mp4$/;
const RECORDING_ID = /^([A-Za-z0-9-]{1,64})_(\d{8}-\d{6})$/;

export class RecordingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/* ------------------------------------------------------------- recorders */

// camera id -> { child, startedAt, codec, restarts, lastError, stopping, retry }
const recorders = new Map();

const cameraFolder = (cameraId) => {
  if (!SAFE_CAMERA.test(String(cameraId))) throw new RecordingError('Unexpected camera id.');
  return path.join(RECORDINGS_DIR, cameraId);
};

const isStreamAddress = (address) => /^(rtsps?|https?):\/\//i.test(String(address || ''));

/** Input options: RTSP over TCP (UDP loses packets through most networks), and timeouts so a dead camera ends the process. */
const inputArgs = (address) => (/^rtsps?:/i.test(address)
  ? ['-rtsp_transport', 'tcp', '-timeout', '10000000']
  : ['-rw_timeout', '10000000']);

/** The first seconds of the stream, to learn its video codec: H.264 is copied, anything else encoded. */
const probeWith = async (binary, address, format) => new Promise((resolve) => {
  const child = spawn(binary, ['-hide_banner', '-nostdin', ...inputArgs(address), ...format, '-i', address], { windowsHide: true });
  let stderr = '';
  const timer = setTimeout(() => child.kill('SIGKILL'), PROBE_MS);
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', () => { clearTimeout(timer); resolve({ codec: '', audio: false, stderr: '' }); });
  child.on('close', () => {
    clearTimeout(timer);
    resolve({
      codec: stderr.match(/Stream #\d+:\d+[^:]*: Video: (\w+)/)?.[1] || '',
      audio: /Stream #\d+:\d+[^:]*: Audio: /.test(stderr),
      stderr,
      format,
    });
  });
});

/*
 * ffmpeg recognises RTSP and most HTTP streams by itself, but not the MJPEG
 * that HTTP cameras send (multipart/x-mixed-replace): for that it has to be
 * told the format.
 */
const probeCodec = async (binary, address) => {
  const first = await probeWith(binary, address, []);
  if (first.codec || !/^https?:/i.test(address)) return first;
  const mjpeg = await probeWith(binary, address, ['-f', 'mpjpeg']);
  return mjpeg.codec ? mjpeg : first;
};

const lastLines = (stderr) => stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  .slice(-3).join(' · ').slice(0, 400);

const outputArgs = (folder, codec, audio, untimed) => [
  '-map', '0:v:0', ...(audio ? ['-map', '0:a:0?'] : []),
  ...(codec === 'h264'
    ? ['-c:v', 'copy']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-g', '50']),
  // MJPEG over HTTP has no timestamps: ffmpeg would assume 25 fps, and a
  // 10 fps camera would play back 2.5 times too fast. Each frame is stamped
  // with the time it arrived instead, so playback runs at the speed of life.
  ...(untimed ? ['-vf', 'setpts=(RTCTIME-RTCSTART)/(TB*1000000)', '-fps_mode', 'passthrough'] : []),
  // Camera audio is often G.711, which MP4 cannot hold.
  ...(audio ? ['-c:a', 'aac', '-b:a', '64k'] : []),
  '-f', 'segment',
  '-segment_time', String(SEGMENT_SECONDS),
  '-segment_atclocktime', '1',
  '-segment_format', 'mp4',
  // Fragmented, and each fragment written out as soon as it is complete
  // (flush_packets has to reach the MP4 muxer inside the segmenter), so the
  // segment being recorded plays up to the last second or two.
  '-segment_format_options', 'movflags=+frag_keyframe+empty_moov+default_base_moof:flush_packets=1',
  '-reset_timestamps', '1',
  '-strftime', '1',
  path.join(folder, '%Y%m%d-%H%M%S.mp4'),
];

const launch = async (camera) => {
  const state = recorders.get(camera.id);
  if (!state || state.stopping) return;
  clearTimeout(state.retry);

  const info = await loadFfmpeg();
  if (!info) {
    state.lastError = 'ffmpeg was not found on the server. Install ffmpeg-static or set FFMPEG_PATH.';
    return;
  }
  const folder = cameraFolder(camera.id);
  await fs.mkdir(folder, { recursive: true });

  const probed = await probeCodec(info.binary, camera.address);
  if (!recorders.has(camera.id) || state.stopping) return;
  if (!probed.codec) {
    state.lastError = `The stream could not be read: ${lastLines(probed.stderr) || 'no video found'}`;
    schedule(camera, state);
    return;
  }
  if (probed.codec !== 'h264' && !info.encoders.has('libx264')) {
    state.lastError = `The camera sends ${probed.codec}, and this ffmpeg has no H.264 encoder to convert it.`;
    schedule(camera, state);
    return;
  }

  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-fflags', '+genpts',
    ...inputArgs(camera.address), ...probed.format, '-i', camera.address,
    ...outputArgs(folder, probed.codec, probed.audio, probed.codec === 'mjpeg')];
  const child = spawn(info.binary, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  Object.assign(state, { child, codec: probed.codec, startedAt: new Date(), lastError: '' });

  const started = Date.now();
  child.on('error', (error) => { state.lastError = error.message; });
  child.on('close', (code) => {
    if (state.child === child) state.child = null;
    if (state.stopping || !recorders.has(camera.id)) return;
    state.lastError = `Recording stopped (${code ?? 'killed'}): ${lastLines(stderr) || 'the stream ended'}`;
    // A recorder that ran a good while was working; start its back-off afresh.
    if (Date.now() - started > 5 * 60 * 1000) state.restarts = 0;
    schedule(camera, state);
  });
};

/** Try again after 5 s, 10 s, 20 s … up to 2 min. */
const schedule = (camera, state) => {
  const delay = Math.min(120, 5 * 2 ** Math.min(state.restarts, 5)) * 1000;
  state.restarts += 1;
  state.retry = setTimeout(async () => {
    const fresh = await Camera.findOne({ id: camera.id }).catch(() => null);
    if (!fresh?.recording?.enabled) {
      recorders.delete(camera.id);
      return;
    }
    launch(fresh).catch((error) => { state.lastError = error.message; });
  }, delay);
  state.retry.unref?.();
};

const halt = (cameraId) => {
  const state = recorders.get(cameraId);
  if (!state) return;
  state.stopping = true;
  clearTimeout(state.retry);
  recorders.delete(cameraId);
  // The segments are fragmented MP4, so one cut off mid-write still plays up
  // to its last fragment: stopping needs no graceful shutdown.
  const { child } = state;
  if (child && child.exitCode === null) {
    child.kill('SIGINT');
    setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 5000).unref?.();
  }
};

/** Start (or restart, after an address change) recording one camera. */
const run = (camera) => {
  halt(camera.id);
  const state = { child: null, startedAt: null, codec: '', restarts: 0, lastError: '', stopping: false, retry: null };
  recorders.set(camera.id, state);
  launch(camera).catch((error) => { state.lastError = error.message; });
};

/** What the page shows for one camera. */
export const recordingStatus = (camera) => {
  const state = recorders.get(camera.id);
  return {
    enabled: Boolean(camera.recording?.enabled),
    active: Boolean(state?.child),
    since: state?.child ? state.startedAt : null,
    codec: state?.codec || '',
    error: state?.lastError || '',
  };
};

export const startRecording = async (camera, user) => {
  if (!isStreamAddress(camera.address)) {
    throw new RecordingError('Only rtsp:// and http(s):// stream addresses can be recorded.');
  }
  if (!recorders.has(camera.id) && recorders.size >= MAX_RECORDERS) {
    throw new RecordingError(`The server records at most ${MAX_RECORDERS} cameras at once (CAMERA_MAX_RECORDERS).`, 429);
  }
  if (!await loadFfmpeg()) {
    throw new RecordingError('ffmpeg was not found on the server. Install ffmpeg-static or set FFMPEG_PATH.', 503);
  }
  camera.recording = { enabled: true, changedBy: user?.username || '', changedAt: new Date() };
  await camera.save();
  run(camera);
};

export const stopRecording = async (camera, user) => {
  camera.recording = { enabled: false, changedBy: user?.username || '', changedAt: new Date() };
  await camera.save();
  halt(camera.id);
};

/** The camera's address changed: record from the new one. */
export const cameraChanged = (camera) => {
  if (camera.recording?.enabled && recorders.has(camera.id)) run(camera);
};

/** The camera was deleted: stop recording it. Its footage stays until it expires. */
export const cameraRemoved = (cameraId) => halt(cameraId);

/* ------------------------------------------------------------ recordings */

const parseStart = (name) => {
  const [, day, time] = name.match(SEGMENT_FILE);
  return new Date(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)),
    Number(time.slice(0, 2)), Number(time.slice(2, 4)), Number(time.slice(4, 6)));
};

const segmentsOf = async (cameraId) => {
  let names;
  try {
    names = await fs.readdir(cameraFolder(cameraId));
  } catch {
    return [];
  }
  const files = names.filter((name) => SEGMENT_FILE.test(name)).sort();
  const writing = recorders.get(cameraId)?.child ? files[files.length - 1] : null;
  const segments = [];
  for (const name of files) {
    const stat = await fs.stat(path.join(cameraFolder(cameraId), name)).catch(() => null);
    if (!stat || !stat.size) continue;
    const startedAt = parseStart(name);
    const endedAt = name === writing ? new Date() : stat.mtime;
    segments.push({
      id: `${cameraId}_${name.slice(0, -4)}`,
      cameraId,
      startedAt,
      endedAt,
      seconds: Math.max(0, Math.round((endedAt - startedAt) / 1000)),
      bytes: stat.size,
      recording: name === writing,
    });
  }
  return segments;
};

/**
 * Recorded segments, newest first: of one camera or all, optionally only those
 * overlapping [from, to]. Footage of deleted cameras is listed until it expires.
 */
export const listRecordings = async ({ cameraId = '', from = null, to = null, limit = 500 } = {}) => {
  let ids;
  if (cameraId) {
    ids = [String(cameraId)];
  } else {
    ids = (await fs.readdir(RECORDINGS_DIR, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isDirectory() && SAFE_CAMERA.test(entry.name)).map((entry) => entry.name);
  }
  const all = (await Promise.all(ids.map(segmentsOf))).flat()
    .filter((segment) => (!from || segment.endedAt >= from) && (!to || segment.startedAt <= to))
    .sort((a, b) => b.startedAt - a.startedAt);
  return all.slice(0, Math.max(1, Math.min(2000, limit)));
};

const segmentFile = (id) => {
  const match = String(id || '').match(RECORDING_ID);
  if (!match) throw new RecordingError('Recording not found.', 404);
  return { cameraId: match[1], file: path.join(cameraFolder(match[1]), `${match[2]}.mp4`) };
};

export const deleteRecording = async (id) => {
  const { cameraId, file } = segmentFile(id);
  const writing = (await segmentsOf(cameraId)).find((segment) => segment.id === id)?.recording;
  if (writing) throw new RecordingError('This segment is still being recorded. Stop recording first, or wait for the next segment.', 409);
  try {
    await fs.unlink(file);
  } catch {
    throw new RecordingError('Recording not found.', 404);
  }
};

/*
 * Playback links. A <video> element cannot send the Authorization header the
 * API expects, so the page asks (signed in) for a link, which then works on
 * its own for two hours — long enough to watch and seek, since every seek is
 * a new range request for the same URL.
 */
const tickets = new Map(); // token -> { id, expires }

export const playTicket = async (id) => {
  const { file } = segmentFile(id);
  await fs.access(file).catch(() => { throw new RecordingError('Recording not found.', 404); });
  const token = randomUUID();
  tickets.set(token, { id, expires: Date.now() + TICKET_MS });
  setTimeout(() => tickets.delete(token), TICKET_MS).unref?.();
  return token;
};

export const fileForTicket = (token) => {
  const entry = tickets.get(String(token || ''));
  if (!entry || entry.expires < Date.now()) throw new RecordingError('This playback link has expired. Open the recording again.', 410);
  return { ...segmentFile(entry.id), id: entry.id };
};

/* ------------------------------------------------------------ at startup */

const expireOld = async () => {
  if (!KEEP_DAYS) return;
  const cutoff = Date.now() - KEEP_DAYS * 24 * 3600 * 1000;
  const folders = await fs.readdir(RECORDINGS_DIR, { withFileTypes: true }).catch(() => []);
  for (const folder of folders.filter((entry) => entry.isDirectory() && SAFE_CAMERA.test(entry.name))) {
    const dir = path.join(RECORDINGS_DIR, folder.name);
    for (const name of (await fs.readdir(dir).catch(() => [])).filter((item) => SEGMENT_FILE.test(item))) {
      const stat = await fs.stat(path.join(dir, name)).catch(() => null);
      if (stat && stat.mtimeMs < cutoff) await fs.unlink(path.join(dir, name)).catch(() => {});
    }
    // A deleted camera's folder goes once its last segment has.
    if (!(await fs.readdir(dir).catch(() => ['x'])).length) await fs.rmdir(dir).catch(() => {});
  }
};

/** Resume every camera that was recording, and expire old footage now and hourly. */
export const startCameraRecorders = async () => {
  const cameras = await Camera.find({ 'recording.enabled': true });
  for (const camera of cameras.slice(0, MAX_RECORDERS)) {
    if (isStreamAddress(camera.address)) run(camera);
  }
  const sweep = () => expireOld().catch((error) => console.error('Recording expiry failed:', error.message));
  sweep();
  setInterval(sweep, 60 * 60 * 1000).unref?.();
};

/** Stop every recorder cleanly (the server is shutting down). */
export const stopCameraRecorders = () => {
  for (const id of [...recorders.keys()]) halt(id);
};
