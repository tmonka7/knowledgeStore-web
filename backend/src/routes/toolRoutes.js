import express from 'express';
import multer from 'multer';
import { convertFont } from '../controllers/lvglController.js';
import { requireAuth, requirePermission } from '../helpers/auth.js';

const router = express.Router();

// Memory storage, unlike the attachment routes: a source font is converted and
// discarded within the request, so writing it to uploads/ would only leave
// files nobody ever reads.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 },
});

router.post(
  '/tools/lvgl/font',
  requireAuth,
  requirePermission('lvgl-tool:view'),
  upload.single('font'),
  convertFont,
);

export default router;
