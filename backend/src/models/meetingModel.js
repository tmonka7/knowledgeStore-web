import mongoose from 'mongoose';
import { randomUUID } from 'crypto';

/*
 * Video meetings.
 *
 * What lives here is everything that must outlast the call: who booked it, who
 * may join, who actually turned up, what was said in the side chat and which
 * recordings were kept.
 *
 * What deliberately does NOT live here is who is in the room right now. That is
 * held in memory by the signalling server (helpers/meetingSignaling.js) and read
 * from there. Writing occupancy to the database looks tidier, but a crash or a
 * dropped socket then leaves a room that is permanently "3 people in a call"
 * with nobody in it, and nothing ever corrects it. Occupancy is derived from
 * live sockets, so it cannot go stale — the cost is that it is per-process, and
 * this app runs one backend.
 */

const participantSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  name: { type: String, default: '' },
  joinedAt: { type: Date, default: Date.now },
  leftAt: { type: Date, default: null },
}, { _id: false });

const recordingSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  path: { type: String, required: true },
  size: { type: Number, default: 0 },
  mimeType: { type: String, default: '' },
  durationMs: { type: Number, default: 0 },
  recordedById: { type: String, default: '' },
  recordedByName: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const meetingSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true, default: () => randomUUID() },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  hostId: { type: String, required: true, index: true },
  hostName: { type: String, default: '' },
  // The default is an open room, because the common case is a team call that
  // nobody should have to be added to one name at a time. Naming invitees
  // turns it into a closed room.
  openToAll: { type: Boolean, default: true },
  inviteeIds: { type: [String], default: [], index: true },
  // A calendar day plus time, or null for "start it whenever".
  scheduledAt: { type: Date, default: null },
  // 'ended' is the only status that is actually stored. "Live" is not a stored
  // state — see the note at the top of this file.
  status: { type: String, enum: ['scheduled', 'ended'], default: 'scheduled' },
  startedAt: { type: Date, default: null },
  endedAt: { type: Date, default: null },
  // The attendance log: one entry per join, so leaving and rejoining shows as
  // two visits rather than silently rewriting the first.
  participants: { type: [participantSchema], default: [] },
  recordings: { type: [recordingSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'meetings' });

const meetingMessageSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true, default: () => randomUUID() },
  meetingId: { type: String, required: true, index: true },
  senderId: { type: String, required: true },
  senderName: { type: String, default: '' },
  body: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, index: true },
}, { collection: 'meeting_messages' });

export const Meeting = mongoose.models.Meeting || mongoose.model('Meeting', meetingSchema);
export const MeetingMessage = mongoose.models.MeetingMessage
  || mongoose.model('MeetingMessage', meetingMessageSchema);

/** Rooms this account is allowed into: its own, open ones, and ones it is named on. */
export const meetingAccessFilter = (userId) => ({
  $or: [
    { hostId: userId },
    { openToAll: true },
    { inviteeIds: userId },
  ],
});

/*
 * The access clause is an $or, and so is any text search, so the two are always
 * combined under $and. Dropping them into one object instead would let the
 * second overwrite the first and quietly open every room in the database.
 */
const allClauses = (...clauses) => {
  const kept = clauses.filter(Boolean);
  if (!kept.length) return {};
  return kept.length === 1 ? kept[0] : { $and: kept };
};

export const getMeetingsFor = (userId) => Meeting
  .find(meetingAccessFilter(userId))
  .sort({ createdAt: -1 });

export const getMeetingFor = (userId, id) => Meeting
  .findOne(allClauses({ id }, meetingAccessFilter(userId)));

export const getMeetingById = (id) => Meeting.findOne({ id });

export const createMeeting = (data) => Meeting.create({ id: randomUUID(), ...data });

/**
 * Records a join in the attendance log and stamps the first start.
 *
 * `startedAt` is only written when it is still empty, so a second person
 * arriving does not reset the clock on a call already in progress.
 */
export const markJoined = async (id, userId, name) => {
  await Meeting.updateOne(
    { id, startedAt: null },
    { $set: { startedAt: new Date() } },
  );

  return Meeting.updateOne({ id }, {
    $push: { participants: { userId, name, joinedAt: new Date(), leftAt: null } },
    $set: { updatedAt: new Date() },
  });
};

/**
 * Closes the most recent open visit for this account.
 *
 * Positional `$` on the first matching element rather than a blanket update:
 * an account that joined twice has two entries, and only the one still open
 * should be stamped.
 */
export const markLeft = (id, userId) => Meeting.updateOne(
  { id, participants: { $elemMatch: { userId, leftAt: null } } },
  { $set: { 'participants.$.leftAt': new Date(), updatedAt: new Date() } },
);

export const endMeeting = (id) => Meeting.updateOne({ id }, {
  $set: { status: 'ended', endedAt: new Date(), updatedAt: new Date() },
});

export const addRecording = (id, recording) => Meeting.updateOne({ id }, {
  $push: { recordings: { ...recording, createdAt: new Date() } },
  $set: { updatedAt: new Date() },
});

export const removeRecording = (id, recordingId) => Meeting.updateOne({ id }, {
  $pull: { recordings: { id: recordingId } },
  $set: { updatedAt: new Date() },
});

/* ------------------------------------------------------------ side chat */

export const saveMeetingMessage = (data) => MeetingMessage.create({ id: randomUUID(), ...data });

/**
 * The tail of the side chat, oldest first.
 *
 * Fetched newest-first and reversed, because the interesting end of a long
 * conversation is the recent end — taking the first 100 of a busy meeting
 * would hand a late joiner the opening small talk and nothing since.
 */
export const getMeetingMessages = async (meetingId, limit = 100) => {
  const rows = await MeetingMessage.find({ meetingId })
    .sort({ createdAt: -1 })
    .limit(limit);
  return rows.reverse();
};

export const deleteMeetingMessages = (meetingId) => MeetingMessage.deleteMany({ meetingId });
