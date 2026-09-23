import { fetchWithAuth } from './httpAuth.js';
import {
  PtzError,
  absoluteMove,
  continuousMove,
  getProfiles,
  getSnapshotUri,
  getStatus,
  stopMove,
} from './onvif.js';
import { SWEEP_DEFAULTS, planSweep } from './sweep.js';

export { PtzError, planSweep, SWEEP_DEFAULTS };
export { discoverCameras, localSubnet } from './discovery.js';

/*
 * Camera control, from the server.
 *
 * All of this runs on the backend rather than in the page, and not for
 * tidiness. A browser cannot do it at all: cameras answer no CORS headers, so
 * fetch cannot read them; they want HTTP Digest, which fetch does not speak;
 * and doing it client-side would mean handing the camera's administrative
 * password to every operator's browser. The page asks this server to point the
 * camera, and this server is the only thing that ever holds the credentials.
 */

/** A camera is controllable when it has a protocol, an address and a profile. */
export const ptzReady = (camera) => {
  const ptz = camera?.ptz;
  return Boolean(ptz?.enabled && ptz.protocol === 'onvif' && ptz.deviceUrl && ptz.profileToken);
};

const credentialsFor = (camera) => ({
  username: camera?.ptz?.username || '',
  password: camera?.ptz?.password || '',
  timeoutMs: Number(camera?.ptz?.timeoutMs) || 8000,
});

const requireReady = (camera) => {
  const ptz = camera?.ptz;
  if (!ptz?.enabled) throw new PtzError('PTZ_DISABLED', 'PTZ control is switched off for this camera.');
  if (ptz.protocol !== 'onvif') throw new PtzError('PTZ_UNSUPPORTED', `PTZ protocol "${ptz.protocol}" is not supported.`);
  if (!ptz.deviceUrl) throw new PtzError('PTZ_UNCONFIGURED', 'This camera has no ONVIF service address.');
  if (!ptz.profileToken) throw new PtzError('PTZ_UNCONFIGURED', 'This camera has no ONVIF profile selected. Run Detect on the camera first.');
  return { ptz, credentials: credentialsFor(camera) };
};

/** Lists the camera's profiles so an operator can pick one. */
export const probePtz = async (deviceUrl, username, password) => {
  if (!deviceUrl) throw new PtzError('PTZ_UNCONFIGURED', 'Enter the ONVIF service address first.');
  const profiles = await getProfiles(deviceUrl, { username, password });
  if (!profiles.length) throw new PtzError('PTZ_UNSUPPORTED', 'The camera reported no media profiles.');
  return profiles;
};

export const aimCamera = async (camera, { pan, tilt = 0, zoom = 0 }) => {
  const { ptz, credentials } = requireReady(camera);
  await absoluteMove(ptz.deviceUrl, ptz.profileToken, { pan, tilt, zoom, speed: ptz.moveSpeed || 0.6 }, credentials);
};

export const nudgeCamera = async (camera, velocity) => {
  const { ptz, credentials } = requireReady(camera);
  await continuousMove(ptz.deviceUrl, ptz.profileToken, velocity, credentials);
};

export const haltCamera = async (camera) => {
  const { ptz, credentials } = requireReady(camera);
  await stopMove(ptz.deviceUrl, ptz.profileToken, credentials);
};

export const cameraStatus = async (camera) => {
  const { ptz, credentials } = requireReady(camera);
  return getStatus(ptz.deviceUrl, ptz.profileToken, credentials);
};

/**
 * Waits for the head to stop.
 *
 * AbsoluteMove returns when the camera ACCEPTS the command, not when the lens
 * arrives, so without this every frame in a sweep is of the previous stop —
 * shifted by one, and consistently enough that the result looks like a working
 * sweep with a mysteriously poor hit rate.
 *
 * GetStatus is polled where the camera reports MoveStatus, and a fixed settle
 * always follows, because plenty of cameras report IDLE while the head is
 * still visibly ringing.
 */
export const waitForStop = async (camera, { settleMs = SWEEP_DEFAULTS.settleMs, maxWaitMs = 8000 } = {}) => {
  const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    let status;
    try {
      status = await cameraStatus(camera);
    } catch {
      // A camera that will not report status is not a reason to abandon the
      // sweep; fall through to the fixed settle.
      break;
    }
    if (!status.moving) break;
    await pause(150);
  }

  await pause(settleMs);
};

/*
 * ---------------------------------------------------------------------------
 * Frames
 * ---------------------------------------------------------------------------
 */

const JPEG_START = Buffer.from([0xff, 0xd8]);
const JPEG_END = Buffer.from([0xff, 0xd9]);

/**
 * One JPEG out of an MJPEG stream.
 *
 * A snapshot URL answers with one image and closes. An MJPEG stream answers
 * with `multipart/x-mixed-replace` and NEVER closes — so reading it the
 * ordinary way, with response.arrayBuffer(), waits for an end that does not
 * come and the request hangs until it is killed. The body is read chunk by
 * chunk instead and abandoned the moment one complete frame has arrived.
 *
 * Frames are delimited by the JPEG markers themselves rather than by the
 * multipart boundary, because the boundary is declared inconsistently across
 * camera firmware while SOI/EOI are in the image format.
 */
const readOneJpeg = async (response, maxBytes = 8_000_000) => {
  const reader = response.body?.getReader?.();
  if (!reader) throw new PtzError('NO_SNAPSHOT', 'The camera sent no readable image data.');

  let buffer = Buffer.alloc(0);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer = Buffer.concat([buffer, Buffer.from(value)]);

      const start = buffer.indexOf(JPEG_START);
      if (start !== -1) {
        const end = buffer.indexOf(JPEG_END, start + 2);
        if (end !== -1) return buffer.subarray(start, end + 2);
      }

      if (buffer.length > maxBytes) {
        throw new PtzError('NO_SNAPSHOT', 'No complete image arrived from the camera.');
      }
    }
  } finally {
    // Without this the socket stays open on a stream that never ends, and a
    // sweep of twelve stops leaves twelve of them behind.
    await reader.cancel().catch(() => {});
  }

  const start = buffer.indexOf(JPEG_START);
  const end = start === -1 ? -1 : buffer.indexOf(JPEG_END, start + 2);
  if (start !== -1 && end !== -1) return buffer.subarray(start, end + 2);
  throw new PtzError('NO_SNAPSHOT', 'The camera closed the connection before sending a full image.');
};

/*
 * Where a still frame comes from, in order of preference.
 *
 * The ONVIF snapshot URI is asked for once per camera and cached: it is a SOAP
 * round trip, and asking again at every stop would add a second or more to
 * each one — on a twelve-stop sweep that is the difference between half a
 * minute and a minute of people standing still.
 */
const snapshotUriCache = new Map();

const snapshotUrlFor = async (camera) => {
  if (camera?.ptz?.snapshotUrl) return camera.ptz.snapshotUrl;

  const cached = snapshotUriCache.get(camera.id);
  if (cached && cached.expires > Date.now()) return cached.url;

  if (ptzReady(camera)) {
    try {
      const url = await getSnapshotUri(camera.ptz.deviceUrl, camera.ptz.profileToken, credentialsFor(camera));
      snapshotUriCache.set(camera.id, { url, expires: Date.now() + 600_000 });
      return url;
    } catch {
      // Fall through to the stream address below.
    }
  }

  // Last resort: the address the camera was registered with, which works when
  // it is an HTTP still or an MJPEG stream and cannot work when it is RTSP.
  if (/^https?:/i.test(camera?.address || '')) return camera.address;

  throw new PtzError(
    'NO_SNAPSHOT',
    'This camera has no still-image source. Add a snapshot URL, or register it with an HTTP stream address — RTSP cannot be read directly.',
  );
};

/** Forgets a cached snapshot URL, for when the camera is reconfigured. */
export const forgetSnapshotUrl = (cameraId) => snapshotUriCache.delete(cameraId);

/**
 * A single frame from the camera, as JPEG bytes.
 *
 * This is a server-side grab on purpose. The page cannot read these pixels
 * itself: a camera serves no Access-Control-Allow-Origin, so drawing its
 * stream into a canvas taints the canvas and every read throws — which is
 * exactly the wall the live detection overlay already runs into. Fetched here
 * and handed to the browser from this origin, the pixels are readable and face
 * recognition can run on them.
 */
export const grabFrame = async (camera) => {
  const url = await snapshotUrlFor(camera);
  const { username, password, timeoutMs } = credentialsFor(camera);

  let response;
  try {
    response = await fetchWithAuth(url, { username, password, timeoutMs: Math.max(timeoutMs, 10_000) });
  } catch (error) {
    throw new PtzError('CAMERA_UNREACHABLE', `The camera image could not be fetched (${error?.cause?.code || error?.message || 'connection failed'}).`);
  }

  if (response.status === 401) {
    throw new PtzError('CAMERA_UNAUTHORISED', 'The camera rejected the credentials for its image.');
  }
  if (!response.ok) {
    throw new PtzError('NO_SNAPSHOT', `The camera answered ${response.status} for its image.`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (/multipart/i.test(contentType)) {
    return { buffer: await readOneJpeg(response), contentType: 'image/jpeg' };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new PtzError('NO_SNAPSHOT', 'The camera returned an empty image.');
  return { buffer, contentType: /^image\//i.test(contentType) ? contentType : 'image/jpeg' };
};

/** Maps a PtzError onto an HTTP status. */
export const ptzStatusCode = (error) => {
  switch (error?.code) {
    case 'PTZ_DISABLED':
    case 'PTZ_UNCONFIGURED':
    case 'PTZ_UNSUPPORTED':
      return 409;
    case 'CAMERA_UNAUTHORISED':
      return 502;
    case 'CAMERA_TIMEOUT':
      return 504;
    case 'CAMERA_UNREACHABLE':
    case 'CAMERA_REFUSED':
    case 'NO_SNAPSHOT':
      return 502;
    default:
      return 500;
  }
};
