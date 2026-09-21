import express from 'express';
import {
  listMessages,
  listThreads,
  markRead,
  openThread,
  searchUsers,
  sendMessage,
  unreadTotal,
} from '../controllers/chatController.js';
import { requireAuth, requirePermission } from '../helpers/auth.js';
import { asyncRoute } from '../helpers/asyncRoute.js';

const router = express.Router();

const canView = [requireAuth, requirePermission('chat:view')];
const canSend = [requireAuth, requirePermission('chat:create')];

// Declared before '/chat/threads/:threadId' would be, so neither 'users' nor
// 'unread' is ever read as a thread id.
router.get('/chat/users', canView, asyncRoute(searchUsers));
router.get('/chat/unread', canView, asyncRoute(unreadTotal));

router.get('/chat/threads', canView, asyncRoute(listThreads));
// Opening a conversation creates one the first time, so it counts as sending.
router.post('/chat/threads', canSend, asyncRoute(openThread));
router.get('/chat/threads/:threadId/messages', canView, asyncRoute(listMessages));
router.post('/chat/threads/:threadId/messages', canSend, asyncRoute(sendMessage));
router.post('/chat/threads/:threadId/read', canView, asyncRoute(markRead));

export default router;
