import express from 'express';
import {
  getProfile,
  listPermissionCatalog,
  listUsers,
  updatePassword,
  updateProfile,
  updateUser,
} from '../controllers/userController.js';
import { requireAdmin, requireAuth, requirePermission } from '../helpers/auth.js';

const router = express.Router();

router.get('/users', requireAuth, requirePermission('users:view'), listUsers);
router.put('/users/:id', requireAuth, requireAdmin, updateUser);
router.get('/permissions/catalog', requireAuth, requireAdmin, listPermissionCatalog);

// Profile and own-password changes are intentionally ungated: every signed-in
// user needs them regardless of page permissions.
router.get('/user/profile', requireAuth, getProfile);
router.put('/user/password', requireAuth, updatePassword);
router.put('/user/profile', requireAuth, updateProfile);

export default router;
