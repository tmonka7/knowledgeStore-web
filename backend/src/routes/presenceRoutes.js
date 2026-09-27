import express from 'express';
import {
  choosePresence, goOffline, heartbeat, listPresence,
} from '../controllers/presenceController.js';
import { requireAuth } from '../helpers/auth.js';
import { asyncRoute } from '../helpers/asyncRoute.js';

const router = express.Router();

// Connection status. Every signed-in account sends heartbeats and sees who is
// connected: it is shown beside names in Chat and on the Users page, and
// carries nothing else. A blocked account is refused by requireAuth like any
// other request, which also signs its open app out.
router.get('/presence', requireAuth, asyncRoute(listPresence));
router.post('/presence/heartbeat', requireAuth, asyncRoute(heartbeat));
router.put('/presence/me', requireAuth, asyncRoute(choosePresence));
router.post('/presence/offline', requireAuth, asyncRoute(goOffline));

export default router;
