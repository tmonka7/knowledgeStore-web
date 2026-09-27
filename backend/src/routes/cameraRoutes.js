import express from 'express';
import {
  createCameraRecord,
  deleteCamera,
  discoverNetworkCameras,
  listCameras,
  updateCamera,
} from '../controllers/cameraController.js';
import { cameraFrame, movePtz, probeCamera, readPtzStatus } from '../controllers/ptzController.js';
import {
  listCameraRecordings, playRecording, recordingLink, removeRecording, startCameraRecording, stopCameraRecording,
} from '../controllers/recordingController.js';
import { asyncRoute } from '../helpers/asyncRoute.js';
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

/*
 * Recording (helpers/cameraRecorder.js). Watching footage is cameras:view,
 * like watching the camera; starting or stopping a recorder is cameras:edit,
 * and deleting footage cameras:delete. The play URL carries no sign-in — a
 * <video> element cannot send one — so it only works with a token from
 * …/link, which needs cameras:view.
 */
router.post('/cameras/:id/recording/start', requireAuth, requirePermission('cameras:edit'), asyncRoute(startCameraRecording));
router.post('/cameras/:id/recording/stop', requireAuth, requirePermission('cameras:edit'), asyncRoute(stopCameraRecording));
router.get('/cameras/recordings', requireAuth, requirePermission('cameras:view'), asyncRoute(listCameraRecordings));
router.post('/cameras/recordings/:recordingId/link', requireAuth, requirePermission('cameras:view'), asyncRoute(recordingLink));
router.get('/cameras/recordings/play/:token', playRecording);
router.delete('/cameras/recordings/:recordingId', requireAuth, requirePermission('cameras:delete'), asyncRoute(removeRecording));

export default router;
