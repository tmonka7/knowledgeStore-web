import mongoose from 'mongoose';
import { randomUUID } from 'crypto';

export const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'archived'];

const projectSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true, default: () => randomUUID() },
  name: { type: String, required: true, trim: true },
  // Short prefix for task keys: KS-14. Unique per project, not per database.
  key: { type: String, required: true, uppercase: true, trim: true },
  description: { type: String, default: '', trim: true },
  status: { type: String, enum: PROJECT_STATUSES, default: 'planning' },
  color: { type: String, default: '#1677ff' },
  startDate: { type: String, default: '' },
  dueDate: { type: String, default: '' },
  ownerId: { type: String, required: true, index: true },
  memberIds: { type: [String], default: [] },
  // Progress is normally counted from the tasks; this overrides it when a
  // project is tracked by something the board cannot see. null means "count".
  progressOverride: { type: Number, default: null, min: 0, max: 100 },
  // Incremented atomically to number tasks; never decremented, so a deleted
  // task's number is not handed out twice.
  taskCounter: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
}, { collection: 'projects' });

export const Project = mongoose.models.Project || mongoose.model('Project', projectSchema);

/** Owner, member or administrator — the same rule for a project and its tasks. */
export const canAccessProject = (project, user) => {
  if (!project || !user) return false;
  if (user.role === 'admin') return true;
  return project.ownerId === user.sub || (project.memberIds || []).includes(user.sub);
};

export const getProjects = (user) => {
  const filter = user.role === 'admin'
    ? {}
    : { $or: [{ ownerId: user.sub }, { memberIds: user.sub }] };
  return Project.find(filter).sort({ createdAt: -1 });
};

export const getProjectById = (id) => Project.findOne({ id });

export const createProject = (data) => Project.create({ id: randomUUID(), ...data });

/**
 * Reserves the next task number for a project.
 *
 * $inc inside findOneAndUpdate is atomic, so two people filing a bug at the
 * same moment cannot be handed the same key.
 */
export const reserveTaskNumber = async (projectId) => {
  const updated = await Project.findOneAndUpdate(
    { id: projectId },
    { $inc: { taskCounter: 1 } },
    { new: true },
  );
  return updated?.taskCounter || 1;
};
