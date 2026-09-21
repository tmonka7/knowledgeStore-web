import express from 'express';
import {
  createContactRecord,
  deleteContact,
  listContacts,
  setFavourite,
  updateContact,
} from '../controllers/contactController.js';
import { requireAuth, requirePermission } from '../helpers/auth.js';
import { asyncRoute } from '../helpers/asyncRoute.js';

const router = express.Router();

router.get('/contacts', requireAuth, requirePermission('contacts:view'), asyncRoute(listContacts));
router.post('/contacts', requireAuth, requirePermission('contacts:create'), asyncRoute(createContactRecord));
router.put('/contacts/:id', requireAuth, requirePermission('contacts:edit'), asyncRoute(updateContact));
router.patch('/contacts/:id/favourite', requireAuth, requirePermission('contacts:edit'), asyncRoute(setFavourite));
router.delete('/contacts/:id', requireAuth, requirePermission('contacts:delete'), asyncRoute(deleteContact));

export default router;
