import { useCallback, useRef, useState } from 'react';
import api from '../../api';
import { descriptorsFromImage } from '../../lib/faceRecognition';
import { canvasToDataUrl, cropToCanvas, padRect } from '../../lib/faceCrop';

/*
 * Drives one automatic attendance sweep.
 *
 * The loop is here, in the browser, and the reason is the recognition model:
 * face-api runs in the page, and there is no equivalent on the server. So the
 * page walks the sweep — ask the server to aim the camera, ask it for a frame,
 * find the faces, send the descriptors back — and the server does everything
 * that has to be trusted: it owns the plan, it holds the camera credentials,
 * and it alone decides whose face is whose.
 *
 * Which means this hook is a driver, not an authority. It never decides who
 * was present; it reports what the server said.
 */

/** A frame from the API as an <img> that face-api can read. */
const loadFrame = (blob) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => {
    // The object URL is revoked only after the bitmap is decoded, and the
    // element keeps the pixels, so this is safe and stops a long sweep from
    // holding every frame it has ever grabbed.
    URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('The camera frame could not be decoded.'));
  };
  image.src = url;
});

/**
 * A small JPEG of one face, for the attendance list.
 *
 * Padded before cropping: a detector box is tight to the features, and a
 * thumbnail cut on that line is a picture of a nose. The padding is what makes
 * the row recognisable to a human checking it afterwards, which is the only
 * thing the thumbnail is for.
 */
const faceThumbnail = (image, box) => {
  try {
    return canvasToDataUrl(cropToCanvas(image, padRect(box, 0.45), 240), 0.8);
  } catch {
    // A box at the very edge of the frame can fail to crop; the sighting is
    // still perfectly good without a picture.
    return '';
  }
};

const problem = (error, fallback) => error?.response?.data?.message || error?.message || fallback;

export default function useAttendanceSweep({ camera, onFinished }) {
  const [phase, setPhase] = useState('idle');
  const [session, setSession] = useState(null);
  const [stopIndex, setStopIndex] = useState(0);
  const [people, setPeople] = useState([]);
  const [notes, setNotes] = useState([]);
  const [frameUrl, setFrameUrl] = useState('');
  const [boxes, setBoxes] = useState([]);
  const [error, setError] = useState('');

  // Cancellation is read inside the loop, so it has to be a ref: a state
  // update would not be visible to the iteration already in flight, and the
  // camera would keep turning after the operator pressed Stop.
  const cancelRef = useRef(false);
  const runningRef = useRef(false);

  const note = useCallback((text, tone = 'warning') => {
    setNotes((current) => [...current, { id: `${Date.now()}-${current.length}`, text, tone }]);
  }, []);

  /* Merges one frame's results into the running list, without duplicating. */
  const mergeResults = useCallback((results) => {
    setPeople((current) => {
      const next = [...current];
      for (const result of results) {
        if (!result.subjectId) continue;
        const existing = next.findIndex((person) => person.subjectId === result.subjectId);
        if (existing === -1) {
          next.push({ ...result, sightings: 1 });
        } else {
          next[existing] = {
            ...next[existing],
            sightings: next[existing].sightings + 1,
            // Keep the closest match seen so far, and its picture.
            ...(result.distance < next[existing].distance ? { distance: result.distance } : {}),
            faceImage: next[existing].faceImage || result.faceImage,
          };
        }
      }
      return next;
    });
  }, []);

  const stop = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const start = useCallback(async ({ zoom = 0, arcDegrees = 180 } = {}) => {
    if (runningRef.current) return;
    runningRef.current = true;
    cancelRef.current = false;

    setPhase('starting');
    setPeople([]);
    setNotes([]);
    setBoxes([]);
    setError('');
    setStopIndex(0);

    let started = null;

    try {
      const { data } = await api.post('/attendance/sessions', { cameraId: camera.id, zoom, arcDegrees });
      started = data.session;
      setSession(started);

      if (!started.completeCoverage) {
        note(
          `At this zoom the camera cannot cover ${started.arcDegrees}° in one sweep. `
          + `It will cover ${Math.round(started.coverageDegrees)}° centred on the same point — zoom out to widen it.`,
        );
      }

      setPhase('running');

      for (const sweepStop of started.stops) {
        if (cancelRef.current) break;
        setStopIndex(sweepStop.index);

        // 1. Point the camera. The server does not answer until the head has
        //    settled, so there is nothing to wait for here.
        try {
          await api.post(`/attendance/sessions/${started.id}/stops/${sweepStop.index}/aim`);
        } catch (caught) {
          note(`Position ${sweepStop.index + 1}: ${problem(caught, 'the camera did not move.')}`);
          continue;
        }
        if (cancelRef.current) break;

        // 2. One frame, proxied through the API so the pixels are readable.
        let image;
        try {
          const { data: blob } = await api.get(
            `/attendance/sessions/${started.id}/stops/${sweepStop.index}/frame`,
            { responseType: 'blob' },
          );
          image = await loadFrame(blob);
          setFrameUrl((previous) => {
            if (previous) URL.revokeObjectURL(previous);
            return URL.createObjectURL(blob);
          });
        } catch (caught) {
          note(`Position ${sweepStop.index + 1}: ${problem(caught, 'no image came back.')}`);
          continue;
        }
        if (cancelRef.current) break;

        // 3. Find every face in it.
        let faces = [];
        try {
          faces = await descriptorsFromImage(image);
        } catch (caught) {
          note(`Position ${sweepStop.index + 1}: ${problem(caught, 'face recognition failed.')}`);
          continue;
        }
        setBoxes(faces.map((face) => face.box));
        if (cancelRef.current) break;

        if (!faces.length) continue;

        // 4. Hand the descriptors to the server, which decides who they are.
        try {
          const { data: recorded } = await api.post(`/attendance/sessions/${started.id}/sightings`, {
            stopIndex: sweepStop.index,
            faces: faces.map((face) => ({
              descriptor: face.descriptor,
              score: face.score,
              ratio: face.ratio,
              faceImage: faceThumbnail(image, face.box),
            })),
          });

          mergeResults(recorded.results || []);

          for (const result of recorded.results || []) {
            if (result.outcome === 'ambiguous') {
              note(`Position ${sweepStop.index + 1}: a face was too similar to two enrolled people to identify.`);
            }
          }
        } catch (caught) {
          note(`Position ${sweepStop.index + 1}: ${problem(caught, 'those faces could not be recorded.')}`);
        }
      }

      // Finishing is not conditional on the loop having succeeded: a session
      // left 'running' would sit in the list forever looking like a sweep
      // still in progress.
      const { data: finished } = await api.post(`/attendance/sessions/${started.id}/finish`, {
        status: cancelRef.current ? 'cancelled' : 'complete',
      });

      setSession(finished.session);
      setPeople(finished.entries.map((entry) => ({
        subjectId: entry.subjectId,
        outcome: entry.subjectType === 'user' ? 'user' : 'visitor',
        name: entry.name,
        distance: entry.distance,
        sightings: entry.sightings,
        faceImage: entry.faceImage,
      })));
      setPhase(cancelRef.current ? 'cancelled' : 'done');
      onFinished?.(finished.session);
    } catch (caught) {
      setError(problem(caught, 'The attendance sweep could not be completed.'));
      setPhase('error');
      // Best effort: a session that was created before the failure should not
      // be left marked as running.
      if (started?.id) {
        await api.post(`/attendance/sessions/${started.id}/finish`, {
          status: 'failed',
          error: problem(caught, 'failed'),
        }).catch(() => {});
      }
    } finally {
      runningRef.current = false;
    }
  }, [camera?.id, mergeResults, note, onFinished]);

  const reset = useCallback(() => {
    setFrameUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return '';
    });
    setPhase('idle');
    setSession(null);
    setPeople([]);
    setNotes([]);
    setBoxes([]);
    setError('');
  }, []);

  return {
    phase,
    session,
    stopIndex,
    people,
    notes,
    frameUrl,
    boxes,
    error,
    running: phase === 'running' || phase === 'starting',
    start,
    stop,
    reset,
  };
}
