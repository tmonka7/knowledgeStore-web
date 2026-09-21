import express from 'express';
import {
  deleteUser,
  getProfile,
  listDirectory,
  listPermissionCatalog,
  listUsers,
  previewUserDeletion,
  setUserStatus,
  updatePassword,
  updateProfile,
  updateUser,
} from '../controllers/userController.js';
import { requireAdmin, requireAuth, requirePermission } from '../helpers/auth.js';
import { asyncRoute } from '../helpers/asyncRoute.js';

const router = express.Router();

router.get('/users', requireAuth, requirePermission('users:view'), asyncRoute(listUsers));
// Declared before '/users/:id' would be, and ungated beyond sign-in: every
// user needs names to share a record with. See listDirectory.
router.get('/users/directory', requireAuth, asyncRoute(listDirectory));
router.put('/users/:id', requireAuth, requireAdmin, asyncRoute(updateUser));

// Allow / Deny / back to Pending. Administrators only: this is the control
// that decides whether an account can be used at all.
router.put('/users/:id/status', requireAuth, requireAdmin, asyncRoute(setUserStatus));

// Read before the delete, so the confirmation dialog can name what will go.
router.get('/users/:id/deletion-preview', requireAuth, requireAdmin, asyncRoute(previewUserDeletion));
router.delete('/users/:id', requireAuth, requireAdmin, asyncRoute(deleteUser));

router.get('/permissions/catalog', requireAuth, requireAdmin, asyncRoute(listPermissionCatalog));

// Profile and own-password changes are intentionally ungated: every signed-in
// user needs them regardless of page permissions.
router.get('/user/profile', requireAuth, asyncRoute(getProfile));
router.put('/user/password', requireAuth, asyncRoute(updatePassword));
router.put('/user/profile', requireAuth, asyncRoute(updateProfile));

export default router;
