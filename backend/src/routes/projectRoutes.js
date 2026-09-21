import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
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
  deleteAttachment,
  deleteTask,
  listTasks,
  transitionTask,
  updateTask,
  uploadAttachments,
} from '../controllers/taskController.js';
import { requireAuth, requirePermission } from '../helpers/auth.js';
import { asyncRoute } from '../helpers/asyncRoute.js';

const router = express.Router();

const TASK_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'tasks');

// Same shape as the record and mail uploads: a generated name on disk, the
// original kept in the database as the label.
const taskUploads = multer({
  storage: multer.diskStorage({
    destination: (req, file, callback) => {
      fs.mkdirSync(TASK_UPLOAD_DIR, { recursive: true });
      callback(null, TASK_UPLOAD_DIR);
    },
    filename: (req, file, callback) => {
      const safeName = path.basename(file.originalname).replace(/[^\w.-]+/g, '_');
      callback(null, `${Date.now()}-${Math.random().toString(16).slice(2, 10)}-${safeName}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
});

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

// Attaching a file is contributing, like commenting; removing one is an edit.
router.post(
  '/projects/:projectId/tasks/:taskId/attachments',
  canCreate,
  taskUploads.array('attachments', 10),
  asyncRoute(uploadAttachments),
);
router.delete('/projects/:projectId/tasks/:taskId/attachments/:attachmentId', canEdit, asyncRoute(deleteAttachment));

export default router;
