import { createCamera, getCameraById, getCameraForControl, getCameras, publicCamera } from '../models/store.js';
import { discoverCameras, forgetSnapshotUrl, localSubnet } from '../helpers/ptz/index.js';

const cameraFields = (body = {}) => ({
  name: String(body.name || '').trim(),
  location: String(body.location || '').trim(),
  address: String(body.address || '').trim(),
  status: String(body.status || 'offline').toLowerCase(),
  notes: String(body.notes || '').trim(),
});

const number = (value, fallback, low, high) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(high, Math.max(low, parsed));
};

/**
 * PTZ settings from a request body, merged onto what is already stored.
 *
 * `existing` matters for one field. The browser is never sent the camera's
 * password, so the settings form cannot send it back; an absent or empty
 * password therefore means "leave it alone", not "clear it". Without that, the
 * first time anyone edited a camera's name the PTZ password would be wiped and
 * attendance would start failing with an authentication error nobody changed.
 */
const ptzFields = (body = {}, existing = {}) => {
  const ptz = body.ptz;
  if (!ptz || typeof ptz !== 'object') return undefined;

  const current = existing?.toObject ? existing.toObject() : (existing || {});

  return {
    enabled: Boolean(ptz.enabled),
    protocol: 'onvif',
    deviceUrl: String(ptz.deviceUrl ?? current.deviceUrl ?? '').trim(),
    username: String(ptz.username ?? current.username ?? '').trim(),
    password: ptz.password ? String(ptz.password) : (current.password || ''),
    profileToken: String(ptz.profileToken ?? current.profileToken ?? '').trim(),
    profileName: String(ptz.profileName ?? current.profileName ?? '').trim(),
    snapshotUrl: String(ptz.snapshotUrl ?? current.snapshotUrl ?? '').trim(),
    panRangeDegrees: number(ptz.panRangeDegrees ?? current.panRangeDegrees, 360, 1, 360),
    hfovDegrees: number(ptz.hfovDegrees ?? current.hfovDegrees, 65, 1, 180),
    maxZoomFactor: number(ptz.maxZoomFactor ?? current.maxZoomFactor, 20, 1, 60),
    homeDegrees: number(ptz.homeDegrees ?? current.homeDegrees, 0, -180, 180),
    tilt: number(ptz.tilt ?? current.tilt, 0, -1, 1),
    moveSpeed: number(ptz.moveSpeed ?? current.moveSpeed, 0.6, 0.05, 1),
    settleMs: number(ptz.settleMs ?? current.settleMs, 900, 0, 10_000),
    timeoutMs: number(ptz.timeoutMs ?? current.timeoutMs, 8000, 1000, 60_000),
  };
};

const validateCamera = (camera) => {
  if (!camera.name || !camera.location || !camera.address) {
    return 'Name, location, and address are required.';
  }
  if (!['online', 'offline', 'maintenance'].includes(camera.status)) {
    return 'Status must be online, offline, or maintenance.';
  }
  return '';
};

const validatePtz = (ptz) => {
  if (!ptz || !ptz.enabled) return '';
  if (!ptz.deviceUrl) return 'Enter the camera ONVIF service address to enable PTZ.';
  if (!/^https?:\/\//i.test(ptz.deviceUrl)) return 'The ONVIF service address must start with http:// or https://.';
  if (ptz.snapshotUrl && !/^https?:\/\//i.test(ptz.snapshotUrl)) return 'The snapshot URL must start with http:// or https://.';
  return '';
};

export const listCameras = async (req, res) => {
  const cameras = await getCameras();
  return res.json({ cameras: cameras.map(publicCamera) });
};

/*
 * The host part of anything a camera might have been registered with: a bare
 * IP, an RTSP stream URL, an ONVIF service URL. It is what decides whether a
 * discovered device is already in the list, and comparing the raw strings
 * would fail every time, since "192.168.1.20" and
 * "rtsp://192.168.1.20:554/stream" are the same camera.
 */
const hostOf = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    return new URL(/:\/\//.test(text) ? text : `http://${text}`).hostname.toLowerCase();
  } catch {
    return text.toLowerCase();
  }
};

/**
 * POST /cameras/discover — ask the network which cameras are on it.
 *
 * Nothing is created here. The answer is a list of candidates, each one
 * already marked with whether it is a camera this system knows about, so the
 * dialog can show an operator what is new rather than making them compare
 * addresses by eye against the page behind it.
 */
export const discoverNetworkCameras = async (req, res) => {
  const { sweep = false, subnet = '' } = req.body || {};

  try {
    const { cameras: found, sweptSubnet } = await discoverCameras({
      sweep: Boolean(sweep),
      subnet: String(subnet || '').trim(),
    });

    const known = new Set();
    for (const camera of await getCameras()) {
      const address = hostOf(camera.address);
      const deviceUrl = hostOf(camera.ptz?.deviceUrl);
      if (address) known.add(address);
      if (deviceUrl) known.add(deviceUrl);
    }

    return res.json({
      cameras: found.map((camera) => ({ ...camera, existing: known.has(camera.address.toLowerCase()) })),
      sweptSubnet,
      // Offered back so the dialog can show the subnet it would sweep before
      // anybody types one.
      defaultSubnet: localSubnet(),
    });
  } catch (error) {
    // The one failure worth spelling out is a subnet this refuses to sweep;
    // an operator can fix that by typing a different one.
    if (/subnet/i.test(error?.message || '')) {
      return res.status(400).json({ message: error.message });
    }
    console.error('Camera discovery failed:', error);
    return res.status(500).json({ message: 'The network could not be searched.' });
  }
};

export const createCameraRecord = async (req, res) => {
  const camera = cameraFields(req.body);
  const validationError = validateCamera(camera);
  if (validationError) return res.status(400).json({ message: validationError });

  const ptz = ptzFields(req.body);
  const ptzError = validatePtz(ptz);
  if (ptzError) return res.status(400).json({ message: ptzError });

  const created = await createCamera(ptz ? { ...camera, ptz } : camera);
  return res.status(201).json({ camera: publicCamera(created) });
};

export const updateCamera = async (req, res) => {
  // Loaded WITH the password, because an edit that does not mention it has to
  // write the stored one back rather than an empty string.
  const camera = await getCameraForControl(req.params.id);
  if (!camera) return res.status(404).json({ message: 'Camera not found.' });

  const updates = cameraFields(req.body);
  const validationError = validateCamera(updates);
  if (validationError) return res.status(400).json({ message: validationError });

  const ptz = ptzFields(req.body, camera.ptz);
  const ptzError = validatePtz(ptz);
  if (ptzError) return res.status(400).json({ message: ptzError });

  Object.assign(camera, updates);
  if (ptz) camera.ptz = ptz;
  await camera.save();

  // The ONVIF snapshot URL is cached per camera, and it is derived from the
  // profile and address that may have just changed.
  forgetSnapshotUrl(camera.id);

  return res.json({ camera: publicCamera(camera) });
};

export const deleteCamera = async (req, res) => {
  const camera = await getCameraById(req.params.id);
  if (!camera) return res.status(404).json({ message: 'Camera not found.' });

  await camera.deleteOne();
  forgetSnapshotUrl(camera.id);
  return res.json({ ok: true });
};
