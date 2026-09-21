import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import {
  addReplicationMember,
  createDatabaseBackup,
  downloadBackup,
  getBackups,
  getOptimizationReport,
  getReplication,
  getStatus,
  initializeDatabase,
  initiateReplication,
  inspectBackup,
  listActivityLogs,
  removeBackup,
  removeReplicationMember,
  restoreDatabaseBackup,
  runOptimization,
  uploadBackup,
} from '../controllers/databaseController.js';
import { BACKUP_DIR } from '../helpers/databaseMaintenance.js';
import { requireAuth, requirePermission } from '../helpers/auth.js';
import { asyncRoute } from '../helpers/asyncRoute.js';

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, callback) => {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    callback(null, BACKUP_DIR);
  },
  // The uploaded name is rewritten rather than trusted: it lands in the same
  // folder the restore endpoints read from.
  filename: (req, file, callback) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    callback(null, `uploaded-${stamp}.json`);
  },
});

const uploadBackupFile = multer({
  storage,
  limits: { fileSize: 128 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (path.extname(file.originalname).toLowerCase() === '.json') {
      callback(null, true);
      return;
    }
    const error = new Error('Only .json backup files can be uploaded.');
    error.status = 400;
    callback(error, false);
  },
});

/* Reading the state of the database needs 'view'; anything that changes it
 * needs 'manage'. Administrators pass both, as everywhere else. */
router.get('/database/status', requireAuth, requirePermission('database:view'), asyncRoute(getStatus));
router.get('/database/logs', requireAuth, requirePermission('database:view'), asyncRoute(listActivityLogs));

router.post('/database/initialize', requireAuth, requirePermission('database:manage'), asyncRoute(initializeDatabase));

router.get('/database/backups', requireAuth, requirePermission('database:view'), asyncRoute(getBackups));
router.post('/database/backups', requireAuth, requirePermission('database:manage'), asyncRoute(createDatabaseBackup));
router.post(
  '/database/backups/upload',
  requireAuth,
  requirePermission('database:manage'),
  uploadBackupFile.single('backup'),
  asyncRoute(uploadBackup),
);
router.get('/database/backups/:name', requireAuth, requirePermission('database:view'), asyncRoute(inspectBackup));
router.get('/database/backups/:name/download', requireAuth, requirePermission('database:view'), asyncRoute(downloadBackup));
router.post('/database/backups/:name/restore', requireAuth, requirePermission('database:manage'), asyncRoute(restoreDatabaseBackup));
router.delete('/database/backups/:name', requireAuth, requirePermission('database:manage'), asyncRoute(removeBackup));

router.get('/database/replication', requireAuth, requirePermission('database:view'), asyncRoute(getReplication));
router.post('/database/replication/initiate', requireAuth, requirePermission('database:manage'), asyncRoute(initiateReplication));
router.post('/database/replication/members', requireAuth, requirePermission('database:manage'), asyncRoute(addReplicationMember));
router.delete('/database/replication/members', requireAuth, requirePermission('database:manage'), asyncRoute(removeReplicationMember));

router.get('/database/optimization', requireAuth, requirePermission('database:view'), asyncRoute(getOptimizationReport));
router.post('/database/optimize', requireAuth, requirePermission('database:manage'), asyncRoute(runOptimization));

export default router;
