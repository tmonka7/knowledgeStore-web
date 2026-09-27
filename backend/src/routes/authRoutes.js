import os from 'node:os';
import express from 'express';
import multer from 'multer';
import {
  login, loginWithFace, loginWithVoice, register, voiceLoginStatus,
} from '../controllers/authController.js';
import { asyncRoute } from '../helpers/asyncRoute.js';

const router = express.Router();

// A sign-in clip: a few seconds of 16 kHz WAV is well under a megabyte.
const voiceUpload = multer({ dest: os.tmpdir(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

router.post('/auth/register', asyncRoute(register));

// The three ways in. All are unauthenticated by definition, and all refuse an
// account that is still pending or has been denied.
router.post('/auth/login', asyncRoute(login));
router.post('/auth/login/face', asyncRoute(loginWithFace));
router.post('/auth/login/voice', voiceUpload.single('audio'), asyncRoute(loginWithVoice));
router.get('/auth/voice', asyncRoute(voiceLoginStatus));

export default router;
