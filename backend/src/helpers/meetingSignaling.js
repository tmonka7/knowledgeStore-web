import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { JWT_SECRET } from './auth.js';
import { hasPermission } from './permissionCatalog.js';
import { isUsableAccount, statusRefusal } from './accountStatus.js';
import { getUserById } from '../models/userModel.js';
import {
  getMeetingFor,
  getMeetingMessages,
  markJoined,
  markLeft,
  saveMeetingMessage,
} from '../models/meetingModel.js';

/*
 * WebRTC signalling.
 *
 * The media never touches this server: once two browsers have exchanged an
 * offer, an answer and their ICE candidates, the audio and video flow directly
 * between them. All this does is carry that handshake, keep the roster of who
 * is in a room, and relay the side chat.
 *
 * The topology is a full mesh — every participant holds a peer connection to
 * every other one. That needs no media server at all, which is the whole reason
 * it is possible to add this feature to a plain Express app, but the cost is
 * quadratic: each person uploads their camera once per other participant. It is
 * comfortable to about six people and is capped below.
 *
 * Rooms are held in memory. That makes occupancy self-correcting (a crashed
 * tab's socket closes and the peer disappears) at the price of being
 * single-process: two backend instances behind a load balancer would each see
 * half a meeting. This app runs one.
 */

export const WS_PATH = '/rtc';

// Beyond this the mesh stops being kind to anyone's uplink. Configurable
// because "how many is too many" depends entirely on the network it runs on.
const MAX_PEERS = Math.max(2, Number(process.env.MEETING_MAX_PEERS) || 8);

// A socket that connects and then says nothing is a socket that has no business
// being open.
const AUTH_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 30_000;
const MAX_CHAT_LENGTH = 2000;

/** meetingId -> Map(peerId -> peer) */
const rooms = new Map();

const roomOf = (meetingId) => {
  if (!rooms.has(meetingId)) rooms.set(meetingId, new Map());
  return rooms.get(meetingId);
};

const describePeer = (peer) => ({
  id: peer.id,
  userId: peer.userId,
  name: peer.name,
  state: peer.state,
});

const send = (peer, payload) => {
  // readyState 1 is OPEN. A socket that closed between the broadcast starting
  // and this line is normal, not an error.
  if (peer.socket.readyState !== 1) return;
  try {
    peer.socket.send(JSON.stringify(payload));
  } catch (error) {
    console.warn('Meeting signal send failed:', error.message);
  }
};

const broadcast = (meetingId, payload, exceptPeerId = null) => {
  for (const peer of roomOf(meetingId).values()) {
    if (peer.id === exceptPeerId) continue;
    send(peer, payload);
  }
};

/** Who is in this room right now, for the meeting list and the room header. */
export const roomSnapshot = (meetingId) => {
  const room = rooms.get(meetingId);
  if (!room || !room.size) return { count: 0, people: [] };

  // One entry per person, not per tab: someone with the meeting open twice is
  // one attendee, and showing them twice in the roster would be a bug report.
  const byUser = new Map();
  for (const peer of room.values()) {
    if (!byUser.has(peer.userId)) byUser.set(peer.userId, { userId: peer.userId, name: peer.name });
  }

  return { count: byUser.size, people: [...byUser.values()] };
};

/** Occupancy for every room at once, so the list page is not N queries. */
export const roomCounts = () => {
  const counts = new Map();
  for (const meetingId of rooms.keys()) {
    const snapshot = roomSnapshot(meetingId);
    if (snapshot.count) counts.set(meetingId, snapshot);
  }
  return counts;
};

/**
 * Turns everyone out of a room, used when the host ends or deletes a meeting.
 * The close code is deliberate so the browser can tell "the meeting is over"
 * apart from "the network dropped" and not try to reconnect.
 */
export const closeRoom = (meetingId, reason = 'This meeting has ended.') => {
  const room = rooms.get(meetingId);
  if (!room) return 0;

  const closed = room.size;
  for (const peer of room.values()) {
    send(peer, { type: 'ended', message: reason });
    try {
      peer.socket.close(4004, 'meeting-ended');
    } catch {
      // Already gone; the close handler does the bookkeeping either way.
    }
  }
  rooms.delete(meetingId);
  return closed;
};

const leaveRoom = async (peer) => {
  if (!peer.meetingId) return;

  const room = rooms.get(peer.meetingId);
  if (room) {
    room.delete(peer.id);
    if (!room.size) rooms.delete(peer.meetingId);
  }

  broadcast(peer.meetingId, { type: 'peer-left', peerId: peer.id });

  // The attendance log is only closed when the person's last tab goes: with two
  // tabs open, closing one is not leaving the meeting.
  const stillHere = [...(rooms.get(peer.meetingId)?.values() || [])]
    .some((other) => other.userId === peer.userId);

  if (!stillHere) {
    try {
      await markLeft(peer.meetingId, peer.userId);
    } catch (error) {
      console.warn('Could not record meeting departure:', error.message);
    }
  }

  peer.meetingId = null;
};

/**
 * Checks the token, then re-reads the account from the database.
 *
 * The token carries the role it had when it was issued, so it is never the
 * thing that decides anything — the same rule the REST middleware follows.
 */
const authenticate = async (token) => {
  let payload;
  try {
    payload = jwt.verify(String(token || ''), JWT_SECRET);
  } catch {
    return { error: 'Invalid or expired token.' };
  }

  const user = await getUserById(payload.sub);
  if (!user) return { error: 'User no longer exists.' };
  // The same check the REST middleware makes: an account denied while its
  // owner sat on the meetings page must not be able to open a socket.
  if (!isUsableAccount(user)) return { error: statusRefusal(user.status) };
  if (!hasPermission(user, 'meetings:view')) {
    return { error: 'You do not have permission to join meetings.' };
  }

  return { user };
};

const handleJoin = async (peer, message) => {
  const meetingId = String(message.meetingId || '');
  if (!meetingId) return send(peer, { type: 'error', code: 'bad-request', message: 'No meeting given.' });
  if (peer.meetingId) await leaveRoom(peer);

  // Access is checked here and not only when the page loaded: an invitation
  // can be withdrawn while someone sits on the meeting list.
  const meeting = await getMeetingFor(peer.userId, meetingId);
  if (!meeting) {
    return send(peer, { type: 'error', code: 'not-found', message: 'That meeting is not available to you.' });
  }
  if (meeting.status === 'ended') {
    return send(peer, { type: 'error', code: 'ended', message: 'That meeting has already ended.' });
  }

  const room = roomOf(meetingId);
  // Counted by person, so opening a second tab is never what makes a room full.
  const people = new Set([...room.values()].map((other) => other.userId));
  if (!people.has(peer.userId) && people.size >= MAX_PEERS) {
    return send(peer, {
      type: 'error',
      code: 'full',
      message: `This meeting is full (${MAX_PEERS} people).`,
    });
  }

  peer.meetingId = meetingId;
  room.set(peer.id, peer);

  try {
    await markJoined(meetingId, peer.userId, peer.name);
  } catch (error) {
    console.warn('Could not record meeting arrival:', error.message);
  }

  const history = await getMeetingMessages(meetingId);

  send(peer, {
    type: 'joined',
    self: describePeer(peer),
    // Everyone already here. They are the ones who will offer — see the note
    // on 'peer-joined' below.
    peers: [...room.values()].filter((other) => other.id !== peer.id).map(describePeer),
    history: history.map((row) => ({
      id: row.id,
      senderId: row.senderId,
      senderName: row.senderName,
      body: row.body,
      createdAt: row.createdAt,
    })),
    maxPeers: MAX_PEERS,
  });

  // Told only to the people already in the room, because they are the side that
  // creates the offer. Having exactly one side of each pair initiate is what
  // keeps the mesh free of glare — two peers offering each other at the same
  // moment is the classic way a WebRTC call ends up half-connected.
  broadcast(meetingId, { type: 'peer-joined', peer: describePeer(peer) }, peer.id);
  return undefined;
};

/**
 * Passes an offer, an answer or an ICE candidate to one other peer.
 *
 * The payload is opaque here and is forwarded untouched — but the destination
 * is not taken on trust. `to` is resolved inside the sender's own room, so a
 * crafted id cannot be used to push SDP at somebody in a different meeting.
 */
const handleSignal = (peer, message) => {
  if (!peer.meetingId) return;

  const target = rooms.get(peer.meetingId)?.get(String(message.to || ''));
  if (!target) return;

  send(target, { type: 'signal', from: peer.id, data: message.data });
};

const handleState = (peer, message) => {
  if (!peer.meetingId) return;

  peer.state = {
    muted: message.muted === true,
    cameraOff: message.cameraOff === true,
    sharing: message.sharing === true,
    // Everyone in the room is told when someone is recording. A recording
    // indicator that can be switched off is not a consent signal, so this is
    // not something the recorder gets to decide.
    recording: message.recording === true,
  };

  broadcast(peer.meetingId, { type: 'peer-state', peerId: peer.id, state: peer.state }, peer.id);
};

const handleChat = async (peer, message) => {
  if (!peer.meetingId) return;

  const body = String(message.body || '').trim().slice(0, MAX_CHAT_LENGTH);
  if (!body) return;

  let saved;
  try {
    saved = await saveMeetingMessage({
      meetingId: peer.meetingId,
      senderId: peer.userId,
      senderName: peer.name,
      body,
    });
  } catch (error) {
    console.warn('Could not save meeting message:', error.message);
    send(peer, { type: 'error', code: 'chat-failed', message: 'That message was not saved.' });
    return;
  }

  // Sent to the sender too, so every client shows the stored row with its real
  // id and timestamp rather than a local guess that has to be reconciled.
  broadcast(peer.meetingId, {
    type: 'chat',
    message: {
      id: saved.id,
      senderId: saved.senderId,
      senderName: saved.senderName,
      body: saved.body,
      createdAt: saved.createdAt,
    },
  });
};

const handleMessage = async (peer, raw) => {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return send(peer, { type: 'error', code: 'bad-json', message: 'Malformed message.' });
  }

  if (!peer.userId) {
    // Nothing but the greeting is accepted before the socket has said who it is.
    if (message.type !== 'auth') {
      return send(peer, { type: 'error', code: 'unauthenticated', message: 'Authenticate first.' });
    }

    const { user, error } = await authenticate(message.token);
    if (error) {
      send(peer, { type: 'error', code: 'unauthorized', message: error });
      peer.socket.close(4001, 'unauthorized');
      return undefined;
    }

    clearTimeout(peer.authTimer);
    peer.userId = user.id;
    peer.name = user.fullName || user.username || '';
    return send(peer, { type: 'ready', self: describePeer(peer) });
  }

  switch (message.type) {
    case 'join': return handleJoin(peer, message);
    case 'signal': return handleSignal(peer, message);
    case 'state': return handleState(peer, message);
    case 'chat': return handleChat(peer, message);
    case 'leave': return leaveRoom(peer);
    default:
      return send(peer, { type: 'error', code: 'unknown', message: `Unknown message "${message.type}".` });
  }
};

/**
 * Attaches the signalling socket to the HTTP server that already serves the API.
 *
 * `noServer` plus a manual upgrade handler rather than letting ws own the
 * server: this way an upgrade request for any other path is refused cleanly
 * instead of being swallowed, which matters the moment anything else on this
 * port wants to speak WebSocket.
 */
export const attachMeetingSignaling = (httpServer) => {
  const wss = new WebSocketServer({
    noServer: true,
    // An offer with a lot of candidates is a few kilobytes; a megabyte is
    // already something other than signalling.
    maxPayload: 256 * 1024,
  });

  httpServer.on('upgrade', (request, socket, head) => {
    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      pathname = '';
    }

    if (pathname !== WS_PATH) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });

  wss.on('connection', (socket) => {
    const peer = {
      // The peer, not the person: two tabs are two peers with two connections,
      // which is what stops a second tab from tearing down the first one's call.
      id: randomUUID(),
      socket,
      userId: '',
      name: '',
      meetingId: null,
      state: { muted: false, cameraOff: false, sharing: false, recording: false },
      authTimer: null,
    };

    peer.authTimer = setTimeout(() => {
      if (!peer.userId) socket.close(4001, 'auth-timeout');
    }, AUTH_TIMEOUT_MS);

    // Liveness is tracked on the socket, which is what the heartbeat below
    // sweeps; keeping a second copy on the peer only invites the two to drift.
    socket.alive = true;
    socket.on('pong', () => { socket.alive = true; });

    socket.on('message', (raw) => {
      // A throw in here would otherwise reach the ws error handler and take the
      // whole connection down over one bad frame.
      handleMessage(peer, raw.toString()).catch((error) => {
        console.error('Meeting signal failed:', error.message);
        send(peer, { type: 'error', code: 'server', message: 'Something went wrong.' });
      });
    });

    socket.on('close', () => {
      clearTimeout(peer.authTimer);
      leaveRoom(peer).catch((error) => console.warn('Meeting cleanup failed:', error.message));
    });

    socket.on('error', (error) => {
      console.warn('Meeting socket error:', error.message);
    });
  });

  /*
   * A browser that is put to sleep, or a laptop whose lid closes, leaves a
   * socket that is open as far as the kernel is concerned and dead as far as
   * anyone in the meeting is concerned. Without this, that person stays in the
   * roster as a frozen tile until TCP eventually gives up, which can be many
   * minutes.
   */
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (client.alive === false) {
        client.terminate();
        continue;
      }
      client.alive = false;
      try {
        client.ping();
      } catch {
        client.terminate();
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  console.log(`Meeting signalling listening on ${WS_PATH} (mesh limit ${MAX_PEERS})`);
  return wss;
};
