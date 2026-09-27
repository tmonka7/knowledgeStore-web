import { getCameraById } from '../models/store.js';
import {
  RecordingError, deleteRecording, fileForTicket, listRecordings, playTicket, recordingStatus, startRecording,
  stopRecording,
} from '../helpers/cameraRecorder.js';
import { publicCamera } from '../models/cameraModel.js';

const fail = (res, error) => {
  if (error instanceof RecordingError) return res.status(error.status).json({ message: error.message });
  throw error;
};

const cameraOut = (camera) => ({ ...publicCamera(camera), recording: recordingStatus(camera) });

const withCamera = async (req, res, work) => {
  const camera = await getCameraById(req.params.id);
  if (!camera) return res.status(404).json({ message: 'Camera not found.' });
  try {
    return await work(camera);
  } catch (error) {
    return fail(res, error);
  }
};

/** POST /cameras/:id/recording/start — record this camera until told to stop, across restarts. */
export const startCameraRecording = (req, res) => withCamera(req, res, async (camera) => {
  await startRecording(camera, req.user);
  return res.json({ camera: cameraOut(camera) });
});

/** POST /cameras/:id/recording/stop */
export const stopCameraRecording = (req, res) => withCamera(req, res, async (camera) => {
  await stopRecording(camera, req.user);
  return res.json({ camera: cameraOut(camera) });
});

const dateParam = (value) => {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

/** GET /cameras/recordings?cameraId=&from=&to= — segments, newest first. */
export const listCameraRecordings = async (req, res) => {
  try {
    const recordings = await listRecordings({
      cameraId: String(req.query.cameraId || ''),
      from: dateParam(req.query.from),
      to: dateParam(req.query.to),
      limit: Number(req.query.limit) || 500,
    });
    return res.json({ recordings });
  } catch (error) {
    return fail(res, error);
  }
};

/** POST /cameras/recordings/:recordingId/link — a two-hour URL for <video src> and downloads. */
export const recordingLink = async (req, res) => {
  try {
    const token = await playTicket(req.params.recordingId);
    return res.json({ path: `/cameras/recordings/play/${token}` });
  } catch (error) {
    return fail(res, error);
  }
};

/** GET /cameras/recordings/play/:token[?download=1] — no sign-in; the token is the permission. Seeking works (Range). */
export const playRecording = (req, res) => {
  let entry;
  try {
    entry = fileForTicket(req.params.token);
  } catch (error) {
    return fail(res, error);
  }
  const done = (error) => {
    if (error && !res.headersSent) res.status(error.statusCode === 404 || error.code === 'ENOENT' ? 404 : 500).json({ message: 'Recording not found.' });
  };
  if (req.query.download === '1') return res.download(entry.file, `${entry.id}.mp4`, done);
  return res.sendFile(entry.file, { headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'private, no-store' } }, done);
};

/** DELETE /cameras/recordings/:recordingId */
export const removeRecording = async (req, res) => {
  try {
    await deleteRecording(req.params.recordingId);
    return res.json({ ok: true });
  } catch (error) {
    return fail(res, error);
  }
};
