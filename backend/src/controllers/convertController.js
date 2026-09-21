// Video transcoding for the Tools > Converting page.
//
// Images are NOT handled here: the browser can already encode JPG/PNG, and ICO
// and GIF are built client-side in frontend/src/lib/imageConvert.js. Sending
// images through here would only add an upload round trip.
//
// ffmpeg is loaded lazily, inside the handler. A top-level import of a missing
// optional dependency takes the whole API down at boot; this way an uninstalled
// ffmpeg-static breaks one endpoint and says so, and every other route still
// serves.

import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

/**
 * Container presets. Codecs are pinned rather than left to ffmpeg's container
 * defaults so the output plays on the widest range of players — particularly
 * AVI, whose default would otherwise vary with the build.
 */
export const VIDEO_FORMATS = {
  mp4: { extension: 'mp4', mime: 'video/mp4', video: 'libx264', audio: 'aac', label: 'MP4 (H.264 / AAC)' },
  avi: { extension: 'avi', mime: 'video/x-msvideo', video: 'mpeg4', audio: 'libmp3lame', label: 'AVI (MPEG-4 / MP3)' },
  mkv: { extension: 'mkv', mime: 'video/x-matroska', video: 'libx264', audio: 'aac', label: 'MKV (H.264 / AAC)' },
  mov: { extension: 'mov', mime: 'video/quicktime', video: 'libx264', audio: 'aac', label: 'MOV (H.264 / AAC)' },
  webm: { extension: 'webm', mime: 'video/webm', video: 'libvpx', audio: 'libvorbis', label: 'WebM (VP8 / Vorbis)' },
};

// Transcoding is unbounded work driven by an uploaded file, so it gets a
// ceiling. Both are generous for the local clips this tool is meant for.
const MAX_DURATION_MS = 10 * 60 * 1000;

let ffmpegModules;

/**
 * Resolve fluent-ffmpeg and the bundled binary once.
 * @returns the configured module, or null when the packages are not installed.
 */
const loadFfmpeg = async () => {
  if (ffmpegModules !== undefined) return ffmpegModules;

  try {
    const [{ default: ffmpeg }, { default: ffmpegPath }] = await Promise.all([
      import('fluent-ffmpeg'),
      import('ffmpeg-static'),
    ]);
    // ffmpeg-static exports the absolute path to the binary it ships.
    if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpegModules = { ffmpeg, ffmpegPath };
  } catch {
    ffmpegModules = null;
  }

  return ffmpegModules;
};

/** GET /tools/convert/capabilities — lets the page disable video up front. */
export const convertCapabilities = async (req, res) => {
  const loaded = await loadFfmpeg();
  return res.json({
    video: Boolean(loaded),
    formats: Object.entries(VIDEO_FORMATS).map(([value, { label }]) => ({ value, label })),
    message: loaded
      ? ''
      : 'Video conversion needs the ffmpeg-static and fluent-ffmpeg packages. Run "npm install" in backend/ and restart the API.',
  });
};

const runFfmpeg = (ffmpeg, inputPath, outputPath, preset) => new Promise((resolve, reject) => {
  const command = ffmpeg(inputPath)
    .videoCodec(preset.video)
    .audioCodec(preset.audio)
    .on('end', resolve)
    .on('error', (error) => reject(new Error(error?.message || 'ffmpeg failed.')));

  // ffmpeg will happily run for hours on a large input; kill it rather than
  // letting a single request hold a worker open indefinitely.
  const timer = setTimeout(() => {
    command.kill('SIGKILL');
    reject(new Error('Conversion timed out after 10 minutes.'));
  }, MAX_DURATION_MS);

  command.on('end', () => clearTimeout(timer));
  command.on('error', () => clearTimeout(timer));

  command.save(outputPath);
});

/** POST /tools/convert/video — multipart upload, transcoded file streamed back. */
export const convertVideo = async (req, res, next) => {
  const cleanup = [];

  try {
    if (!req.file) {
      return res.status(400).json({ message: 'A video file is required.' });
    }
    cleanup.push(req.file.path);

    const target = String(req.body.format || '').toLowerCase();
    const preset = VIDEO_FORMATS[target];
    if (!preset) {
      return res.status(400).json({
        message: `Format must be one of ${Object.keys(VIDEO_FORMATS).join(', ')}.`,
      });
    }

    const loaded = await loadFfmpeg();
    if (!loaded) {
      return res.status(503).json({
        message: 'Video conversion is unavailable: ffmpeg-static and fluent-ffmpeg are not installed. Run "npm install" in backend/ and restart the API.',
      });
    }

    const baseName = path.parse(req.file.originalname || 'video').name.replace(/[^a-zA-Z0-9_.-]/g, '_') || 'video';
    const outputPath = path.join(os.tmpdir(), `${randomUUID()}.${preset.extension}`);
    cleanup.push(outputPath);

    await runFfmpeg(loaded.ffmpeg, req.file.path, outputPath, preset);

    const { size } = await fs.stat(outputPath);
    res.setHeader('Content-Type', preset.mime);
    res.setHeader('Content-Length', size);
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.${preset.extension}"`);

    // Streamed rather than buffered: a transcoded video can be far larger than
    // anything worth holding in memory.
    await new Promise((resolve, reject) => {
      const stream = createReadStream(outputPath);
      stream.on('error', reject);
      res.on('finish', resolve);
      res.on('error', reject);
      stream.pipe(res);
    });

    return undefined;
  } catch (error) {
    if (res.headersSent) return undefined;
    // ffmpeg's own messages name the offending codec or stream, which is more
    // use to whoever uploaded the file than a generic failure.
    return res.status(400).json({ message: error?.message || 'That video could not be converted.' });
  } finally {
    // Temp files must go whether or not the conversion or the download worked.
    await Promise.all(cleanup.map((file) => fs.unlink(file).catch(() => {})));
  }
};
