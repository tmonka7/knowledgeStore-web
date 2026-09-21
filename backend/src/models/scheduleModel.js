import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import { REPEAT_MODES } from '../helpers/recurrence.js';

// date/time/repeatUntil are 'YYYY-MM-DD' and 'HH:mm' strings rather than Date
// values on purpose — see helpers/recurrence.js for why a schedule is a
// calendar date, not an instant.
const scheduleSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true, default: () => randomUUID() },
  ownerId: { type: String, required: true, index: true },
  title: { type: String, required: true, trim: true },
  notes: { type: String, default: '', trim: true },
  date: { type: String, required: true },
  time: { type: String, default: '09:00' },
  repeat: { type: String, enum: REPEAT_MODES, default: 'none' },
  repeatUntil: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
}, { collection: 'schedules' });

export const Schedule = mongoose.models.Schedule || mongoose.model('Schedule', scheduleSchema);

// Schedules are personal: the day-before reminder is addressed to whoever
// created the entry, so every query is scoped by ownerId.
export const getSchedules = (ownerId) => Schedule.find({ ownerId }).sort({ date: 1, time: 1 });
export const getScheduleById = (ownerId, id) => Schedule.findOne({ ownerId, id });
export const createSchedule = (data) => Schedule.create({ id: randomUUID(), ...data });
