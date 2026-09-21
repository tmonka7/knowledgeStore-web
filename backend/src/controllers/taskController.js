import { randomUUID } from 'crypto';
import { canAccessProject, getProjectById, reserveTaskNumber } from '../models/projectModel.js';
import {
  Task,
  createTask,
  getTaskById,
  getTasks,
  recordActivity,
} from '../models/taskModel.js';
import {
  RESOLUTIONS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
  canTransition,
  nextStatuses,
} from '../helpers/taskWorkflow.js';

const asPlain = (document) => (document?.toObject ? document.toObject() : document);

const isDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

const actorOf = (req) => ({
  id: req.user.sub,
  name: req.currentUser?.fullName || req.user.username,
});

/** Every task route works inside a project the caller may see. */
const loadProject = async (req, res) => {
  const project = await getProjectById(req.params.projectId);
  if (!project || !canAccessProject(project, req.user)) {
    res.status(404).json({ message: 'Project not found.' });
    return null;
  }
  return project;
};

const loadTask = async (req, res, project) => {
  const task = await getTaskById(project.id, req.params.taskId);
  if (!task) {
    res.status(404).json({ message: 'Task not found.' });
    return null;
  }
  return task;
};

const taskFields = (body = {}) => ({
  title: String(body.title || '').trim(),
  description: String(body.description || '').trim(),
  type: String(body.type || 'bug').toLowerCase(),
  priority: String(body.priority || 'normal').toLowerCase(),
  assigneeId: String(body.assigneeId || '').trim(),
  dueDate: String(body.dueDate || '').trim(),
  tags: Array.isArray(body.tags) ? body.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12) : [],
  stepsToReproduce: String(body.stepsToReproduce || '').trim(),
  expectedResult: String(body.expectedResult || '').trim(),
  actualResult: String(body.actualResult || '').trim(),
  environment: String(body.environment || '').trim(),
});

const validate = (fields) => {
  if (!fields.title) return 'A title is required.';
  if (!TASK_TYPES.includes(fields.type)) return `Type must be one of ${TASK_TYPES.join(', ')}.`;
  if (!TASK_PRIORITIES.includes(fields.priority)) return `Priority must be one of ${TASK_PRIORITIES.join(', ')}.`;
  if (fields.dueDate && !isDateKey(fields.dueDate)) return 'Due date must be YYYY-MM-DD.';
  return '';
};

export const listTasks = async (req, res) => {
  const project = await loadProject(req, res);
  if (!project) return undefined;

  const tasks = await getTasks(project.id);
  return res.json({ tasks: tasks.map(asPlain) });
};

export const createTaskRecord = async (req, res) => {
  const project = await loadProject(req, res);
  if (!project) return undefined;

  const fields = taskFields(req.body);
  const error = validate(fields);
  if (error) return res.status(400).json({ message: error });

  const number = await reserveTaskNumber(project.id);
  const actor = actorOf(req);

  // New cards go to the top of the Open column; existing orders are negative
  // or zero, so a single decrement is enough and no other row is touched.
  const lowest = await Task.findOne({ projectId: project.id }).sort({ order: 1 }).select('order');

  const created = await createTask({
    ...fields,
    projectId: project.id,
    number,
    key: `${project.key}-${number}`,
    status: 'open',
    reporterId: req.user.sub,
    order: (lowest?.order ?? 0) - 1,
    activity: [{
      id: randomUUID(),
      action: 'created',
      to: 'open',
      actorId: actor.id,
      actorName: actor.name,
      at: new Date(),
    }],
  });

  return res.status(201).json({ task: asPlain(created) });
};

export const updateTask = async (req, res) => {
  const project = await loadProject(req, res);
  if (!project) return undefined;
  const task = await loadTask(req, res, project);
  if (!task) return undefined;

  const fields = taskFields(req.body);
  const error = validate(fields);
  if (error) return res.status(400).json({ message: error });

  const actor = actorOf(req);
  if (fields.assigneeId !== task.assigneeId) {
    recordActivity(task, {
      action: 'assigned',
      from: task.assigneeId,
      to: fields.assigneeId,
      actorId: actor.id,
      actorName: actor.name,
    });
  }

  Object.assign(task, fields);
  task.updatedAt = new Date();
  await task.save();

  return res.json({ task: asPlain(task) });
};

export const deleteTask = async (req, res) => {
  const project = await loadProject(req, res);
  if (!project) return undefined;
  const task = await loadTask(req, res, project);
  if (!task) return undefined;

  await task.deleteOne();
  return res.json({ ok: true });
};

/**
 * POST /projects/:projectId/tasks/:taskId/transition
 *
 * The workflow gate. An illegal move is refused with the moves that *are*
 * legal, so a stale board can correct itself instead of guessing — and
 * resolving without a resolution, or reopening without a reason, is refused
 * for the same reason the verify step exists at all.
 */
export const transitionTask = async (req, res) => {
  const project = await loadProject(req, res);
  if (!project) return undefined;
  const task = await loadTask(req, res, project);
  if (!task) return undefined;

  const to = String(req.body?.status || '').toLowerCase();
  const note = String(req.body?.note || '').trim();
  const resolution = String(req.body?.resolution || '').trim();

  if (!TASK_STATUSES.includes(to)) {
    return res.status(400).json({ message: `Status must be one of ${TASK_STATUSES.join(', ')}.` });
  }
  if (to === task.status) {
    return res.status(400).json({ message: `This task is already ${to.replace('_', ' ')}.` });
  }
  if (!canTransition(task.status, to)) {
    return res.status(409).json({
      message: `A task that is ${task.status.replace('_', ' ')} cannot move to ${to.replace('_', ' ')}.`,
      allowed: nextStatuses(task.status),
    });
  }
  if (to === 'resolved' && !RESOLUTIONS.includes(resolution)) {
    return res.status(400).json({ message: `Choose a resolution: ${RESOLUTIONS.join(', ')}.` });
  }
  if (to === 'reopened' && !note) {
    return res.status(400).json({ message: 'Say why verification failed before reopening.' });
  }

  const actor = actorOf(req);
  const from = task.status;
  task.status = to;

  if (to === 'resolved') {
    task.resolution = resolution;
    task.resolvedById = actor.id;
    task.resolvedAt = new Date();
  }
  if (to === 'verified') {
    task.verifiedById = actor.id;
    task.verifiedAt = new Date();
  }
  if (to === 'reopened') {
    // The previous resolution did not hold, so it is cleared rather than left
    // to describe a fix that was rejected.
    task.resolution = '';
    task.resolvedById = '';
    task.resolvedAt = null;
    task.verifiedById = '';
    task.verifiedAt = null;
    task.reopenCount += 1;
  }

  recordActivity(task, {
    action: 'status',
    from,
    to,
    note: note || (to === 'resolved' ? resolution : ''),
    actorId: actor.id,
    actorName: actor.name,
  });

  if (note) {
    task.comments.push({
      id: randomUUID(),
      authorId: actor.id,
      authorName: actor.name,
      body: note,
      createdAt: new Date(),
    });
  }

  await task.save();
  return res.json({ task: asPlain(task) });
};

export const addComment = async (req, res) => {
  const project = await loadProject(req, res);
  if (!project) return undefined;
  const task = await loadTask(req, res, project);
  if (!task) return undefined;

  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ message: 'A comment cannot be empty.' });

  const actor = actorOf(req);
  task.comments.push({
    id: randomUUID(),
    authorId: actor.id,
    authorName: actor.name,
    body,
    createdAt: new Date(),
  });
  task.updatedAt = new Date();
  await task.save();

  return res.status(201).json({ task: asPlain(task) });
};
