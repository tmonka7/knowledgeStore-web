import {
  createSchedule,
  getScheduleById,
  getSchedules,
} from '../models/scheduleModel.js';
import {
  REPEAT_MODES,
  addDays,
  isDateKey,
  isTimeKey,
  occurrencesInRange,
} from '../helpers/recurrence.js';

const scheduleFields = (body = {}) => ({
  title: String(body.title || '').trim(),
  notes: String(body.notes || '').trim(),
  date: String(body.date || '').trim(),
  time: String(body.time || '09:00').trim(),
  repeat: String(body.repeat || 'none').toLowerCase(),
  // An empty string from a cleared form field means "no end date", not a date.
  repeatUntil: body.repeatUntil ? String(body.repeatUntil).trim() : null,
});

const validate = (schedule) => {
  if (!schedule.title) return 'A title is required.';
  if (!isDateKey(schedule.date)) return 'Date must be in YYYY-MM-DD format.';
  if (!isTimeKey(schedule.time)) return 'Time must be in HH:mm format.';
  if (!REPEAT_MODES.includes(schedule.repeat)) {
    return `Repeat must be one of ${REPEAT_MODES.join(', ')}.`;
  }
  if (schedule.repeatUntil !== null) {
    if (!isDateKey(schedule.repeatUntil)) return 'Repeat-until must be in YYYY-MM-DD format.';
    if (schedule.repeatUntil < schedule.date) return 'Repeat-until cannot be before the start date.';
    if (schedule.repeat === 'none') return 'Set a repeat mode before choosing an end date.';
  }
  return '';
};

const asPlain = (document) => (document.toObject ? document.toObject() : document);

/**
 * GET /schedules?from=&to=
 *
 * Returns the raw schedules plus their expanded occurrences for the window.
 * The expansion happens here rather than in the browser so the calendar and
 * the reminder check can never disagree about when something repeats.
 */
export const listSchedules = async (req, res) => {
  const { from, to } = req.query;
  const schedules = (await getSchedules(req.user.sub)).map(asPlain);

  if (!from && !to) {
    return res.json({ schedules, occurrences: [] });
  }
  if (!isDateKey(from) || !isDateKey(to)) {
    return res.status(400).json({ message: 'from and to must be YYYY-MM-DD dates.' });
  }

  return res.json({ schedules, occurrences: occurrencesInRange(schedules, from, to) });
};

/**
 * GET /schedules/upcoming?today=YYYY-MM-DD
 *
 * Everything falling on the day after `today` — the day-before reminder.
 * The client supplies its own date so the reminder follows the viewer's
 * calendar rather than the server's timezone.
 */
export const listUpcoming = async (req, res) => {
  const today = isDateKey(req.query.today)
    ? req.query.today
    : new Date().toISOString().slice(0, 10);
  const tomorrow = addDays(today, 1);

  const schedules = (await getSchedules(req.user.sub)).map(asPlain);

  return res.json({
    today,
    tomorrow,
    occurrences: occurrencesInRange(schedules, tomorrow, tomorrow),
  });
};

export const createScheduleRecord = async (req, res) => {
  const schedule = scheduleFields(req.body);
  const error = validate(schedule);
  if (error) return res.status(400).json({ message: error });

  const created = await createSchedule({ ...schedule, ownerId: req.user.sub });
  return res.status(201).json({ schedule: asPlain(created) });
};

export const updateSchedule = async (req, res) => {
  const existing = await getScheduleById(req.user.sub, req.params.id);
  if (!existing) return res.status(404).json({ message: 'Schedule not found.' });

  const updates = scheduleFields(req.body);
  const error = validate(updates);
  if (error) return res.status(400).json({ message: error });

  Object.assign(existing, updates);
  await existing.save();
  return res.json({ schedule: asPlain(existing) });
};

export const deleteSchedule = async (req, res) => {
  const existing = await getScheduleById(req.user.sub, req.params.id);
  if (!existing) return res.status(404).json({ message: 'Schedule not found.' });

  await existing.deleteOne();
  return res.json({ ok: true });
};
