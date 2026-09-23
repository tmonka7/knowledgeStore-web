import {
  FACE_MATCH_MARGIN,
  FACE_MATCH_MAX,
  FACE_SAME_SIGHTING,
  bestMatch,
  faceDistance,
  isFaceDescriptor,
  isFaceImage,
} from '../helpers/faceMatch.js';
import {
  PtzError,
  SWEEP_DEFAULTS,
  aimCamera,
  grabFrame,
  planSweep,
  ptzReady,
  ptzStatusCode,
  waitForStop,
} from '../helpers/ptz/index.js';
import {
  AttendanceEntry,
  AttendanceSession,
  VisitorFace,
  createAttendanceSession,
  getAttendanceSession,
  getCameraForControl,
  getFaceCandidates,
  getUserById,
  getVisitorFace,
  listAttendanceSessions,
  listSessionEntries,
  listVisitorFaces,
} from '../models/store.js';

/*
 * Automatic attendance.
 *
 * The work is split between this server and the browser, and the split is
 * forced rather than chosen:
 *
 *   server   moves the camera, waits for the head to settle, fetches frames
 *            (cameras have no CORS headers and want Digest auth, so the page
 *            cannot), matches descriptors against the roster, and writes rows
 *   browser  runs face detection and produces the 128-number descriptors,
 *            because the recognition model is face-api and it runs there
 *
 * So the page drives the loop — aim, frame, recognise, submit — and this file
 * owns everything that must be trusted. In particular the browser never sees
 * the roster and never decides who was present: it submits descriptors, and
 * the matching happens here.
 */

// Minimum detector confidence and face size for a sighting to count. A face
// twelve pixels across produces a descriptor that is mostly noise, and noise
// matches whoever happens to be nearest — which is how an attendance list
// acquires a name belonging to someone who was not in the building.
const MIN_SCORE = 0.55;
const MIN_FACE_RATIO = 0.035;

const failed = (res, error, fallback) => {
  if (error instanceof PtzError) {
    return res.status(ptzStatusCode(error)).json({ message: error.message, code: error.code });
  }
  console.error(fallback, error);
  return res.status(500).json({ message: fallback });
};

const canTouchSession = (session, user) => user.role === 'admin' || session.startedById === user.id;

const loadSession = async (req, res) => {
  const session = await getAttendanceSession(req.params.id);
  if (!session) {
    res.status(404).json({ message: 'Attendance session not found.' });
    return null;
  }
  if (!canTouchSession(session, req.user)) {
    res.status(403).json({ message: 'That attendance session belongs to someone else.' });
    return null;
  }
  return session;
};

/**
 * POST /attendance/sessions — plan a sweep and start it.
 *
 * The plan is computed and stored up front so the browser cannot invent its
 * own stops, and so the record of what arc was covered survives a later edit
 * to the camera's configuration.
 */
export const startSession = async (req, res) => {
  const { cameraId, zoom = 0, arcDegrees = 180 } = req.body || {};

  const camera = await getCameraForControl(String(cameraId || ''));
  if (!camera) return res.status(404).json({ message: 'Camera not found.' });

  if (!ptzReady(camera)) {
    return res.status(409).json({
      message: 'This camera is not set up for PTZ control. Open its settings, enter the ONVIF address and run Detect.',
      code: 'PTZ_UNCONFIGURED',
    });
  }

  const ptz = camera.ptz || {};
  const plan = planSweep({
    panRangeDegrees: ptz.panRangeDegrees,
    hfovDegrees: ptz.hfovDegrees,
    maxZoomFactor: ptz.maxZoomFactor,
    homeDegrees: ptz.homeDegrees,
    tilt: ptz.tilt,
    arcDegrees: Number(arcDegrees) || 180,
    zoom: Math.max(0, Math.min(1, Number(zoom) || 0)),
  });

  try {
    const session = await createAttendanceSession({
      cameraId: camera.id,
      cameraName: camera.name,
      startedById: req.user.id,
      startedByName: req.user.fullName || req.user.username,
      arcDegrees: Number(arcDegrees) || 180,
      coverageDegrees: plan.coverageDegrees,
      fovDegrees: plan.fov,
      zoom: Math.max(0, Math.min(1, Number(zoom) || 0)),
      completeCoverage: plan.complete,
      stops: plan.stops.map((stop) => ({
        index: stop.index,
        degrees: stop.degrees,
        pan: stop.pan,
        tilt: stop.tilt,
        zoom: stop.zoom,
      })),
    });

    return res.status(201).json({
      session: session.toObject(),
      settleMs: Number(ptz.settleMs) || SWEEP_DEFAULTS.settleMs,
    });
  } catch (error) {
    return failed(res, error, 'The attendance sweep could not be started.');
  }
};

/**
 * POST /attendance/sessions/:id/stops/:index/aim
 *
 * Points the camera at one stop and does not answer until the head has
 * stopped. The waiting is deliberately on this side: the browser has no way to
 * know when a camera has finished moving, and a frame grabbed early is a
 * motion-blurred frame of the previous angle.
 */
export const aimAtStop = async (req, res) => {
  const session = await loadSession(req, res);
  if (!session) return undefined;

  const index = Number(req.params.index);
  const stop = session.stops.find((item) => item.index === index);
  if (!stop) return res.status(404).json({ message: 'That sweep position does not exist.' });

  const camera = await getCameraForControl(session.cameraId);
  if (!camera) return res.status(404).json({ message: 'Camera not found.' });

  try {
    await aimCamera(camera, { pan: stop.pan, tilt: stop.tilt, zoom: stop.zoom });
    await waitForStop(camera, { settleMs: Number(camera.ptz?.settleMs) || SWEEP_DEFAULTS.settleMs });

    stop.visitedAt = new Date();
    stop.error = '';
    await session.save();

    return res.json({ ok: true, index, degrees: stop.degrees });
  } catch (error) {
    stop.error = error?.message || 'The camera did not reach this position.';
    await session.save().catch(() => {});
    return failed(res, error, 'The camera could not be aimed.');
  }
};

/** GET /attendance/sessions/:id/stops/:index/frame — the still at one stop. */
export const stopFrame = async (req, res) => {
  const session = await loadSession(req, res);
  if (!session) return undefined;

  const camera = await getCameraForControl(session.cameraId);
  if (!camera) return res.status(404).json({ message: 'Camera not found.' });

  try {
    const { buffer, contentType } = await grabFrame(camera);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(buffer);
  } catch (error) {
    return failed(res, error, 'The camera image could not be fetched.');
  }
};

/*
 * Two detections of one face in a single frame.
 *
 * face-api can return overlapping boxes for the same person, and each would
 * otherwise be matched and counted separately. Conditions inside one frame are
 * identical — same instant, same light, same angle — so a genuine duplicate
 * lands very close indeed, and the tight threshold is safe here in a way it
 * would not be across frames.
 */
const dropDuplicateFaces = (faces) => {
  const kept = [];
  for (const face of faces) {
    const duplicate = kept.some((other) => faceDistance(other.descriptor, face.descriptor) < FACE_SAME_SIGHTING);
    // Keep the more confident of the pair rather than whichever arrived first.
    if (!duplicate) kept.push(face);
  }
  return kept;
};

/**
 * POST /attendance/sessions/:id/sightings
 *
 * The browser submits the faces it found in one frame; this decides who they
 * are and writes the attendance rows.
 *
 * Every submitted face ends in exactly one outcome, and the caller is told
 * which, because "we saw eleven faces and recorded nine people" is only
 * answerable if the other two are accounted for:
 *
 *   user        matched an enrolled account
 *   visitor     matched a face seen before that has no name yet
 *   registered  a face nobody has seen before — stored so it can be named
 *   ambiguous   too close to two different people to say which
 *   rejected    too small or too uncertain to be worth matching
 */
export const recordSightings = async (req, res) => {
  const session = await loadSession(req, res);
  if (!session) return undefined;

  if (session.status !== 'running') {
    return res.status(409).json({ message: 'That attendance sweep has already finished.' });
  }

  const stopIndex = Number(req.body?.stopIndex) || 0;
  const stop = session.stops.find((item) => item.index === stopIndex);
  const submitted = Array.isArray(req.body?.faces) ? req.body.faces : [];

  // Validated rather than trusted: these arrive from a browser, and a
  // descriptor of the wrong length would otherwise reach faceDistance and
  // produce a confident-looking NaN.
  const usable = [];
  const results = [];

  for (const face of submitted) {
    if (!isFaceDescriptor(face?.descriptor)) {
      results.push({ outcome: 'rejected', reason: 'That face could not be read.' });
      continue;
    }
    if (Number(face.score || 0) < MIN_SCORE) {
      results.push({ outcome: 'rejected', reason: 'Too uncertain to identify.' });
      continue;
    }
    if (Number(face.ratio || 0) < MIN_FACE_RATIO) {
      results.push({ outcome: 'rejected', reason: 'Too far away — the face is too small in the frame.' });
      continue;
    }
    usable.push({
      descriptor: face.descriptor.map(Number),
      score: Number(face.score) || 0,
      ratio: Number(face.ratio) || 0,
      faceImage: isFaceImage(face.faceImage) ? face.faceImage : '',
    });
  }

  const faces = dropDuplicateFaces(usable);

  try {
    // Both galleries are read once per frame rather than once per face.
    const [roster, visitors] = await Promise.all([getFaceCandidates(), listVisitorFaces()]);

    for (const face of faces) {
      const known = bestMatch(face.descriptor, roster, (user) => user.faceDescriptor, {
        maxDistance: FACE_MATCH_MAX,
        margin: FACE_MATCH_MARGIN,
      });

      if (known.ambiguous) {
        /*
         * Close to two enrolled people. This deliberately does NOT fall
         * through to registering a visitor: the person is on the roster, and
         * creating a nameless visitor record for them would both lose the
         * attendance row and add a duplicate biometric record for somebody
         * already enrolled. It is reported instead, for a human to settle.
         */
        results.push({
          outcome: 'ambiguous',
          reason: 'This face is too similar to two enrolled people to tell them apart.',
          distance: known.distance,
        });
        continue;
      }

      if (known.match) {
        const user = known.match;
        results.push({
          outcome: 'user',
          name: user.fullName || user.username,
          subjectId: user.id,
          distance: known.distance,
        });
        await upsertEntry(session, {
          subjectType: 'user',
          subjectId: user.id,
          name: user.fullName || user.username,
          distance: known.distance,
          margin: Number.isFinite(known.runnerUp) ? known.runnerUp - known.distance : 0,
          stopIndex,
          panDegrees: stop?.degrees || 0,
          faceImage: face.faceImage,
        });
        continue;
      }

      // Nobody on the roster. Have we seen this face before?
      const seen = bestMatch(face.descriptor, visitors, (visitor) => visitor.faceDescriptor, {
        maxDistance: FACE_MATCH_MAX,
        margin: FACE_MATCH_MARGIN,
      });

      let visitor = seen.match;
      let outcome = 'visitor';

      if (visitor) {
        visitor.lastSeenAt = new Date();
        visitor.seenCount += 1;
        // Keep the best picture we have of them, which is usually the closest.
        if (face.faceImage && (!visitor.faceImage || face.ratio > 0.08)) visitor.faceImage = face.faceImage;
        await visitor.save();
      } else {
        /*
         * A face that is in nobody's records — this is the "register faces not
         * yet in the database" case.
         *
         * It becomes a visitorFaces row and NOT a user account. An account is
         * a credential: face sign-in identifies against every enrolled account
         * with no password, so minting one from a face that walked past a
         * camera would let anyone who stands in front of it become a user of
         * this system. A visitor record is a record — it names nobody, grants
         * nothing, and an operator can attach it to a real person afterwards.
         */
        visitor = await VisitorFace.create({
          faceDescriptor: face.descriptor,
          faceImage: face.faceImage,
          firstCameraId: session.cameraId,
          firstSessionId: session.id,
        });
        visitors.push(visitor);
        outcome = 'registered';
      }

      results.push({
        outcome,
        name: visitor.label || '',
        subjectId: visitor.id,
        faceImage: visitor.faceImage,
        distance: seen.match ? seen.distance : 0,
      });

      await upsertEntry(session, {
        subjectType: 'visitor',
        subjectId: visitor.id,
        name: visitor.label || '',
        distance: seen.match ? seen.distance : 0,
        margin: seen.match && Number.isFinite(seen.runnerUp) ? seen.runnerUp - seen.distance : 0,
        stopIndex,
        panDegrees: stop?.degrees || 0,
        faceImage: face.faceImage,
      });
    }

    if (stop) {
      stop.facesFound = faces.length;
      if (!stop.visitedAt) stop.visitedAt = new Date();
    }
    await session.save();

    const counts = await countSession(session.id);
    return res.json({ results, ...counts });
  } catch (error) {
    return failed(res, error, 'Those faces could not be recorded.');
  }
};

/**
 * One row per person per sweep.
 *
 * Seeing somebody at three stops is one attendance row with three sightings,
 * not three rows. The unique index does the deciding — a plain "look then
 * insert" would let two frames submitted back to back both pass the look.
 */
const upsertEntry = async (session, entry) => {
  const existing = await AttendanceEntry.findOne({
    sessionId: session.id,
    subjectType: entry.subjectType,
    subjectId: entry.subjectId,
  });

  if (existing) {
    existing.sightings += 1;
    // Keep the closest match and the picture that came with it: later frames
    // are not better by virtue of being later.
    if (entry.distance < existing.distance || !existing.faceImage) {
      existing.distance = entry.distance;
      existing.margin = entry.margin;
      existing.stopIndex = entry.stopIndex;
      existing.panDegrees = entry.panDegrees;
      if (entry.faceImage) existing.faceImage = entry.faceImage;
    }
    await existing.save();
    return existing;
  }

  try {
    return await AttendanceEntry.create({ sessionId: session.id, cameraId: session.cameraId, ...entry });
  } catch (error) {
    // Lost the race against a concurrent submission for the same person.
    if (error?.code === 11000) {
      await AttendanceEntry.updateOne(
        { sessionId: session.id, subjectType: entry.subjectType, subjectId: entry.subjectId },
        { $inc: { sightings: 1 } },
      );
      return null;
    }
    throw error;
  }
};

const countSession = async (sessionId) => {
  const [knownCount, visitorCount] = await Promise.all([
    AttendanceEntry.countDocuments({ sessionId, subjectType: 'user' }),
    AttendanceEntry.countDocuments({ sessionId, subjectType: 'visitor' }),
  ]);
  return { knownCount, visitorCount };
};

/** POST /attendance/sessions/:id/finish — close the sweep and return the list. */
export const finishSession = async (req, res) => {
  const session = await loadSession(req, res);
  if (!session) return undefined;

  const requested = String(req.body?.status || 'complete');
  const status = ['complete', 'cancelled', 'failed'].includes(requested) ? requested : 'complete';

  const counts = await countSession(session.id);
  session.status = status;
  session.finishedAt = new Date();
  session.knownCount = counts.knownCount;
  session.visitorCount = counts.visitorCount;
  if (req.body?.error) session.error = String(req.body.error).slice(0, 500);
  await session.save();

  const entries = await listSessionEntries(session.id);
  return res.json({ session: session.toObject(), entries: entries.map((entry) => entry.toObject()) });
};

/** GET /attendance/sessions */
export const listSessions = async (req, res) => {
  const sessions = await listAttendanceSessions({
    limit: Number(req.query.limit) || 50,
    cameraId: req.query.cameraId ? String(req.query.cameraId) : undefined,
  });
  return res.json({ sessions: sessions.map((session) => session.toObject()) });
};

/** GET /attendance/sessions/:id */
export const readSession = async (req, res) => {
  const session = await getAttendanceSession(req.params.id);
  if (!session) return res.status(404).json({ message: 'Attendance session not found.' });

  const entries = await listSessionEntries(session.id);
  return res.json({ session: session.toObject(), entries: entries.map((entry) => entry.toObject()) });
};

/** GET /attendance/visitors — faces on file that have no name. */
export const listVisitors = async (req, res) => {
  const visitors = await listVisitorFaces();
  return res.json({
    // The descriptor stays on the server. It is of no use to the page, and
    // it is the one field here that is biometric data in its own right.
    visitors: visitors.map((visitor) => {
      const { faceDescriptor, ...rest } = visitor.toObject();
      return rest;
    }),
  });
};

/**
 * PUT /attendance/visitors/:id — name a visitor, or say who they are.
 *
 * Linking records the association for attendance only. It does not enrol the
 * face against the account: see the note in attendanceModel.js — a descriptor
 * captured from a passer-by must never become something that can sign in.
 */
export const updateVisitor = async (req, res) => {
  const visitor = await getVisitorFace(req.params.id);
  if (!visitor) return res.status(404).json({ message: 'That face is not on file.' });

  if (req.body?.label !== undefined) visitor.label = String(req.body.label).trim().slice(0, 120);

  if (req.body?.linkedUserId !== undefined) {
    const userId = req.body.linkedUserId ? String(req.body.linkedUserId) : null;
    if (userId) {
      const user = await getUserById(userId);
      if (!user) return res.status(400).json({ message: 'That user does not exist.' });
      visitor.linkedUserId = user.id;
      visitor.linkedByName = req.user.fullName || req.user.username;
      visitor.linkedAt = new Date();
      if (!visitor.label) visitor.label = user.fullName || user.username;
    } else {
      visitor.linkedUserId = null;
      visitor.linkedByName = '';
      visitor.linkedAt = null;
    }
  }

  await visitor.save();

  // The name shown against past attendance rows follows the visitor record, so
  // naming somebody fixes every sweep they appeared in rather than only the
  // next one.
  await AttendanceEntry.updateMany(
    { subjectType: 'visitor', subjectId: visitor.id },
    { $set: { name: visitor.label } },
  );

  const { faceDescriptor, ...rest } = visitor.toObject();
  return res.json({ visitor: rest });
};

/** DELETE /attendance/visitors/:id — forget a face. */
export const deleteVisitor = async (req, res) => {
  const visitor = await getVisitorFace(req.params.id);
  if (!visitor) return res.status(404).json({ message: 'That face is not on file.' });

  await visitor.deleteOne();
  // The attendance rows stay: they are the record that somebody unidentified
  // was present, which is true whether or not their face is still on file.
  await AttendanceEntry.updateMany(
    { subjectType: 'visitor', subjectId: visitor.id },
    { $set: { faceImage: '', name: 'Deleted face' } },
  );

  return res.json({ ok: true });
};
