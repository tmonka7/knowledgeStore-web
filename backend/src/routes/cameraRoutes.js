import express from 'express';
import {
  createCameraRecord,
  deleteCamera,
  discoverNetworkCameras,
  listCameras,
  updateCamera,
} from '../controllers/cameraController.js';
import { cameraFrame, movePtz, probeCamera, readPtzStatus } from '../controllers/ptzController.js';
import { requireAuth, requirePermission } from '../helpers/auth.js';

const router = express.Router();

router.get('/cameras', requireAuth, requirePermission('cameras:view'), listCameras);
router.post('/cameras', requireAuth, requirePermission('cameras:create'), createCameraRecord);
/*
 * Searching the network is gated on cameras:create rather than cameras:view.
 * It is the first step of adding a camera, and it is the one call here that
 * reaches addresses nobody has entered yet — it should be available to the
 * people who are allowed to act on what it finds, and to nobody else.
 */
router.post('/cameras/discover', requireAuth, requirePermission('cameras:create'), discoverNetworkCameras);
router.put('/cameras/:id', requireAuth, requirePermission('cameras:edit'), updateCamera);
router.delete('/cameras/:id', requireAuth, requirePermission('cameras:delete'), deleteCamera);

/*
 * PTZ.
 *
 * Moving a camera is gated on cameras:edit rather than cameras:view, because
 * it is not a way of looking at the camera — it changes where the camera
 * points for everybody watching it, and it can be used to point a camera away
 * from whatever it was installed to watch. Reading a frame is view.
 */
router.get('/cameras/:id/frame', requireAuth, requirePermission('cameras:view'), cameraFrame);
router.get('/cameras/:id/ptz/status', requireAuth, requirePermission('cameras:view'), readPtzStatus);
router.post('/cameras/:id/ptz/move', requireAuth, requirePermission('cameras:edit'), movePtz);
router.post('/cameras/:id/ptz/probe', requireAuth, requirePermission('cameras:edit'), probeCamera);

export default router;
