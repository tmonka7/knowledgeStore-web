import express from 'express';
import {
  aimAtStop,
  deleteVisitor,
  finishSession,
  listSessions,
  listVisitors,
  readSession,
  recordSightings,
  startSession,
  stopFrame,
  updateVisitor,
} from '../controllers/attendanceController.js';
import { requireAuth, requirePermission } from '../helpers/auth.js';

const router = express.Router();

/*
 * Running a sweep is attendance:create, not attendance:view, and the split is
 * not bureaucratic: a sweep physically turns a camera through 180 degrees and
 * writes a biometric record of everyone it sees. Reading yesterday's
 * attendance list is a much smaller thing to be allowed to do.
 */
router.get('/attendance/sessions', requireAuth, requirePermission('attendance:view'), listSessions);
router.get('/attendance/sessions/:id', requireAuth, requirePermission('attendance:view'), readSession);
router.post('/attendance/sessions', requireAuth, requirePermission('attendance:create'), startSession);
router.post('/attendance/sessions/:id/stops/:index/aim', requireAuth, requirePermission('attendance:create'), aimAtStop);
router.get('/attendance/sessions/:id/stops/:index/frame', requireAuth, requirePermission('attendance:create'), stopFrame);
router.post('/attendance/sessions/:id/sightings', requireAuth, requirePermission('attendance:create'), recordSightings);
router.post('/attendance/sessions/:id/finish', requireAuth, requirePermission('attendance:create'), finishSession);

router.get('/attendance/visitors', requireAuth, requirePermission('attendance:view'), listVisitors);
// Naming a face, and deleting one, are both editorial acts over biometric
// records, so they sit behind edit and delete rather than behind create.
router.put('/attendance/visitors/:id', requireAuth, requirePermission('attendance:edit'), updateVisitor);
router.delete('/attendance/visitors/:id', requireAuth, requirePermission('attendance:delete'), deleteVisitor);

export default router;
