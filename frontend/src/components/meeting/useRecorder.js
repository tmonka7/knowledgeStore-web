import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../api';

/*
 * Recording a meeting.
 *
 * The media never reaches the server as a stream, so there is nothing there to
 * record. What happens instead is that the browser paints every tile onto a
 * canvas, mixes everybody's audio into one track, and records that — the result
 * is the meeting as the person recording it saw and heard it, in one file.
 *
 * Everyone in the room is told a recording is running (the room publishes it as
 * part of that person's state) and the indicator cannot be turned off
 * separately. A recording light that the recorder controls is not consent.
 */

const FPS = 24;
const WIDTH = 1280;
const HEIGHT = 720;
const CHUNK_MS = 1000;

const CANDIDATE_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

const pickMimeType = () => {
  if (typeof MediaRecorder === 'undefined') return '';
  return CANDIDATE_TYPES.find((type) => MediaRecorder.isTypeSupported?.(type)) || '';
};

/** Fits a source frame into a cell without stretching it — CSS `object-fit: cover`. */
const drawCover = (ctx, video, x, y, width, height) => {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) return false;

  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;

  ctx.drawImage(
    video,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  return true;
};

const gridFor = (count) => {
  const columns = Math.ceil(Math.sqrt(Math.max(count, 1)));
  return { columns, rows: Math.ceil(Math.max(count, 1) / columns) };
};

/*
 * Brings the hidden <video> elements and the audio graph in line with whoever
 * is currently in the room. Called from the draw loop, so somebody arriving
 * halfway through appears in the recording from the moment they arrive rather
 * than not at all.
 */
const syncSources = (session) => {
  const wanted = new Set();

  for (const tile of session.tilesRef.current) {
    if (!tile.stream) continue;
    wanted.add(tile.key);

    if (!session.videos.has(tile.key)) {
      const video = document.createElement('video');
      video.srcObject = tile.stream;
      video.autoplay = true;
      video.playsInline = true;
      // Muted, always: this element exists to be painted, and letting it play
      // audio would put every remote voice into the room twice.
      video.muted = true;
      video.play().catch(() => {});
      session.videos.set(tile.key, video);
    }

    // Audio can come from a different stream than the picture. While you are
    // sharing your screen your tile shows the screen, which carries no sound —
    // taking the audio from `stream` would quietly drop your voice from the
    // recording for exactly as long as you were presenting.
    const audioStream = tile.audioStream || tile.stream;
    if (!session.audioSources.has(tile.key) && audioStream?.getAudioTracks().length) {
      try {
        const source = session.audioContext.createMediaStreamSource(audioStream);
        source.connect(session.destination);
        session.audioSources.set(tile.key, source);
      } catch (audioError) {
        console.warn('Could not add a participant to the recording mix:', audioError.message);
      }
    }
  }

  for (const [key, video] of session.videos) {
    if (wanted.has(key)) continue;
    video.srcObject = null;
    video.remove();
    session.videos.delete(key);

    const source = session.audioSources.get(key);
    if (source) {
      source.disconnect();
      session.audioSources.delete(key);
    }
  }
};

const paint = (session) => {
  const { ctx } = session;
  syncSources(session);

  const tiles = session.tilesRef.current.filter((tile) => tile.stream);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const { columns, rows } = gridFor(tiles.length);
  const cellWidth = WIDTH / columns;
  const cellHeight = HEIGHT / rows;

  tiles.forEach((tile, index) => {
    const x = (index % columns) * cellWidth;
    const y = Math.floor(index / columns) * cellHeight;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 2, y + 2, cellWidth - 4, cellHeight - 4);
    ctx.clip();

    const video = session.videos.get(tile.key);
    const painted = video && drawCover(ctx, video, x + 2, y + 2, cellWidth - 4, cellHeight - 4);
    if (!painted) {
      // Camera off, or the first frame has not arrived: a filled cell with the
      // name in it reads as "present, not on camera" rather than as a glitch.
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(x + 2, y + 2, cellWidth - 4, cellHeight - 4);
    }
    ctx.restore();

    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.fillRect(x + 12, y + cellHeight - 42, Math.min(cellWidth - 24, 320), 28);
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(tile.label || '').slice(0, 32), x + 22, y + cellHeight - 28);
  });

  session.frame = requestAnimationFrame(() => paint(session));
};

export default function useRecorder({ meetingId, tiles, onSaved }) {
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [elapsedMs, setElapsedMs] = useState(0);

  // The draw loop reads the tiles through a ref, so people joining and leaving
  // change what is recorded without restarting anything.
  const tilesRef = useRef(tiles);
  tilesRef.current = tiles;

  const sessionRef = useRef(null);

  const cleanup = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;

    cancelAnimationFrame(session.frame);
    clearInterval(session.ticker);

    session.videos.forEach((video) => {
      video.srcObject = null;
      video.remove();
    });
    session.videos.clear();

    session.canvasStream?.getTracks().forEach((track) => track.stop());
    // Closing the audio context releases the mixing graph; leaving it open
    // keeps the tab's audio hardware busy for the rest of the session.
    session.audioContext?.close().catch(() => {});
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const save = useCallback(async (session) => {
    const durationMs = Date.now() - session.startedAt;
    const blob = new Blob(session.chunks, { type: session.recorder.mimeType || 'video/webm' });

    // Torn down before the upload, not after: the canvas loop and the audio
    // graph have nothing left to do, and leaving them running would keep
    // painting for however long a few hundred megabytes take to send.
    cleanup();
    setRecording(false);

    if (!blob.size) {
      setError('Nothing was captured, so no recording was saved.');
      return;
    }

    setSaving(true);
    try {
      const stamp = new Date(session.startedAt).toISOString().slice(0, 16).replace('T', ' ');
      const form = new FormData();
      form.append('file', blob, 'meeting.webm');
      form.append('name', `Recording ${stamp}.webm`);
      form.append('durationMs', String(durationMs));

      const { data } = await api.post(`/meetings/${meetingId}/recordings`, form);
      onSaved?.(data.meeting);
    } catch (uploadError) {
      setError(uploadError.response?.data?.message || 'The recording could not be saved.');
    } finally {
      setSaving(false);
    }
  }, [cleanup, meetingId, onSaved]);

  const start = useCallback(async () => {
    setError('');

    const mimeType = pickMimeType();
    if (!mimeType) {
      setError('This browser cannot record video from a page. Chrome, Edge and Firefox can.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    if (!canvas.captureStream) {
      setError('This browser cannot capture a canvas, which is how the meeting is recorded.');
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      setError('This browser cannot mix audio, which is how the meeting is recorded.');
      return;
    }

    const audioContext = new AudioContextClass();
    // Browsers start an audio context suspended until a user gesture. Pressing
    // Record is that gesture, so this resume is allowed — called anywhere else
    // it would silently do nothing and the recording would have no sound.
    await audioContext.resume().catch(() => {});

    const destination = audioContext.createMediaStreamDestination();
    const canvasStream = canvas.captureStream(FPS);
    const mixed = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...destination.stream.getAudioTracks(),
    ]);

    let recorder;
    try {
      recorder = new MediaRecorder(mixed, { mimeType });
    } catch (recorderError) {
      setError(`Recording could not start: ${recorderError.message}`);
      audioContext.close().catch(() => {});
      return;
    }

    const session = {
      ctx: canvas.getContext('2d'),
      canvasStream,
      audioContext,
      destination,
      videos: new Map(),
      audioSources: new Map(),
      tilesRef,
      chunks: [],
      recorder,
      startedAt: Date.now(),
      frame: 0,
      ticker: 0,
    };
    sessionRef.current = session;

    recorder.ondataavailable = (event) => {
      if (event.data?.size) session.chunks.push(event.data);
    };
    recorder.onerror = (event) => {
      setError(`Recording stopped: ${event.error?.message || 'unknown error'}`);
    };
    recorder.onstop = () => { save(session); };

    session.ticker = setInterval(() => setElapsedMs(Date.now() - session.startedAt), 1000);
    paint(session);
    // Timesliced, so a crash or a closed tab still leaves whole chunks behind
    // rather than one file that was never finalised.
    recorder.start(CHUNK_MS);

    setElapsedMs(0);
    setRecording(true);
  }, [save]);

  const stop = useCallback(() => {
    const recorder = sessionRef.current?.recorder;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  return { recording, saving, error, elapsedMs, start, stop, clearError: () => setError('') };
}
