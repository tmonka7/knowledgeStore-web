import express from 'express';
import multer from 'multer';
import os from 'node:os';
import { convertFont, fontCapabilities } from '../controllers/lvglController.js';
import { convertCapabilities, convertVideo } from '../controllers/convertController.js';
import { requireAuth, requirePermission } from '../helpers/auth.js';

const router = express.Router();

// A source font is converted and discarded within the request, so it never
// needs to touch disk.
const fontUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 },
});

// Video is the opposite: files are far too large to hold in memory, and ffmpeg
// wants a path to read anyway. convertVideo unlinks both temp files when it is
// done, whether or not the conversion succeeded.
const videoUpload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 512 * 1024 * 1024 },
});

router.get('/tools/lvgl/capabilities', requireAuth, requirePermission('lvgl-tool:view'), fontCapabilities);
router.post(
  '/tools/lvgl/font',
  requireAuth,
  requirePermission('lvgl-tool:view'),
  fontUpload.single('font'),
  convertFont,
);

router.get('/tools/convert/capabilities', requireAuth, requirePermission('convert-tool:view'), convertCapabilities);
router.post(
  '/tools/convert/video',
  requireAuth,
  requirePermission('convert-tool:view'),
  videoUpload.single('video'),
  convertVideo,
);

export default router;
