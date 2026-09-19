import express from 'express';
import { createConversation, getConversationMessages, listConversations, sendConversationMessage } from '../controllers/chatController.js';
import { requireAuth, requirePermission } from '../helpers/auth.js';

const router = express.Router();

router.get('/chat/conversations', requireAuth, requirePermission('chat:view'), listConversations);
router.post('/chat/conversations', requireAuth, requirePermission('chat:create'), createConversation);
router.get('/chat/conversations/:conversationId/messages', requireAuth, requirePermission('chat:view'), getConversationMessages);
router.post('/chat/conversations/:conversationId/messages', requireAuth, requirePermission('chat:create'), sendConversationMessage);

export default router;
