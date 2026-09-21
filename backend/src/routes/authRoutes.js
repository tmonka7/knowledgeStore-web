import express from 'express';
import { login, loginWithFace, register } from '../controllers/authController.js';
import { asyncRoute } from '../helpers/asyncRoute.js';

const router = express.Router();

router.post('/auth/register', asyncRoute(register));

// The two ways in. Both are unauthenticated by definition, and both refuse an
// account that is still pending or has been denied.
router.post('/auth/login', asyncRoute(login));
router.post('/auth/login/face', asyncRoute(loginWithFace));

export default router;
