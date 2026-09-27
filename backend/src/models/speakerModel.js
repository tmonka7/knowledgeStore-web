import mongoose from 'mongoose';
import { randomUUID } from 'crypto';

/*
 * Enrolled voices for Tools > AI > Speaker recognition.
 *
 * A speaker is a name and a few voice samples. Each sample keeps its ECAPA-TDNN
 * voiceprint (192 numbers) and which model made it, since voiceprints from
 * different models cannot be compared. The audio itself is kept on disk
 * (helpers/speakerRecognition.js) so a sample can be listened to again.
 *
 * Voiceprints are biometric data. Speakers are personal, like contacts: every
 * query is scoped by ownerId, and the page needs a permission that is not
 * granted by default.
 */
const sampleSchema = new mongoose.Schema({
  id: { type: String, required: true },
  embedding: { type: [Number], required: true },
  model: { type: String, required: true },
  seconds: { type: Number, default: 0 },
  speechSeconds: { type: Number, default: 0 },
  source: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const speakerSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true, default: () => randomUUID() },
  ownerId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  note: { type: String, default: '', trim: true, maxlength: 500 },
  samples: { type: [sampleSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'speakers' });

export const Speaker = mongoose.models.Speaker || mongoose.model('Speaker', speakerSchema);
