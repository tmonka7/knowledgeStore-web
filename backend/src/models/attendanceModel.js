import mongoose from 'mongoose';
import { randomUUID } from 'crypto';

/*
 * Automatic attendance: what one camera sweep saw.
 *
 * Three collections, because the three things have different lifetimes.
 *
 *   attendanceSessions  one sweep — who ran it, when, over what arc
 *   attendanceEntries   one person per sweep — the attendance list itself
 *   visitorFaces        a face that matched nobody, kept so it can be
 *                       recognised again and given a name later
 *
 * A note on the last one, because it is the part with real-world consequences
 * rather than only technical ones. A face descriptor is biometric data about
 * an identifiable person, and visitorFaces holds descriptors for people who
 * were never asked — anyone who walked in front of the camera. In most
 * jurisdictions that is a special category of personal data with its own legal
 * basis, retention and disclosure duties. Two things follow in the code:
 * these records expire (see purgeStaleVisitors, wired up at boot), and a
 * visitor face is never a credential — see the note on linkedUserId.
 */

const stopSchema = new mongoose.Schema({
  index: { type: Number, required: true },
  degrees: { type: Number, default: 0 },
  pan: { type: Number, default: 0 },
  tilt: { type: Number, default: 0 },
  zoom: { type: Number, default: 0 },
  // Filled in as the sweep progresses, so a session abandoned half way still
  // records how far it got rather than looking like it covered everything.
  visitedAt: { type: Date, default: null },
  facesFound: { type: Number, default: 0 },
  error: { type: String, default: '' },
}, { _id: false });

const sessionSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true, default: () => randomUUID() },
  cameraId: { type: String, required: true, index: true },
  cameraName: { type: String, default: '' },
  startedById: { type: String, required: true, index: true },
  startedByName: { type: String, default: '' },
  status: { type: String, enum: ['running', 'complete', 'cancelled', 'failed'], default: 'running', index: true },
  startedAt: { type: Date, default: Date.now, index: true },
  finishedAt: { type: Date, default: null },

  // The plan as computed when the sweep started. Kept verbatim rather than
  // recomputed for display: the camera's configuration may have been edited
  // since, and an attendance list has to stay readable as a record of what
  // actually happened.
  arcDegrees: { type: Number, default: 180 },
  coverageDegrees: { type: Number, default: 180 },
  fovDegrees: { type: Number, default: 0 },
  zoom: { type: Number, default: 0 },
  completeCoverage: { type: Boolean, default: true },
  stops: { type: [stopSchema], default: [] },

  knownCount: { type: Number, default: 0 },
  visitorCount: { type: Number, default: 0 },
  error: { type: String, default: '' },
}, { collection: 'attendanceSessions' });

const entrySchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true, default: () => randomUUID() },
  sessionId: { type: String, required: true, index: true },
  cameraId: { type: String, default: '', index: true },

  // 'user' for somebody with an account, 'visitor' for a face with no name.
  subjectType: { type: String, enum: ['user', 'visitor'], required: true },
  subjectId: { type: String, required: true, index: true },
  name: { type: String, default: '' },

  // How close the match was, and how much closer than the next candidate. Both
  // are kept because an attendance row that somebody disputes is answerable
  // only if the numbers behind it were written down at the time.
  distance: { type: Number, default: 0 },
  margin: { type: Number, default: 0 },

  stopIndex: { type: Number, default: 0 },
  panDegrees: { type: Number, default: 0 },
  // How many of the sweep's frames this person appeared in. Higher is better
  // evidence; one sighting at the edge of one frame is the weakest row here.
  sightings: { type: Number, default: 1 },
  faceImage: { type: String, default: '' },
  seenAt: { type: Date, default: Date.now },
}, { collection: 'attendanceEntries' });

// One row per person per sweep. The dedupe in the controller is what normally
// prevents a second row, but this makes it impossible rather than unlikely:
// two frames submitted concurrently could otherwise both pass the check.
entrySchema.index({ sessionId: 1, subjectType: 1, subjectId: 1 }, { unique: true });

const visitorSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true, default: () => randomUUID() },
  // The 128 numbers face recognition compares. Not select:false — every lookup
  // needs it — but see the privacy note at the top of this file.
  faceDescriptor: { type: [Number], required: true },
  faceImage: { type: String, default: '' },
  // Whatever an operator has called them, e.g. "Delivery driver".
  label: { type: String, default: '' },
  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now, index: true },
  seenCount: { type: Number, default: 1 },
  firstCameraId: { type: String, default: '' },
  firstSessionId: { type: String, default: '' },

  /*
   * Set once an operator says "this visitor is that account".
   *
   * It records the association for attendance and NOTHING ELSE. In particular
   * it is never copied into the account's own faceDescriptor, and face sign-in
   * never reads this collection. It must not: getFaceCandidates deliberately
   * searches only enrolled, approved accounts, and a face that got into the
   * database by walking past a camera has proved nothing about who it belongs
   * to. Letting these descriptors reach the sign-in search would mean a
   * stranger could be enrolled as a colleague by an operator's mistake — or by
   * standing in the right place at the right time — and then sign in as them.
   */
  linkedUserId: { type: String, default: null, index: true },
  linkedByName: { type: String, default: '' },
  linkedAt: { type: Date, default: null },
}, { collection: 'visitorFaces' });

export const AttendanceSession = mongoose.models.AttendanceSession
  || mongoose.model('AttendanceSession', sessionSchema);
export const AttendanceEntry = mongoose.models.AttendanceEntry
  || mongoose.model('AttendanceEntry', entrySchema);
export const VisitorFace = mongoose.models.VisitorFace
  || mongoose.model('VisitorFace', visitorSchema);

export const createAttendanceSession = (data) => AttendanceSession.create({ id: randomUUID(), ...data });
export const getAttendanceSession = (id) => AttendanceSession.findOne({ id });
export const listAttendanceSessions = ({ limit = 50, cameraId } = {}) => AttendanceSession
  .find(cameraId ? { cameraId } : {})
  .sort({ startedAt: -1 })
  .limit(Math.min(200, Math.max(1, limit)));

export const listSessionEntries = (sessionId) => AttendanceEntry
  .find({ sessionId })
  .sort({ name: 1 });

/** Every stored visitor face, for matching a new sighting against. */
export const listVisitorFaces = () => VisitorFace.find();
export const getVisitorFace = (id) => VisitorFace.findOne({ id });

/**
 * Deletes visitor faces that were never identified and have not been seen for
 * a while. Linked visitors are kept: somebody decided they mattered.
 *
 * Retention rather than accumulation is the point. Without it the database
 * grows a permanent biometric record of every person who has ever walked past
 * a camera, which is both a liability and, in several jurisdictions, unlawful.
 */
export const purgeStaleVisitors = async (days = Number(process.env.VISITOR_FACE_RETENTION_DAYS) || 30) => {
  if (!Number.isFinite(days) || days <= 0) return 0;
  const cutoff = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
  const result = await VisitorFace.deleteMany({ linkedUserId: null, lastSeenAt: { $lt: cutoff } });
  return result.deletedCount || 0;
};
