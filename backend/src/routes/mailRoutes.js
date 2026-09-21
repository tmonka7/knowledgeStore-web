import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createMail, deleteMail, getMail, listMail, recentMail, unreadCount } from '../controllers/mailController.js';
import { requireAuth, requirePermission } from '../helpers/auth.js';
import { asyncRoute } from '../helpers/asyncRoute.js';

const router = express.Router();
const mailUploadDir = 'uploads/mail';
fs.mkdirSync(mailUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, callback) => callback(null, mailUploadDir),
  filename: (req, file, callback) => {
    const safeName = file.originalname.replace(/\s+/g, '_');
    callback(null, `${Date.now()}-${randomUUID()}-${safeName}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

const canView = [requireAuth, requirePermission('mail:view')];

// '/mail' takes ?folder=inbox|sent; '/mail/inbox' is kept as the name the
// previous build used, and answers the same thing.
router.get('/mail', canView, asyncRoute(listMail));
router.get('/mail/inbox', canView, asyncRoute(listMail));
// Before '/mail/:mailId' would be, so neither 'unread' nor 'recent' is ever
// read as a message id.
router.get('/mail/unread', canView, asyncRoute(unreadCount));
router.get('/mail/recent', canView, asyncRoute(recentMail));
router.get('/mail/:mailId', canView, asyncRoute(getMail));
router.post('/mail', requireAuth, requirePermission('mail:create'), upload.single('attachment'), asyncRoute(createMail));
router.delete('/mail/:mailId', requireAuth, requirePermission('mail:delete'), asyncRoute(deleteMail));

export default router;
