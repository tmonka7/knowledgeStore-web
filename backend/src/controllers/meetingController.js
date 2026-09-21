import fs from 'node:fs/promises';
import { randomUUID } from 'crypto';
import {
  addRecording,
  createMeeting,
  deleteMeetingMessages,
  endMeeting,
  getMeetingById,
  getMeetingFor,
  getMeetingsFor,
  removeRecording,
} from '../models/meetingModel.js';
import { closeRoom, roomCounts, roomSnapshot } from '../helpers/meetingSignaling.js';
import { resolveMeetingUpload } from '../helpers/meetingUploads.js';
import { getUsers } from '../models/userModel.js';
import { writeLog } from '../models/activityLogModel.js';

const MAX_TITLE = 160;
const MAX_DESCRIPTION = 2000;

const asPlain = (document) => (document?.toObject ? document.toObject() : document);

/*
 * How browsers are told to find each other.
 *
 * On one network none of this is needed — the peers trade their own LAN
 * addresses and connect directly. Across the internet a STUN server is what
 * lets each side discover its public address, and the public one below is
 * enough for most home and office routers.
 *
 * What STUN cannot do is get through symmetric NAT or a firewall that blocks
 * peer-to-peer UDP outright; that needs a TURN server, which relays the media
 * and therefore has to be one you run or pay for. Set MEETING_TURN_URL and its
 * credentials to add one, or MEETING_ICE_SERVERS to replace the list entirely
 * with raw JSON. Without TURN, a minority of participants on hostile networks
 * will fail to connect, and there is no way around that here.
 */
const readIceServers = () => {
  const raw = process.env.MEETING_ICE_SERVERS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
      console.warn('MEETING_ICE_SERVERS is not a non-empty array; falling back to the default.');
    } catch (error) {
      console.warn('MEETING_ICE_SERVERS is not valid JSON; falling back to the default:', error.message);
    }
  }

  const servers = [{ urls: process.env.MEETING_STUN_URL || 'stun:stun.l.google.com:19302' }];

  if (process.env.MEETING_TURN_URL) {
    servers.push({
      urls: process.env.MEETING_TURN_URL,
      username: process.env.MEETING_TURN_USERNAME || '',
      credential: process.env.MEETING_TURN_PASSWORD || '',
    });
  }

  return servers;
};

/**
 * A meeting as the browser sees it.
 *
 * `live`, `activeCount` and `activePeople` come from the signalling server's
 * live sockets rather than from the document, which is why a room can never be
 * shown as occupied by someone who has gone.
 */
const describeMeeting = (meeting, me, snapshot) => {
  const plain = asPlain(meeting);
  const occupancy = snapshot || roomSnapshot(plain.id);
  const ended = plain.status === 'ended';

  return {
    id: plain.id,
    title: plain.title,
    description: plain.description,
    hostId: plain.hostId,
    hostName: plain.hostName,
    openToAll: Boolean(plain.openToAll),
    inviteeIds: plain.inviteeIds || [],
    scheduledAt: plain.scheduledAt,
    status: plain.status,
    startedAt: plain.startedAt,
    endedAt: plain.endedAt,
    createdAt: plain.createdAt,
    live: !ended && occupancy.count > 0,
    activeCount: ended ? 0 : occupancy.count,
    activePeople: ended ? [] : occupancy.people,
    attendedCount: new Set((plain.participants || []).map((row) => row.userId)).size,
    participants: [...(plain.participants || [])]
      .sort((a, b) => new Date(b.joinedAt) - new Date(a.joinedAt)),
    recordings: [...(plain.recordings || [])]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    isHost: plain.hostId === me.id,
    canManage: plain.hostId === me.id || me.role === 'admin',
  };
};

/*
 * List order: what is happening now, then what is about to, then the archive.
 *
 * Done here rather than in the query because "live" is not a stored field —
 * Mongo cannot sort on something it does not hold.
 */
const listRank = (meeting) => {
  if (meeting.live) return 0;
  if (meeting.status !== 'ended') return 1;
  return 2;
};

const sortForList = (a, b) => {
  const byRank = listRank(a) - listRank(b);
  if (byRank) return byRank;

  // Soonest first among things still to come; most recent first among the rest.
  if (listRank(a) === 1) {
    const at = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Infinity;
    const bt = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Infinity;
    if (at !== bt) return at - bt;
  }

  return new Date(b.endedAt || b.createdAt) - new Date(a.endedAt || a.createdAt);
};

/** GET /meetings/ice — the STUN/TURN list, so it can change without a rebuild. */
export const listIceServers = (req, res) => res.json({ iceServers: readIceServers() });

export const listMeetings = async (req, res) => {
  const me = req.currentUser;
  const meetings = await getMeetingsFor(me.id);
  // One pass over the live rooms rather than a lookup per meeting.
  const counts = roomCounts();

  const described = meetings
    .map((meeting) => describeMeeting(meeting, me, counts.get(meeting.id)))
    .sort(sortForList);

  return res.json({ meetings: described });
};

export const getMeeting = async (req, res) => {
  const me = req.currentUser;
  const meeting = await getMeetingFor(me.id, req.params.id);
  if (!meeting) return res.status(404).json({ message: 'Meeting not found.' });

  return res.json({ meeting: describeMeeting(meeting, me) });
};

const readMeetingFields = async (body = {}) => {
  const title = String(body.title || '').trim().slice(0, MAX_TITLE);
  if (!title) return { error: 'A meeting needs a title.' };

  let scheduledAt = null;
  if (body.scheduledAt) {
    const parsed = new Date(body.scheduledAt);
    if (Number.isNaN(parsed.getTime())) return { error: 'That start time is not a valid date.' };
    scheduledAt = parsed;
  }

  const openToAll = body.openToAll !== false && body.openToAll !== 'false';

  let inviteeIds = [];
  if (!openToAll) {
    const wanted = [...new Set((Array.isArray(body.inviteeIds) ? body.inviteeIds : []).map(String))];
    if (!wanted.length) {
      return { error: 'Choose who may join, or leave the meeting open to everyone.' };
    }

    // Checked against real accounts, so a closed room cannot be locked to an id
    // that does not exist — which would leave a meeting nobody but the host
    // could ever enter.
    const accounts = await getUsers();
    const known = new Set(accounts.map((account) => account.id));
    const missing = wanted.filter((id) => !known.has(id));
    if (missing.length) return { error: 'One of those people no longer has an account.' };

    inviteeIds = wanted;
  }

  return {
    values: {
      title,
      description: String(body.description || '').trim().slice(0, MAX_DESCRIPTION),
      scheduledAt,
      openToAll,
      inviteeIds,
    },
  };
};

export const createMeetingRecord = async (req, res) => {
  const me = req.currentUser;
  const { values, error } = await readMeetingFields(req.body);
  if (error) return res.status(400).json({ message: error });

  const created = await createMeeting({
    ...values,
    hostId: me.id,
    hostName: me.fullName || me.username || '',
  });

  await writeLog({
    source: 'meetings',
    action: 'meeting:create',
    message: `Created meeting "${values.title}"`,
    actor: { id: me.id, username: me.username },
  });

  return res.status(201).json({ meeting: describeMeeting(created, me) });
};

export const updateMeetingRecord = async (req, res) => {
  const me = req.currentUser;
  const meeting = await getMeetingFor(me.id, req.params.id);
  if (!meeting) return res.status(404).json({ message: 'Meeting not found.' });

  // Holding 'meetings:edit' means you may edit meetings; it does not mean you
  // may edit everybody's. Whose is decided here, by the host, not by the route.
  if (meeting.hostId !== me.id && me.role !== 'admin') {
    return res.status(403).json({ message: 'Only the host can change this meeting.' });
  }
  if (meeting.status === 'ended') {
    return res.status(400).json({ message: 'That meeting has already ended.' });
  }

  const { values, error } = await readMeetingFields(req.body);
  if (error) return res.status(400).json({ message: error });

  Object.assign(meeting, values, { updatedAt: new Date() });
  await meeting.save();

  // Narrowing an open room, or dropping someone from the invitee list, has to
  // take effect on the people already inside it — otherwise the one person who
  // was just excluded is the one person still in the call.
  if (!values.openToAll) {
    const allowed = new Set([...values.inviteeIds, meeting.hostId]);
    const present = roomSnapshot(meeting.id).people;
    if (present.some((person) => !allowed.has(person.userId))) {
      closeRoom(meeting.id, 'The host changed who may join this meeting.');
    }
  }

  return res.json({ meeting: describeMeeting(meeting, me) });
};

export const finishMeeting = async (req, res) => {
  const me = req.currentUser;
  const meeting = await getMeetingFor(me.id, req.params.id);
  if (!meeting) return res.status(404).json({ message: 'Meeting not found.' });

  if (meeting.hostId !== me.id && me.role !== 'admin') {
    return res.status(403).json({ message: 'Only the host can end this meeting.' });
  }

  await endMeeting(meeting.id);
  // Ending it has to turn people out, or the call carries on in a room the
  // list says is over.
  const closed = closeRoom(meeting.id);

  await writeLog({
    source: 'meetings',
    action: 'meeting:end',
    message: `Ended meeting "${meeting.title}" (${closed} connection(s) closed)`,
    actor: { id: me.id, username: me.username },
  });

  const updated = await getMeetingById(meeting.id);
  return res.json({ meeting: describeMeeting(updated, me) });
};

/** Removes a recording's file, reporting rather than throwing if it is already gone. */
const unlinkRecording = async (recording) => {
  const absolute = resolveMeetingUpload(recording.path);
  if (!absolute) {
    console.warn(`Refusing to delete a recording outside the meetings folder: ${recording.path}`);
    return false;
  }

  try {
    await fs.unlink(absolute);
    return true;
  } catch (error) {
    // Already deleted by hand or by a restore is not a failure worth refusing
    // the request over; anything else is worth a line in the log.
    if (error.code !== 'ENOENT') console.warn(`Could not delete ${recording.path}:`, error.message);
    return false;
  }
};

export const deleteMeetingRecord = async (req, res) => {
  const me = req.currentUser;
  const meeting = await getMeetingFor(me.id, req.params.id);
  if (!meeting) return res.status(404).json({ message: 'Meeting not found.' });

  if (meeting.hostId !== me.id && me.role !== 'admin') {
    return res.status(403).json({ message: 'Only the host can delete this meeting.' });
  }

  closeRoom(meeting.id, 'This meeting was deleted.');

  // The files go with the document. Leaving them would make every recording an
  // orphan the moment its meeting was deleted — invisible, undeletable from the
  // UI, and still taking up the disk.
  for (const recording of meeting.recordings || []) {
    await unlinkRecording(recording);
  }
  await deleteMeetingMessages(meeting.id);
  await meeting.deleteOne();

  await writeLog({
    source: 'meetings',
    action: 'meeting:delete',
    message: `Deleted meeting "${meeting.title}"`,
    actor: { id: me.id, username: me.username },
  });

  return res.json({ ok: true });
};

/**
 * POST /meetings/:id/recordings
 *
 * The recording is made in the browser, by whoever pressed record, and arrives
 * here as one finished file. Nothing is captured server-side — this server
 * never sees the media otherwise, and a recording nobody in the room knew about
 * is not something it should be able to produce.
 */
export const uploadRecording = async (req, res) => {
  const me = req.currentUser;
  const meeting = await getMeetingFor(me.id, req.params.id);
  if (!meeting) return res.status(404).json({ message: 'Meeting not found.' });
  if (!req.file) return res.status(400).json({ message: 'No recording was uploaded.' });

  const recording = {
    id: randomUUID(),
    name: String(req.body.name || '').trim().slice(0, 200)
      || `${meeting.title} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}.webm`,
    path: `uploads/meetings/${req.file.filename}`,
    size: req.file.size || 0,
    mimeType: req.file.mimetype || '',
    durationMs: Math.max(0, Number(req.body.durationMs) || 0),
    recordedById: me.id,
    recordedByName: me.fullName || me.username || '',
  };

  await addRecording(meeting.id, recording);

  await writeLog({
    source: 'meetings',
    action: 'meeting:record',
    message: `Saved a recording of "${meeting.title}"`,
    actor: { id: me.id, username: me.username },
  });

  const updated = await getMeetingById(meeting.id);
  return res.status(201).json({ meeting: describeMeeting(updated, me) });
};

export const deleteRecordingFile = async (req, res) => {
  const me = req.currentUser;
  const meeting = await getMeetingFor(me.id, req.params.id);
  if (!meeting) return res.status(404).json({ message: 'Meeting not found.' });

  const recording = (meeting.recordings || []).find((row) => row.id === req.params.recordingId);
  if (!recording) return res.status(404).json({ message: 'Recording not found.' });

  // The host, an administrator, or the person who made it.
  const mayDelete = meeting.hostId === me.id
    || me.role === 'admin'
    || recording.recordedById === me.id;
  if (!mayDelete) {
    return res.status(403).json({ message: 'You cannot delete that recording.' });
  }

  await unlinkRecording(recording);
  await removeRecording(meeting.id, recording.id);

  const updated = await getMeetingById(meeting.id);
  return res.json({ meeting: describeMeeting(updated, me) });
};
