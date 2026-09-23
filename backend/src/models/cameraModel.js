import mongoose from 'mongoose';
import { randomUUID } from 'crypto';

/*
 * PTZ control settings.
 *
 * Kept separate from `address` because they are a different thing: `address`
 * is where the pictures come from and is often RTSP, while control is an ONVIF
 * SOAP endpoint, usually on port 80 and usually authenticated with an account
 * that is not the one in the stream URL.
 *
 * `password` is select:false. Cameras are listed on a page any user with
 * cameras:view can open, and without this the camera's administrative password
 * would be in the JSON of that list — readable by everyone who can see the
 * page, and sitting in the browser's memory and in any proxy log along the
 * way. It is loaded explicitly, only by the code that is about to talk to the
 * camera. See getCameraForControl.
 */
const ptzSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: false },
  protocol: { type: String, enum: ['onvif'], default: 'onvif' },
  // e.g. http://192.168.1.20/onvif/device_service
  deviceUrl: { type: String, default: '', trim: true },
  username: { type: String, default: '', trim: true },
  password: { type: String, default: '', select: false },
  // Which media profile to move and grab frames from; chosen from the list the
  // camera reports when Detect is run.
  profileToken: { type: String, default: '', trim: true },
  profileName: { type: String, default: '', trim: true },
  // Optional override. When empty the ONVIF snapshot URI is used.
  snapshotUrl: { type: String, default: '', trim: true },

  /*
   * The optics and mechanics, which the sweep planner needs and ONVIF does not
   * report in any usable form. Defaults suit a typical PTZ dome; they are
   * editable because getting hfovDegrees wrong is precisely what opens gaps
   * between frames, and a gap is a person marked absent.
   */
  panRangeDegrees: { type: Number, default: 360, min: 1, max: 360 },
  hfovDegrees: { type: Number, default: 65, min: 1, max: 180 },
  maxZoomFactor: { type: Number, default: 20, min: 1, max: 60 },
  // Centre of the sweep arc, in camera degrees. The 180-degree arc is built
  // around this, so it is how you aim a wall-mounted camera at the room rather
  // than at the wall behind it.
  homeDegrees: { type: Number, default: 0, min: -180, max: 180 },
  tilt: { type: Number, default: 0, min: -1, max: 1 },
  moveSpeed: { type: Number, default: 0.6, min: 0.05, max: 1 },
  settleMs: { type: Number, default: 900, min: 0, max: 10_000 },
  timeoutMs: { type: Number, default: 8000, min: 1000, max: 60_000 },
}, { _id: false });

const cameraSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true, default: () => randomUUID() },
  name: { type: String, required: true, trim: true },
  location: { type: String, required: true, trim: true },
  address: { type: String, required: true, trim: true },
  status: { type: String, enum: ['online', 'offline', 'maintenance'], default: 'offline' },
  notes: { type: String, default: '', trim: true },
  ptz: { type: ptzSchema, default: () => ({}) },
  createdAt: { type: Date, default: Date.now },
}, { collection: 'cameras' });

export const Camera = mongoose.models.Camera || mongoose.model('Camera', cameraSchema);

export const getCameras = () => Camera.find().sort({ createdAt: -1 });
export const getCameraById = (id) => Camera.findOne({ id });
export const createCamera = (data) => Camera.create({ id: randomUUID(), ...data });

/**
 * A camera WITH its PTZ password, for the code that is about to use it.
 *
 * Deliberately a separate function from getCameraById rather than a flag on
 * it: every existing caller keeps the safe behaviour, and the places that pull
 * the secret out of the database are the places that name this function.
 */
export const getCameraForControl = (id) => Camera.findOne({ id }).select('+ptz.password');

/**
 * A camera as it goes over the wire.
 *
 * The password is stripped again here rather than relied upon to be absent.
 * getCameraForControl exists, its result is one `res.json` away from being
 * published to the browser, and this is the single place that decides what a
 * camera looks like to a client.
 */
export const publicCamera = (camera) => {
  const plain = camera?.toObject ? camera.toObject() : { ...camera };
  if (plain.ptz) {
    const { password, ...ptz } = plain.ptz;
    // Whether a password is set is useful to the settings form; the password
    // itself never is.
    plain.ptz = { ...ptz, hasPassword: Boolean(password) };
  }
  return plain;
};
