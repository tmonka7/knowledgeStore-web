import express from 'express';
import fs from 'node:fs';
import multer from 'multer';
import {
  createMeetingRecord,
  deleteMeetingRecord,
  deleteRecordingFile,
  finishMeeting,
  getMeeting,
  listIceServers,
  listMeetings,
  updateMeetingRecord,
  uploadRecording,
} from '../controllers/meetingController.js';
import { requireAuth, requirePermission } from '../helpers/auth.js';
import { asyncRoute } from '../helpers/asyncRoute.js';
import { MEETING_UPLOAD_DIR } from '../helpers/meetingUploads.js';

const router = express.Router();

// A recording is an order of magnitude bigger than anything else this app
// uploads — half an hour of a call is a couple of hundred megabytes — so it
// gets its own limit rather than the 25MB the other uploads use.
const MAX_RECORDING_MB = Math.max(1, Number(process.env.MEETING_MAX_RECORDING_MB) || 256);

const recordingUploads = multer({
  storage: multer.diskStorage({
    destination: (req, file, callback) => {
      fs.mkdirSync(MEETING_UPLOAD_DIR, { recursive: true });
      callback(null, MEETING_UPLOAD_DIR);
    },
    // The name on disk is generated; the readable one is kept in the document,
    // which is the same split every other upload here uses.
    filename: (req, file, callback) => {
      callback(null, `${Date.now()}-${Math.random().toString(16).slice(2, 10)}.webm`);
    },
  }),
  limits: { fileSize: MAX_RECORDING_MB * 1024 * 1024, files: 1 },
});

const canView = [requireAuth, requirePermission('meetings:view')];
const canCreate = [requireAuth, requirePermission('meetings:create')];
const canEdit = [requireAuth, requirePermission('meetings:edit')];
const canDelete = [requireAuth, requirePermission('meetings:delete')];

// Declared before '/meetings/:id', so 'ice' is never read as a meeting id.
router.get('/meetings/ice', canView, listIceServers);

router.get('/meetings', canView, asyncRoute(listMeetings));
router.post('/meetings', canCreate, asyncRoute(createMeetingRecord));
router.get('/meetings/:id', canView, asyncRoute(getMeeting));
router.put('/meetings/:id', canEdit, asyncRoute(updateMeetingRecord));
router.delete('/meetings/:id', canDelete, asyncRoute(deleteMeetingRecord));

// Ending a meeting is a change to it, not a deletion: the record, the
// attendance log and the recordings all survive.
router.post('/meetings/:id/end', canEdit, asyncRoute(finishMeeting));

// Anyone who can be in the meeting can record it and can remove a recording
// they made; whose recording it is gets decided in the controller.
router.post(
  '/meetings/:id/recordings',
  canView,
  recordingUploads.single('file'),
  asyncRoute(uploadRecording),
);
router.delete('/meetings/:id/recordings/:recordingId', canView, asyncRoute(deleteRecordingFile));

export default router;
