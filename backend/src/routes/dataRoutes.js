import express from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { createData, deleteData, listData, searchData, updateData } from '../controllers/dataController.js';
import { requireAuth, requirePermission } from '../helpers/auth.js';

const router = express.Router();
const storage = multer.diskStorage({
  destination: (req, file, callback) => {
    callback(null, 'uploads');
  },
  filename: (req, file, callback) => {
    const safeName = file.originalname.replace(/\s+/g, '_');
    callback(null, `${Date.now()}-${randomUUID()}-${safeName}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.get('/data', requireAuth, requirePermission('records:view'), listData);
router.get('/data/search', requireAuth, requirePermission('records:view'), searchData);
router.post('/data', requireAuth, requirePermission('records:create'), upload.array('attachment', 10), createData);
router.put('/data/:id', requireAuth, requirePermission('records:edit'), upload.array('attachment', 10), updateData);
router.delete('/data/:id', requireAuth, requirePermission('records:delete'), deleteData);

export default router;
