import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import {
  RESOLUTIONS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
} from '../helpers/taskWorkflow.js';

const commentSchema = new mongoose.Schema({
  id: { type: String, required: true, default: () => randomUUID() },
  authorId: { type: String, default: '' },
  authorName: { type: String, default: '' },
  body: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

// The trail the verification step is judged on: who moved the card, when, and
// from what. Stored on the task so it survives a project export.
const activitySchema = new mongoose.Schema({
  id: { type: String, required: true, default: () => randomUUID() },
  action: { type: String, default: '' },
  from: { type: String, default: '' },
  to: { type: String, default: '' },
  note: { type: String, default: '' },
  actorId: { type: String, default: '' },
  actorName: { type: String, default: '' },
  at: { type: Date, default: Date.now },
}, { _id: false });

const taskSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true, default: () => randomUUID() },
  projectId: { type: String, required: true, index: true },
  number: { type: Number, required: true },
  key: { type: String, required: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  type: { type: String, enum: TASK_TYPES, default: 'bug' },
  status: { type: String, enum: TASK_STATUSES, default: 'open' },
  priority: { type: String, enum: TASK_PRIORITIES, default: 'normal' },
  assigneeId: { type: String, default: '' },
  reporterId: { type: String, default: '' },
  dueDate: { type: String, default: '' },
  tags: { type: [String], default: [] },

  // Bug report fields. Empty on a plain task, which is why they are optional
  // rather than a separate collection.
  stepsToReproduce: { type: String, default: '' },
  expectedResult: { type: String, default: '' },
  actualResult: { type: String, default: '' },
  environment: { type: String, default: '' },

  resolution: { type: String, enum: [...RESOLUTIONS, ''], default: '' },
  resolvedById: { type: String, default: '' },
  resolvedAt: { type: Date, default: null },
  verifiedById: { type: String, default: '' },
  verifiedAt: { type: Date, default: null },
  reopenCount: { type: Number, default: 0 },

  // Position within its board column, so a manual order survives a reload.
  order: { type: Number, default: 0 },
  comments: { type: [commentSchema], default: [] },
  activity: { type: [activitySchema], default: [] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'project_tasks' });

export const Task = mongoose.models.Task || mongoose.model('Task', taskSchema);

export const getTasks = (projectId) => Task.find({ projectId }).sort({ order: 1, createdAt: 1 });

export const getTaskById = (projectId, id) => Task.findOne({ projectId, id });

export const createTask = (data) => Task.create({ id: randomUUID(), ...data });

export const countTasksByStatus = async (projectIds = []) => {
  const rows = await Task.aggregate([
    { $match: { projectId: { $in: projectIds } } },
    { $group: { _id: { projectId: '$projectId', status: '$status' }, count: { $sum: 1 } } },
  ]);

  const counts = new Map();
  rows.forEach((row) => {
    const { projectId, status } = row._id;
    if (!counts.has(projectId)) counts.set(projectId, {});
    counts.get(projectId)[status] = row.count;
  });
  return counts;
};

/** Appends to the trail without loading and rewriting the whole document. */
export const recordActivity = (task, entry) => {
  task.activity.push({ id: randomUUID(), at: new Date(), ...entry });
  task.updatedAt = new Date();
};
