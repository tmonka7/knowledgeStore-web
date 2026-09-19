import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createMail, deleteMail, getMail, listInbox } from '../controllers/mailController.js';
import { requireAuth, requirePermission } from '../helpers/auth.js';

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

router.get('/mail/inbox', requireAuth, requirePermission('mail:view'), listInbox);
router.get('/mail/:mailId', requireAuth, requirePermission('mail:view'), getMail);
router.post('/mail', requireAuth, requirePermission('mail:create'), upload.single('attachment'), createMail);
router.delete('/mail/:mailId', requireAuth, requirePermission('mail:delete'), deleteMail);

export default router;
