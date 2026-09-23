import {
  PtzError,
  aimCamera,
  cameraStatus,
  grabFrame,
  haltCamera,
  nudgeCamera,
  probePtz,
  ptzStatusCode,
  ptzReady,
} from '../helpers/ptz/index.js';
import { getCameraForControl } from '../models/store.js';

/*
 * Manual PTZ, and the frame proxy everything else is built on.
 *
 * Every handler loads the camera with getCameraForControl, which is the only
 * query that returns the PTZ password, and none of them ever put a camera
 * object into a response — the password would ride along. They return the
 * specific fields they mean to.
 */

const failed = (res, error, fallback) => {
  if (error instanceof PtzError) {
    return res.status(ptzStatusCode(error)).json({ message: error.message, code: error.code });
  }
  console.error(fallback, error);
  return res.status(500).json({ message: fallback });
};

const loadCamera = async (req, res) => {
  const camera = await getCameraForControl(req.params.id);
  if (!camera) {
    res.status(404).json({ message: 'Camera not found.' });
    return null;
  }
  return camera;
};

/**
 * POST /cameras/:id/ptz/probe — ask a camera what it can do.
 *
 * Credentials come from the request body when they are supplied, so the
 * settings form can test a password before it is saved; otherwise the stored
 * ones are used. Only the profile list comes back.
 */
export const probeCamera = async (req, res) => {
  const camera = await loadCamera(req, res);
  if (!camera) return undefined;

  const { deviceUrl, username, password } = req.body || {};
  const url = String(deviceUrl || camera.ptz?.deviceUrl || '').trim();
  const user = username === undefined ? (camera.ptz?.username || '') : String(username);
  // An empty password in the body means "use the stored one", not "the
  // password is blank" — the form never receives the stored password, so it
  // cannot send it back, and treating blank as blank would make every probe
  // after the first fail with the password the operator just saved.
  const secret = password ? String(password) : (camera.ptz?.password || '');

  try {
    const profiles = await probePtz(url, user, secret);
    return res.json({
      profiles,
      // A camera with profiles but none movable is a fixed camera; saying so
      // is more useful than an empty dropdown.
      movable: profiles.some((profile) => profile.hasPtz),
    });
  } catch (error) {
    return failed(res, error, 'The camera could not be contacted.');
  }
};

/** GET /cameras/:id/ptz/status — where the head is pointing. */
export const readPtzStatus = async (req, res) => {
  const camera = await loadCamera(req, res);
  if (!camera) return undefined;

  if (!ptzReady(camera)) {
    return res.json({ ready: false, pan: 0, tilt: 0, zoom: 0, moving: false });
  }

  try {
    return res.json({ ready: true, ...(await cameraStatus(camera)) });
  } catch (error) {
    return failed(res, error, 'The camera did not report its position.');
  }
};

/**
 * POST /cameras/:id/ptz/move — drive the camera by hand.
 *
 * Three shapes, because a control pad needs all three: an absolute position,
 * a velocity to travel at while a button is held, and a stop for when it is
 * released.
 */
export const movePtz = async (req, res) => {
  const camera = await loadCamera(req, res);
  if (!camera) return undefined;

  const { mode = 'absolute', pan = 0, tilt = 0, zoom = 0 } = req.body || {};

  try {
    if (mode === 'stop') {
      await haltCamera(camera);
    } else if (mode === 'continuous') {
      await nudgeCamera(camera, { pan: Number(pan) || 0, tilt: Number(tilt) || 0, zoom: Number(zoom) || 0 });
    } else {
      await aimCamera(camera, { pan: Number(pan) || 0, tilt: Number(tilt) || 0, zoom: Number(zoom) || 0 });
    }
    return res.json({ ok: true });
  } catch (error) {
    return failed(res, error, 'The camera did not accept the movement.');
  }
};

/**
 * GET /cameras/:id/frame — one still, proxied through this origin.
 *
 * The proxy is the whole point: fetched by the browser directly, these pixels
 * are unreadable (no CORS headers, so any canvas they touch is tainted) and
 * often unreachable (HTTP Digest). Served from here they are same-origin, and
 * face recognition in the page can read them.
 *
 * no-store because a cached frame in a sweep is a frame of the wrong angle.
 */
export const cameraFrame = async (req, res) => {
  const camera = await loadCamera(req, res);
  if (!camera) return undefined;

  try {
    const { buffer, contentType } = await grabFrame(camera);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(buffer);
  } catch (error) {
    return failed(res, error, 'The camera image could not be fetched.');
  }
};
