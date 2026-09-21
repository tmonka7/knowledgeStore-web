import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../api';

/*
 * One meeting, from the browser's side.
 *
 * The server only carries the handshake. Once two browsers have traded an
 * offer, an answer and their ICE candidates, the audio and video go straight
 * between them, which is why this hook — not the backend — is where the real
 * work of a call lives.
 *
 * The mesh rule that keeps this simple: whoever is already in the room makes
 * the offer to whoever arrives. Exactly one side of each pair initiates, so
 * there is never a moment where both ends are offering each other at once. That
 * collision ("glare") is the classic way a WebRTC call ends up connected in one
 * direction only, and the cure here is to make it impossible rather than to
 * detect it.
 */

const CONNECT_RETRY_MS = 2500;
const MAX_RETRIES = 4;

/** Where the signalling socket lives, given however the API was configured. */
export const signalingUrl = () => {
  const configured = import.meta.env.VITE_API_URL;

  if (configured && /^https?:\/\//i.test(configured)) {
    const url = new URL(configured);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/rtc';
    url.search = '';
    url.hash = '';
    return url.toString();
  }

  // Relative API base: the socket is served from wherever the page came from,
  // which in development is Vite proxying /rtc through to the backend.
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/rtc`;
};

/*
 * Chrome and Edge only expose navigator.mediaDevices in a secure context, and
 * "secure" means https or localhost — a plain http page on a LAN address does
 * not qualify. The API is not merely blocked there, it is undefined, so without
 * this check the failure surfaces as "cannot read getUserMedia of undefined"
 * and looks like a bug in the app rather than the browser rule it is.
 */
export const mediaSupport = () => {
  if (window.isSecureContext === false) {
    return {
      ok: false,
      reason: 'Your browser only allows camera and microphone access over HTTPS or on localhost. '
        + 'Open this page over HTTPS to join with video.',
    };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: 'This browser does not support camera and microphone capture.' };
  }
  return { ok: true, reason: '' };
};

export default function useMeetingRoom({ meetingId, active }) {
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [self, setSelf] = useState(null);
  const [peers, setPeers] = useState([]);
  const [streams, setStreams] = useState({});
  const [chat, setChat] = useState([]);
  const [localStream, setLocalStream] = useState(null);
  // Held apart from the camera stream so your own tile can show what everyone
  // else is being sent while you share, without disturbing the camera track.
  const [screenStream, setScreenStream] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [sharing, setSharing] = useState(false);

  const socketRef = useRef(null);
  const peersRef = useRef(new Map());
  const localStreamRef = useRef(null);
  const cameraTrackRef = useRef(null);
  const screenTrackRef = useRef(null);
  const iceRef = useRef([{ urls: 'stun:stun.l.google.com:19302' }]);
  const stateRef = useRef({ muted: false, cameraOff: false, sharing: false, recording: false });
  const retriesRef = useRef(0);
  const closingRef = useRef(false);

  const post = useCallback((payload) => {
    const socket = socketRef.current;
    if (socket?.readyState === 1) socket.send(JSON.stringify(payload));
  }, []);

  const publishState = useCallback(() => {
    post({ type: 'state', ...stateRef.current });
  }, [post]);

  const dropPeer = useCallback((peerId) => {
    const entry = peersRef.current.get(peerId);
    if (entry) {
      try {
        entry.pc.close();
      } catch {
        // Already closed; nothing to do.
      }
      peersRef.current.delete(peerId);
    }

    setPeers((list) => list.filter((peer) => peer.id !== peerId));
    setStreams((map) => {
      const next = { ...map };
      delete next[peerId];
      return next;
    });
  }, []);

  /**
   * The connection to one other participant, created once and reused.
   *
   * Called from both directions — by the side that is about to offer, and by
   * the side that has just been offered to — so it must be safe to call twice.
   */
  const ensurePeer = useCallback((peerId) => {
    const existing = peersRef.current.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: iceRef.current });
    // Built here rather than taken from the track event, so the <video> has
    // something to bind to from the first frame and tracks can appear in it as
    // they arrive instead of swapping the element's source underneath it.
    const remoteStream = new MediaStream();
    const entry = { pc, remoteStream, queued: [], videoSender: null };

    const stream = localStreamRef.current;
    const videoTrack = stream?.getVideoTracks()[0] || null;
    const audioTrack = stream?.getAudioTracks()[0] || null;

    /*
     * Both m-lines are reserved up front, with or without a track to put in
     * them. Starting a screen share then means swapping the track inside a
     * sender that already exists, which needs no renegotiation at all — and a
     * renegotiation mid-call is exactly the moment glare could otherwise
     * reappear. It also means someone who joined with no camera can still
     * share their screen later.
     */
    entry.videoSender = pc.addTransceiver(videoTrack || 'video', {
      direction: 'sendrecv',
      streams: stream ? [stream] : [],
    }).sender;
    pc.addTransceiver(audioTrack || 'audio', {
      direction: 'sendrecv',
      streams: stream ? [stream] : [],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) post({ type: 'signal', to: peerId, data: { candidate: event.candidate } });
    };

    pc.ontrack = (event) => {
      if (!remoteStream.getTracks().some((track) => track.id === event.track.id)) {
        remoteStream.addTrack(event.track);
      }
    };

    pc.onconnectionstatechange = () => {
      // A failed connection is usually a NAT that STUN could not get through.
      // An ICE restart is the cheap thing to try before giving up on the pair.
      if (pc.connectionState === 'failed') {
        try {
          pc.restartIce?.();
        } catch {
          // Older browsers have no restartIce; the tile simply stays blank.
        }
      }
    };

    peersRef.current.set(peerId, entry);
    setStreams((map) => ({ ...map, [peerId]: remoteStream }));
    return entry;
  }, [post]);

  const flushCandidates = useCallback(async (entry) => {
    const queued = entry.queued.splice(0, entry.queued.length);
    for (const candidate of queued) {
      try {
        await entry.pc.addIceCandidate(candidate);
      } catch (candidateError) {
        console.warn('Discarding an unusable ICE candidate:', candidateError.message);
      }
    }
  }, []);

  const offerTo = useCallback(async (peerId) => {
    const entry = ensurePeer(peerId);
    try {
      const offer = await entry.pc.createOffer();
      await entry.pc.setLocalDescription(offer);
      post({ type: 'signal', to: peerId, data: { sdp: entry.pc.localDescription } });
    } catch (offerError) {
      console.error('Could not offer to a participant:', offerError.message);
    }
  }, [ensurePeer, post]);

  const handleSignal = useCallback(async (from, data) => {
    const entry = ensurePeer(from);

    if (data?.sdp) {
      try {
        await entry.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        // Candidates routinely arrive before the description they belong to;
        // adding one early throws, so they wait here until there is something
        // to attach them to.
        await flushCandidates(entry);

        if (data.sdp.type === 'offer') {
          const answer = await entry.pc.createAnswer();
          await entry.pc.setLocalDescription(answer);
          post({ type: 'signal', to: from, data: { sdp: entry.pc.localDescription } });
        }
      } catch (sdpError) {
        console.error('Could not apply a description from a participant:', sdpError.message);
      }
      return;
    }

    if (data?.candidate) {
      if (entry.pc.remoteDescription?.type) {
        try {
          await entry.pc.addIceCandidate(data.candidate);
        } catch (candidateError) {
          console.warn('Discarding an unusable ICE candidate:', candidateError.message);
        }
      } else {
        entry.queued.push(data.candidate);
      }
    }
  }, [ensurePeer, flushCandidates, post]);

  const handleMessage = useCallback(async (message) => {
    switch (message.type) {
      case 'ready':
        post({ type: 'join', meetingId });
        return;

      case 'joined':
        retriesRef.current = 0;
        setSelf(message.self);
        setPeers(message.peers || []);
        setChat(message.history || []);
        setPhase('joined');
        setError('');
        // Connections to the people already here are opened now, but no offer
        // is sent: they are the established side, so the offer comes from them.
        (message.peers || []).forEach((peer) => ensurePeer(peer.id));
        publishState();
        return;

      case 'peer-joined':
        setPeers((list) => (list.some((peer) => peer.id === message.peer.id)
          ? list
          : [...list, message.peer]));
        // We were here first, so we offer.
        offerTo(message.peer.id);
        return;

      case 'peer-left':
        dropPeer(message.peerId);
        return;

      case 'signal':
        await handleSignal(message.from, message.data);
        return;

      case 'peer-state':
        setPeers((list) => list.map((peer) => (peer.id === message.peerId
          ? { ...peer, state: message.state }
          : peer)));
        return;

      case 'chat':
        setChat((list) => (list.some((row) => row.id === message.message.id)
          ? list
          : [...list, message.message]));
        return;

      case 'ended':
        closingRef.current = true;
        setPhase('ended');
        setNotice(message.message || 'This meeting has ended.');
        return;

      case 'error':
        // A room that is full, gone, or closed to you is a dead end; anything
        // else is worth reporting without tearing the call down.
        if (['full', 'not-found', 'ended', 'unauthorized'].includes(message.code)) {
          closingRef.current = true;
          setPhase('error');
        }
        setError(message.message || 'Something went wrong.');
        return;

      default:
        console.warn('Unknown signalling message:', message.type);
    }
  }, [dropPeer, ensurePeer, handleSignal, meetingId, offerTo, post, publishState]);

  const teardown = useCallback(() => {
    [...peersRef.current.keys()].forEach(dropPeer);

    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) {
      // Cleared first, so closing on purpose is not mistaken for the network
      // dropping and does not start a reconnect.
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        // Already closing.
      }
    }

    const stream = localStreamRef.current;
    localStreamRef.current = null;
    // Stopping every track is what turns the camera light off. Closing the peer
    // connections alone leaves the device held open, which looks to the person
    // sitting there like the call never ended.
    stream?.getTracks().forEach((track) => track.stop());
    screenTrackRef.current?.stop();
    screenTrackRef.current = null;
    cameraTrackRef.current = null;

    setLocalStream(null);
    setScreenStream(null);
    setSelf(null);
  }, [dropPeer]);

  useEffect(() => {
    if (!active || !meetingId) return undefined;

    let disposed = false;
    let retryTimer = null;
    closingRef.current = false;
    retriesRef.current = 0;
    setPhase('connecting');
    setError('');
    setNotice('');

    const openSocket = () => {
      if (disposed || closingRef.current) return;

      const socket = new WebSocket(signalingUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        // The token is sent as the first message rather than in the URL: query
        // strings turn up in proxy and access logs, and this one is a bearer
        // credential for the whole API.
        socket.send(JSON.stringify({ type: 'auth', token: localStorage.getItem('token') || '' }));
      };

      socket.onmessage = (event) => {
        let parsed;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          return;
        }
        handleMessage(parsed).catch((handlerError) => {
          console.error('Meeting message failed:', handlerError.message);
        });
      };

      socket.onclose = () => {
        if (disposed || closingRef.current) return;

        // Every peer id was scoped to that socket, so none of them survive it.
        [...peersRef.current.keys()].forEach(dropPeer);

        if (retriesRef.current >= MAX_RETRIES) {
          setPhase('error');
          setError('Lost the connection to the meeting.');
          return;
        }

        retriesRef.current += 1;
        setPhase('reconnecting');
        retryTimer = setTimeout(openSocket, CONNECT_RETRY_MS);
      };

      // onclose always follows onerror, so the reconnect is handled in one place.
      socket.onerror = () => {};
    };

    const start = async () => {
      try {
        const { data } = await api.get('/meetings/ice');
        if (Array.isArray(data.iceServers) && data.iceServers.length) iceRef.current = data.iceServers;
      } catch (iceError) {
        console.warn('Falling back to the built-in STUN server:', iceError.message);
      }
      if (disposed) return;

      const support = mediaSupport();
      if (!support.ok) {
        setNotice(support.reason);
      } else {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          if (disposed) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          localStreamRef.current = stream;
          cameraTrackRef.current = stream.getVideoTracks()[0] || null;
          setLocalStream(stream);
        } catch (mediaError) {
          // Refused permission, or no device. Joining to watch and listen is
          // far better than refusing to join at all, so the call continues and
          // the transceivers reserved above simply carry nothing outward.
          setNotice(`Joining without camera or microphone (${mediaError.name || 'unavailable'}).`);
        }
      }

      if (disposed) return;
      openSocket();
    };

    start();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      teardown();
    };
  }, [active, meetingId, dropPeer, handleMessage, teardown]);

  const toggleMic = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;

    // `enabled = false` keeps the track and the connection and sends silence.
    // Stopping it instead would drop the audio line and need a renegotiation
    // to get back, which is a lot of machinery for a mute button.
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
    stateRef.current = { ...stateRef.current, muted: !track.enabled };
    publishState();
  }, [publishState]);

  const toggleCamera = useCallback(() => {
    const track = cameraTrackRef.current;
    if (!track) return;

    track.enabled = !track.enabled;
    setCamOn(track.enabled);
    stateRef.current = { ...stateRef.current, cameraOff: !track.enabled };
    publishState();
  }, [publishState]);

  const stopShareRef = useRef(() => {});

  const stopShare = useCallback(async () => {
    const camera = cameraTrackRef.current;
    for (const entry of peersRef.current.values()) {
      try {
        await entry.videoSender?.replaceTrack(camera && camera.readyState === 'live' ? camera : null);
      } catch (replaceError) {
        console.warn('Could not restore the camera for a participant:', replaceError.message);
      }
    }

    screenTrackRef.current?.stop();
    screenTrackRef.current = null;
    setScreenStream(null);
    setSharing(false);
    stateRef.current = { ...stateRef.current, sharing: false };
    publishState();
  }, [publishState]);

  stopShareRef.current = stopShare;

  const startShare = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setNotice('This browser cannot share a screen from this page. Screen sharing needs HTTPS or localhost.');
      return;
    }

    let display;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } catch {
      // Cancelling the picker is the usual reason and is not an error worth
      // shouting about.
      return;
    }

    const track = display.getVideoTracks()[0];
    if (!track) return;
    screenTrackRef.current = track;

    /*
     * Swapping the track inside the existing sender, rather than adding a new
     * one. replaceTrack does not change the shape of the session, so no offer
     * or answer is exchanged and there is no window in which the two sides
     * disagree about what is being sent.
     */
    for (const entry of peersRef.current.values()) {
      try {
        await entry.videoSender?.replaceTrack(track);
      } catch (replaceError) {
        console.warn('Could not share the screen with a participant:', replaceError.message);
      }
    }

    // The browser's own "Stop sharing" bar ends the track without telling this
    // code, so the call has to hear about it from the track itself.
    track.onended = () => { stopShareRef.current(); };

    setScreenStream(display);
    setSharing(true);
    stateRef.current = { ...stateRef.current, sharing: true };
    publishState();
  }, [publishState]);

  const toggleShare = useCallback(() => (sharing ? stopShare() : startShare()), [sharing, startShare, stopShare]);

  const sendChat = useCallback((body) => {
    const text = String(body || '').trim();
    if (!text) return;
    post({ type: 'chat', body: text });
  }, [post]);

  /** Tells the room a recording has started or stopped. Never optional. */
  const setRecording = useCallback((value) => {
    stateRef.current = { ...stateRef.current, recording: Boolean(value) };
    publishState();
  }, [publishState]);

  const leave = useCallback(() => {
    closingRef.current = true;
    post({ type: 'leave' });
    teardown();
    setPhase('left');
  }, [post, teardown]);

  return {
    phase,
    error,
    notice,
    self,
    peers,
    streams,
    chat,
    localStream,
    screenStream,
    micOn,
    camOn,
    sharing,
    toggleMic,
    toggleCamera,
    toggleShare,
    sendChat,
    setRecording,
    leave,
  };
}
