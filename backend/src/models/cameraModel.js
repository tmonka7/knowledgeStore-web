import mongoose from 'mongoose';
import { randomUUID } from 'crypto';

const cameraSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true, default: () => randomUUID() },
  name: { type: String, required: true, trim: true },
  location: { type: String, required: true, trim: true },
  address: { type: String, required: true, trim: true },
  status: { type: String, enum: ['online', 'offline', 'maintenance'], default: 'offline' },
  notes: { type: String, default: '', trim: true },
  createdAt: { type: Date, default: Date.now },
}, { collection: 'cameras' });

export const Camera = mongoose.models.Camera || mongoose.model('Camera', cameraSchema);

export const getCameras = () => Camera.find().sort({ createdAt: -1 });
export const getCameraById = (id) => Camera.findOne({ id });
export const createCamera = (data) => Camera.create({ id: randomUUID(), ...data });
