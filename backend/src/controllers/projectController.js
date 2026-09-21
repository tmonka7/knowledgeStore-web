import {
  PROJECT_STATUSES,
  Project,
  canAccessProject,
  createProject,
  getProjectById,
  getProjects,
} from '../models/projectModel.js';
import { Task, countTasksByStatus } from '../models/taskModel.js';
import { DONE_STATUSES, TASK_STATUSES } from '../helpers/taskWorkflow.js';
import { getUsers } from '../models/userModel.js';
import { writeLog } from '../models/activityLogModel.js';

const asPlain = (document) => (document?.toObject ? document.toObject() : document);

const isDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

const projectFields = (body = {}) => ({
  name: String(body.name || '').trim(),
  key: String(body.key || '').trim().toUpperCase(),
  description: String(body.description || '').trim(),
  status: String(body.status || 'planning'),
  color: String(body.color || '#1677ff').trim(),
  startDate: String(body.startDate || '').trim(),
  dueDate: String(body.dueDate || '').trim(),
  memberIds: Array.isArray(body.memberIds) ? [...new Set(body.memberIds.map(String))] : [],
  progressOverride: body.progressOverride === null || body.progressOverride === undefined || body.progressOverride === ''
    ? null
    : Math.min(100, Math.max(0, Number(body.progressOverride) || 0)),
});

const validate = (project) => {
  if (!project.name) return 'A project name is required.';
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(project.key)) {
    return 'Key must be 2-10 characters, starting with a letter (for example KS or WEB2).';
  }
  if (!PROJECT_STATUSES.includes(project.status)) {
    return `Status must be one of ${PROJECT_STATUSES.join(', ')}.`;
  }
  if (project.startDate && !isDateKey(project.startDate)) return 'Start date must be YYYY-MM-DD.';
  if (project.dueDate && !isDateKey(project.dueDate)) return 'Due date must be YYYY-MM-DD.';
  if (project.startDate && project.dueDate && project.dueDate < project.startDate) {
    return 'Due date cannot be before the start date.';
  }
  return '';
};

/**
 * Progress is counted from the board — done tasks over all tasks — so it moves
 * on its own as cards are verified. A project may override it when the work it
 * tracks is not all on the board; the override is reported as such rather than
 * silently replacing the count.
 */
const summarise = (project, counts = {}) => {
  const total = TASK_STATUSES.reduce((sum, status) => sum + (counts[status] || 0), 0);
  const done = DONE_STATUSES.reduce((sum, status) => sum + (counts[status] || 0), 0);
  const computed = total ? Math.round((done / total) * 100) : 0;

  return {
    ...asPlain(project),
    taskCounts: TASK_STATUSES.reduce((all, status) => ({ ...all, [status]: counts[status] || 0 }), {}),
    taskTotal: total,
    taskDone: done,
    computedProgress: computed,
    progress: project.progressOverride ?? computed,
    isProgressManual: project.progressOverride !== null && project.progressOverride !== undefined,
  };
};

export const listProjects = async (req, res) => {
  const projects = await getProjects(req.user);
  const counts = await countTasksByStatus(projects.map((project) => project.id));

  return res.json({
    projects: projects.map((project) => summarise(project, counts.get(project.id))),
  });
};

export const getProject = async (req, res) => {
  const project = await getProjectById(req.params.id);
  if (!project || !canAccessProject(project, req.user)) {
    return res.status(404).json({ message: 'Project not found.' });
  }

  const counts = await countTasksByStatus([project.id]);
  return res.json({ project: summarise(project, counts.get(project.id)) });
};

export const createProjectRecord = async (req, res) => {
  const fields = projectFields(req.body);
  const error = validate(fields);
  if (error) return res.status(400).json({ message: error });

  const created = await createProject({ ...fields, ownerId: req.user.sub });

  await writeLog({
    source: 'projects',
    action: 'project:create',
    message: `Created project ${created.key} — ${created.name}`,
    actor: { id: req.user.sub, username: req.user.username },
  });

  return res.status(201).json({ project: summarise(created, {}) });
};

export const updateProject = async (req, res) => {
  const project = await getProjectById(req.params.id);
  if (!project || !canAccessProject(project, req.user)) {
    return res.status(404).json({ message: 'Project not found.' });
  }

  const fields = projectFields(req.body);
  const error = validate(fields);
  if (error) return res.status(400).json({ message: error });

  // The key is part of every task key already issued, so it is fixed once
  // tasks exist — renaming it would orphan every reference in a comment.
  if (fields.key !== project.key && project.taskCounter > 0) {
    return res.status(400).json({ message: 'The project key cannot change once tasks have been created.' });
  }

  Object.assign(project, fields);
  await project.save();

  const counts = await countTasksByStatus([project.id]);
  return res.json({ project: summarise(project, counts.get(project.id)) });
};

export const deleteProject = async (req, res) => {
  const project = await getProjectById(req.params.id);
  if (!project || !canAccessProject(project, req.user)) {
    return res.status(404).json({ message: 'Project not found.' });
  }

  const { deletedCount } = await Task.deleteMany({ projectId: project.id });
  await project.deleteOne();

  await writeLog({
    source: 'projects',
    action: 'project:delete',
    message: `Deleted project ${project.key} and ${deletedCount} task(s)`,
    actor: { id: req.user.sub, username: req.user.username },
  });

  return res.json({ ok: true, deletedTasks: deletedCount });
};

/**
 * GET /projects/members
 *
 * Just enough of each account to fill an assignee or member picker. The full
 * user list is admin-only, and reporting a bug should not require that.
 */
export const listAssignableUsers = async (req, res) => {
  const users = await getUsers();
  return res.json({
    users: users.map((user) => ({ id: user.id, fullName: user.fullName, username: user.username, role: user.role })),
  });
};
