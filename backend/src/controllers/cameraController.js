import { createCamera, getCameraById, getCameras } from '../models/store.js';

const cameraFields = (body = {}) => ({
  name: String(body.name || '').trim(),
  location: String(body.location || '').trim(),
  address: String(body.address || '').trim(),
  status: String(body.status || 'offline').toLowerCase(),
  notes: String(body.notes || '').trim(),
});

const validateCamera = (camera) => {
  if (!camera.name || !camera.location || !camera.address) {
    return 'Name, location, and address are required.';
  }
  if (!['online', 'offline', 'maintenance'].includes(camera.status)) {
    return 'Status must be online, offline, or maintenance.';
  }
  return '';
};

export const listCameras = async (req, res) => {
  const cameras = await getCameras();
  return res.json({ cameras: cameras.map((camera) => camera.toObject ? camera.toObject() : camera) });
};

export const createCameraRecord = async (req, res) => {
  const camera = cameraFields(req.body);
  const validationError = validateCamera(camera);
  if (validationError) return res.status(400).json({ message: validationError });

  const created = await createCamera(camera);
  return res.status(201).json({ camera: created.toObject ? created.toObject() : created });
};

export const updateCamera = async (req, res) => {
  const camera = await getCameraById(req.params.id);
  if (!camera) return res.status(404).json({ message: 'Camera not found.' });

  const updates = cameraFields(req.body);
  const validationError = validateCamera(updates);
  if (validationError) return res.status(400).json({ message: validationError });

  Object.assign(camera, updates);
  await camera.save();
  return res.json({ camera: camera.toObject ? camera.toObject() : camera });
};

export const deleteCamera = async (req, res) => {
  const camera = await getCameraById(req.params.id);
  if (!camera) return res.status(404).json({ message: 'Camera not found.' });

  await camera.deleteOne();
  return res.json({ ok: true });
};
