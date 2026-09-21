import express from 'express';
import {
  createScheduleRecord,
  deleteSchedule,
  listSchedules,
  listUpcoming,
  updateSchedule,
} from '../controllers/scheduleController.js';
import { requireAuth, requirePermission } from '../helpers/auth.js';

const router = express.Router();

// Declared before '/schedules/:id' would be, so 'upcoming' is never read as an id.
router.get('/schedules/upcoming', requireAuth, requirePermission('schedule:view'), listUpcoming);

router.get('/schedules', requireAuth, requirePermission('schedule:view'), listSchedules);
router.post('/schedules', requireAuth, requirePermission('schedule:create'), createScheduleRecord);
router.put('/schedules/:id', requireAuth, requirePermission('schedule:edit'), updateSchedule);
router.delete('/schedules/:id', requireAuth, requirePermission('schedule:delete'), deleteSchedule);

export default router;
