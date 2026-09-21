import express from 'express';
import {
  createProjectRecord,
  deleteProject,
  getProject,
  listAssignableUsers,
  listProjects,
  updateProject,
} from '../controllers/projectController.js';
import {
  addComment,
  createTaskRecord,
  deleteTask,
  listTasks,
  transitionTask,
  updateTask,
} from '../controllers/taskController.js';
import { requireAuth, requirePermission } from '../helpers/auth.js';
import { asyncRoute } from '../helpers/asyncRoute.js';

const router = express.Router();

const canView = [requireAuth, requirePermission('projects:view')];
const canCreate = [requireAuth, requirePermission('projects:create')];
const canEdit = [requireAuth, requirePermission('projects:edit')];
const canDelete = [requireAuth, requirePermission('projects:delete')];

// Before '/projects/:id' would be, so 'members' is never read as a project id.
router.get('/projects/members', canView, asyncRoute(listAssignableUsers));

router.get('/projects', canView, asyncRoute(listProjects));
router.post('/projects', canCreate, asyncRoute(createProjectRecord));
router.get('/projects/:id', canView, asyncRoute(getProject));
router.put('/projects/:id', canEdit, asyncRoute(updateProject));
router.delete('/projects/:id', canDelete, asyncRoute(deleteProject));

router.get('/projects/:projectId/tasks', canView, asyncRoute(listTasks));
router.post('/projects/:projectId/tasks', canCreate, asyncRoute(createTaskRecord));
router.put('/projects/:projectId/tasks/:taskId', canEdit, asyncRoute(updateTask));
router.delete('/projects/:projectId/tasks/:taskId', canDelete, asyncRoute(deleteTask));

// Moving a card is an edit; commenting only needs to be a contributor, so a
// tester can hand a bug back without the right to rewrite it.
router.post('/projects/:projectId/tasks/:taskId/transition', canEdit, asyncRoute(transitionTask));
router.post('/projects/:projectId/tasks/:taskId/comments', canCreate, asyncRoute(addComment));

export default router;
