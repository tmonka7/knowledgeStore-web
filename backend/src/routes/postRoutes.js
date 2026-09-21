import express from 'express';
import {
  createPostRecord,
  deletePost,
  getPost,
  listNotifications,
  listPosts,
  markPostViewed,
  updatePost,
} from '../controllers/postController.js';
import { requireAuth, requirePermission } from '../helpers/auth.js';
import { asyncRoute } from '../helpers/asyncRoute.js';

const router = express.Router();

const canView = [requireAuth, requirePermission('posts:view')];
const canCreate = [requireAuth, requirePermission('posts:create')];
const canEdit = [requireAuth, requirePermission('posts:edit')];
const canDelete = [requireAuth, requirePermission('posts:delete')];

// Before '/posts/:id' would be, so 'notifications' is never read as a post id.
router.get('/posts/notifications', canView, asyncRoute(listNotifications));

router.get('/posts', canView, asyncRoute(listPosts));
router.post('/posts', canCreate, asyncRoute(createPostRecord));
router.get('/posts/:id', canView, asyncRoute(getPost));
router.put('/posts/:id', canEdit, asyncRoute(updatePost));
router.delete('/posts/:id', canDelete, asyncRoute(deletePost));

// Recording that you read something needs only the right to read it.
router.post('/posts/:id/view', canView, asyncRoute(markPostViewed));

export default router;
