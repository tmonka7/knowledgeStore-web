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

/*
 * Whiteboard limits.
 *
 * A board is held in memory beside its room and dies with it, so the only
 * thing these protect is this process: a pen held down for an hour, or a
 * client that decides to send its whole history in one frame, must not be able
 * to grow a room without bound.
 */
const MAX_BOARD_STROKES = 1200;
const MAX_STROKE_POINTS = 4000;
const MAX_POINTS_PER_MESSAGE = 512;
const BOARD_COLOUR = /^#[0-9a-f]{6}$/i;

/** meetingId -> Map(peerId -> peer) */
const rooms = new Map();

const roomOf = (meetingId) => {
  if (!rooms.has(meetingId)) rooms.set(meetingId, new Map());
  return rooms.get(meetingId);
};

/*
 * meetingId -> stroke[]
 *
 * The shared whiteboard. It lives here rather than in the database because it
 * is something people draw on while they are talking, not a record of the
 * meeting — the board is erased when the last person leaves, which is the same
 * moment the room itself disappears. Anyone who wants to keep it downloads it
 * as an image before they go.
 *
 * Kept beside `rooms` rather than inside it so the peer map stays exactly what
 * every other function here already expects it to be.
 */
const boards = new Map();

const boardOf = (meetingId) => {
  if (!boards.has(meetingId)) boards.set(meetingId, []);
  return boards.get(meetingId);
};

/**
 * A flat [x, y, x, y, …] run of board coordinates, cleaned up.
 *
 * Coordinates are fractions of the board rather than pixels, which is what
 * lets a line drawn on a laptop land in the same place on a phone. Anything
 * that is not a finite number rejects the whole batch rather than being
 * skipped: one NaN in the middle of a stroke would otherwise be stored here
 * and then break the canvas of every client that drew it.
 */
const cleanPoints = (value, limit) => {
  if (!Array.isArray(value)) return [];

  const points = [];
  for (const raw of value.slice(0, limit * 2)) {
    const number = Number(raw);
    if (!Number.isFinite(number)) return [];
    points.push(Math.min(1, Math.max(0, Math.round(number * 10000) / 10000)));
  }

  // An odd length is half a coordinate; dropping the tail keeps every pair whole.
  if (points.length % 2) points.pop();
  return points;
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

// Reads the room rather than creating one: the last person leaving deletes
// their room, and the 'peer-left' that follows would otherwise put an empty
// Map straight back into `rooms` and leave it there for the life of the
// process.
const broadcast = (meetingId, payload, exceptPeerId = null) => {
  for (const peer of rooms.get(meetingId)?.values() || []) {
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
  boards.delete(meetingId);
  return closed;
};

const leaveRoom = async (peer) => {
  if (!peer.meetingId) return;

  const room = rooms.get(peer.meetingId);
  if (room) {
    room.delete(peer.id);
    // The board goes with the room. Leaving it behind would hand it to whoever
    // opened the same meeting next, hours later, which is not what anybody
    // drawing on it expects.
    if (!room.size) {
      rooms.delete(peer.meetingId);
      boards.delete(peer.meetingId);
    }
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
    // Whatever is on the board already, for the same reason the chat history is
    // sent: arriving halfway through should not mean arriving to a blank.
    board: boardOf(meetingId),
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

/**
 * The shared whiteboard.
 *
 * A stroke is streamed rather than sent whole: 'begin' opens it with its first
 * point and 'append' extends it as the pen moves, so the other side watches the
 * line being drawn instead of having it appear once the pen is lifted. There is
 * no 'end' — a stroke that stops receiving points has simply finished, and a
 * pen lifted at the moment a socket drops would otherwise leave a stroke the
 * room considered permanently unfinished.
 *
 * Everything is relayed to the others and never echoed to the author, who
 * already has it on screen. 'clear' and 'remove' are the exceptions: those go
 * to everyone, so the board that ends up empty is the server's and not four
 * separate guesses at it.
 */
const handleBoard = (peer, message) => {
  if (!peer.meetingId) return;

  const strokes = boardOf(peer.meetingId);

  switch (message.op) {
    case 'begin': {
      const id = String(message.id || '').slice(0, 64);
      const points = cleanPoints(message.points, MAX_POINTS_PER_MESSAGE);
      // A repeated id would be extended by the wrong stroke's appends.
      if (!id || !points.length || strokes.some((other) => other.id === id)) return;

      const stroke = {
        id,
        by: peer.id,
        // The person, not the socket: undo has to reach the strokes you drew in
        // a tab you have since closed.
        userId: peer.userId,
        colour: BOARD_COLOUR.test(message.colour || '') ? String(message.colour) : '#111827',
        size: Math.min(64, Math.max(1, Number(message.size) || 4)),
        mode: message.mode === 'eraser' ? 'eraser' : 'pen',
        points,
      };

      strokes.push(stroke);
      // Oldest first: a board busy enough to reach the cap has almost certainly
      // been drawn over several times already.
      if (strokes.length > MAX_BOARD_STROKES) {
        strokes.splice(0, strokes.length - MAX_BOARD_STROKES);
      }

      broadcast(peer.meetingId, { type: 'board', op: 'begin', stroke }, peer.id);
      return;
    }

    case 'append': {
      const id = String(message.id || '');
      if (!id) return;

      // From the end: the stroke being drawn right now is the last one pushed.
      let stroke = null;
      for (let index = strokes.length - 1; index >= 0; index -= 1) {
        if (strokes[index].id === id) {
          stroke = strokes[index];
          break;
        }
      }
      // Only the peer that opened a stroke may extend it, so one participant
      // cannot draw a line and leave it signed by somebody else.
      if (!stroke || stroke.by !== peer.id) return;

      const room = MAX_STROKE_POINTS * 2 - stroke.points.length;
      if (room <= 0) return;

      const points = cleanPoints(message.points, MAX_POINTS_PER_MESSAGE).slice(0, room);
      if (!points.length) return;

      stroke.points.push(...points);
      broadcast(peer.meetingId, { type: 'board', op: 'append', id, points }, peer.id);
      return;
    }

    case 'undo': {
      // Your own last stroke, wherever it sits in the order — undo should not
      // reach across and take back somebody else's line.
      for (let index = strokes.length - 1; index >= 0; index -= 1) {
        if (strokes[index].userId !== peer.userId) continue;

        const [removed] = strokes.splice(index, 1);
        broadcast(peer.meetingId, { type: 'board', op: 'remove', id: removed.id });
        return;
      }
      return;
    }

    case 'clear':
      // Anyone in the call can clear it: it is one shared surface, and a board
      // only its author could wipe would strand everyone else behind whatever
      // they left on it. The client asks first, and the name goes out with it
      // so the room can see who did it.
      strokes.length = 0;
      broadcast(peer.meetingId, { type: 'board', op: 'clear', byName: peer.name });
      return;

    default:
      send(peer, { type: 'error', code: 'unknown', message: `Unknown board op "${message.op}".` });
  }
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
    case 'board': return handleBoard(peer, message);
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
