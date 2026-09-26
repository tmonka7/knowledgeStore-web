// Audio and video conversion for the Tools > Converting page.
//
// Images are NOT handled here: the browser can already encode JPG/PNG, and ICO
// and GIF are built client-side in frontend/src/lib/imageConvert.js. Sending
// images through here would only add an upload round trip.
//
// A conversion is a job (helpers/mediaConvert.js): the upload returns at once,
// and the page polls the job for its progress, then previews and downloads the
// result from a link.

import {
  ConvertError, cancelJob, capabilities, createJob, deleteJob, fileForToken, getJob, listJobs,
} from '../helpers/mediaConvert.js';

const parseSettings = (value) => {
  try {
    const settings = JSON.parse(String(value || '{}'));
    return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  } catch {
    throw new ConvertError('"settings" must be a JSON object.');
  }
};

/** GET /tools/convert/capabilities — which formats and codecs this server's ffmpeg offers. */
export const convertCapabilities = async (req, res) => {
  res.json(await capabilities({ refresh: req.query.refresh === '1' }));
};

/** POST /tools/convert/jobs — multipart "file", "kind" (video | audio) and "settings" (JSON). */
export const createConvertJob = async (req, res) => {
  const job = await createJob({
    ownerId: req.user.sub,
    kind: String(req.body?.kind || ''),
    upload: req.file,
    settings: parseSettings(req.body?.settings),
  });
  res.status(202).json({ job });
};

export const listConvertJobs = (req, res) => res.json({ jobs: listJobs(req.user.sub, req.query.kind) });
export const getConvertJob = (req, res) => res.json({ job: getJob(req.user.sub, req.params.id) });
export const cancelConvertJob = (req, res) => res.json({ job: cancelJob(req.user.sub, req.params.id) });
export const deleteConvertJob = (req, res) => {
  deleteJob(req.user.sub, req.params.id);
  res.json({ ok: true });
};

/**
 * GET /tools/convert/files/:token — the converted file, inline for the
 * page's player or as an attachment with ?download=1. sendFile answers range
 * requests, so the player can seek.
 */
export const convertedFile = (req, res, next) => {
  const file = fileForToken(req.params.token);
  if (!file) {
    res.status(404).json({ message: 'This converted file has expired. Convert it again.' });
    return;
  }
  if (req.query.download === '1') res.attachment(file.name);
  res.type(file.mime);
  res.sendFile(file.path, { headers: { 'Cache-Control': 'private, no-store' } }, (error) => {
    if (error && !res.headersSent) next(error);
  });
};
