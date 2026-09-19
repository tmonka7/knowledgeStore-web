import express from 'express';
import { createCameraRecord, deleteCamera, listCameras, updateCamera } from '../controllers/cameraController.js';
import { requireAuth, requirePermission } from '../helpers/auth.js';

const router = express.Router();

router.get('/cameras', requireAuth, requirePermission('cameras:view'), listCameras);
router.post('/cameras', requireAuth, requirePermission('cameras:create'), createCameraRecord);
router.put('/cameras/:id', requireAuth, requirePermission('cameras:edit'), updateCamera);
router.delete('/cameras/:id', requireAuth, requirePermission('cameras:delete'), deleteCamera);

export default router;
