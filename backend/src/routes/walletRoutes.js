import express from 'express';
import {
  createEntry,
  deleteEntry,
  getSummary,
  listEntries,
  updateEntry,
} from '../controllers/walletController.js';
import { requireAuth, requirePermission } from '../helpers/auth.js';
import { asyncRoute } from '../helpers/asyncRoute.js';

const router = express.Router();

// Declared before '/wallet/entries/:id' would be, so 'summary' is never read as an id.
router.get('/wallet/summary', requireAuth, requirePermission('wallet:view'), asyncRoute(getSummary));

router.get('/wallet/entries', requireAuth, requirePermission('wallet:view'), asyncRoute(listEntries));
router.post('/wallet/entries', requireAuth, requirePermission('wallet:create'), asyncRoute(createEntry));
router.put('/wallet/entries/:id', requireAuth, requirePermission('wallet:edit'), asyncRoute(updateEntry));
router.delete('/wallet/entries/:id', requireAuth, requirePermission('wallet:delete'), asyncRoute(deleteEntry));

export default router;
