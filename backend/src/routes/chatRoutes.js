import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import {
  listMessages,
  listThreads,
  markRead,
  openThread,
  recentMessages,
  searchUsers,
  sendAttachment,
  sendMessage,
} from '../controllers/chatController.js';
import { requireAuth, requirePermission } from '../helpers/auth.js';
import { asyncRoute } from '../helpers/asyncRoute.js';
import { CHAT_UPLOAD_DIR } from '../helpers/chatRetention.js';

const router = express.Router();

// Same shape as the record, mail and task uploads: a generated name on disk,
// the original kept in the database as the label.
const chatUploads = multer({
  storage: multer.diskStorage({
    destination: (req, file, callback) => {
      fs.mkdirSync(CHAT_UPLOAD_DIR, { recursive: true });
      callback(null, CHAT_UPLOAD_DIR);
    },
    filename: (req, file, callback) => {
      const safeName = path.basename(file.originalname).replace(/[^\w.-]+/g, '_');
      callback(null, `${Date.now()}-${Math.random().toString(16).slice(2, 10)}-${safeName}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

const canView = [requireAuth, requirePermission('chat:view')];
const canSend = [requireAuth, requirePermission('chat:create')];

// Declared before '/chat/threads/:threadId' would be, so neither 'users' nor
// 'recent' is ever read as a thread id.
router.get('/chat/users', canView, asyncRoute(searchUsers));
router.get('/chat/recent', canView, asyncRoute(recentMessages));

router.get('/chat/threads', canView, asyncRoute(listThreads));
// Opening a conversation creates one the first time, so it counts as sending.
router.post('/chat/threads', canSend, asyncRoute(openThread));
router.get('/chat/threads/:threadId/messages', canView, asyncRoute(listMessages));
router.post('/chat/threads/:threadId/messages', canSend, asyncRoute(sendMessage));
// Sending a file is sending a message, so it needs the same permission.
router.post(
  '/chat/threads/:threadId/attachments',
  canSend,
  chatUploads.single('file'),
  asyncRoute(sendAttachment),
);
router.post('/chat/threads/:threadId/read', canView, asyncRoute(markRead));

export default router;
