import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(backendRoot, '..');
dotenv.config({ path: path.join(backendRoot, '.env') });
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import dataRoutes from './routes/dataRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import mailRoutes from './routes/mailRoutes.js';
import cameraRoutes from './routes/cameraRoutes.js';
import toolRoutes from './routes/toolRoutes.js';
import scheduleRoutes from './routes/scheduleRoutes.js';
import walletRoutes from './routes/walletRoutes.js';
import databaseRoutes from './routes/databaseRoutes.js';
import projectRoutes from './routes/projectRoutes.js';
import contactRoutes from './routes/contactRoutes.js';
import postRoutes from './routes/postRoutes.js';
import meetingRoutes from './routes/meetingRoutes.js';
import { ensureSeedAdmin, ensureSeedCategories } from './models/store.js';
import { startChatRetention } from './helpers/chatRetention.js';
import { backfillDefaultPermissions } from './helpers/permissionBackfill.js';
import { backfillAccountStatus } from './helpers/accountStatusBackfill.js';
import { attachMeetingSignaling } from './helpers/meetingSignaling.js';

const resolveCertPath = (value) => {
  if (!value) return null;
  if (path.isAbsolute(value)) return value;

  const candidates = [
    path.resolve(backendRoot, value),
    path.resolve(workspaceRoot, value),
    path.resolve(process.cwd(), value),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
};
const app = express();
const PORT = Number(process.env.PORT || 4000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || PORT);
const SSL_KEY_PATH = resolveCertPath(process.env.SSL_KEY_PATH || 'server.key');
const SSL_CERT_PATH = resolveCertPath(process.env.SSL_CERT_PATH || 'server.crt');
const hasExplicitHttpsSetting = String(process.env.USE_HTTPS || '').toLowerCase() === 'true';
const hasSslFiles = fs.existsSync(SSL_KEY_PATH) && fs.existsSync(SSL_CERT_PATH);
const USE_HTTPS = hasSslFiles && process.env.USE_HTTPS !== 'false';

if (hasExplicitHttpsSetting && !hasSslFiles) {
  throw new Error(`USE_HTTPS=true but the certificate files were not found at ${SSL_KEY_PATH} and ${SSL_CERT_PATH}.`);
}
/*
 * Loopback by default, which is what this has always been.
 *
 * It is called out because it is the one setting that decides whether a video
 * meeting can have more than one person in it: bound to 127.0.0.1, the only
 * browsers that can reach this server are the ones on this machine. Set
 * HOST=0.0.0.0 to let the rest of the network in — and read the CORS note below
 * before doing it, because that allowance is separate.
 */
const HOST = process.env.HOST || '127.0.0.1';
const uploadDir = path.join(process.cwd(), 'uploads');
// Database backups are written here by the Database Management page.
const backupDir = path.join(process.cwd(), 'backups');

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });
console.log(`Starting Knowledge Store API on port ${process.env.PORT}...`);
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/knowledge-store';
const normalizeOrigin = (origin) => origin ? origin.trim().replace(/\/$/, '').toLowerCase() : '';

const isLocalOrigin = (origin) => {
  try {
    const { protocol, hostname } = new URL(origin);
    const localHostnames = new Set([
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '::1',
      '[::1]',
    ]);

    if (!['http:', 'https:'].includes(protocol)) return false;
    if (localHostnames.has(hostname)) return true;
    if (hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.localdomain')) return true;
    if (/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.)/.test(hostname)) return true;
    return false;
  } catch {
    return false;
  }
};

/*
 * Extra origins, comma separated, for when the frontend is served to other
 * machines — a meeting with colleagues in it needs this.
 *
 * Opt-in rather than a wildcard: matching the exact origins you serve from is
 * the difference between "my team can join" and "any page on the internet can
 * make requests to this API with a logged-in browser".
 */
const extraOrigins = new Set(
  String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => normalizeOrigin(value))
    .filter(Boolean),
);

app.use(cors({
  origin: (origin, callback) => {
    const normalizedOrigin = normalizeOrigin(origin);
    if (!origin || isLocalOrigin(origin) || extraOrigins.has(normalizedOrigin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '3mb' }));
app.use('/uploads', express.static(uploadDir));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Knowledge Store API is running.' });
});

app.use('/api', authRoutes);
app.use('/api', userRoutes);
app.use('/api', categoryRoutes);
app.use('/api', dataRoutes);
app.use('/api', chatRoutes);
app.use('/api', mailRoutes);
app.use('/api', cameraRoutes);
app.use('/api', toolRoutes);
app.use('/api', scheduleRoutes);
app.use('/api', walletRoutes);
app.use('/api', databaseRoutes);
app.use('/api', projectRoutes);
app.use('/api', contactRoutes);
app.use('/api', postRoutes);
app.use('/api', meetingRoutes);

// Without this, CORS/body-parser failures return an HTML error page that the
// frontend cannot read, so every failure looks the same to the user.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error(`${req.method} ${req.originalUrl} failed:`, error.message);
  const status = error.status || (error.type === 'entity.too.large' ? 413 : 500);
  return res.status(status).json({
    message: error.type === 'entity.too.large'
      ? 'That request is too large. Please use a smaller photo.'
      : error.message || 'Something went wrong.',
  });
});

const startServer = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log(`Connected to MongoDB: ${MONGODB_URI}`);
    await ensureSeedAdmin();
    await ensureSeedCategories();
    // Both applied once, before the port opens: the status backfill in
    // particular must finish before anyone can attempt to sign in, or every
    // pre-existing account reads as 'pending' and nobody gets in.
    await backfillAccountStatus();
    await backfillDefaultPermissions();
    // Chat files last a week. Swept at boot as well as hourly, so a server
    // that was down over the expiry still clears them on the way back up.
    startChatRetention();

    /*
     * An explicit server object rather than app.listen(), because the meeting
     * signalling socket has to share this port: WebSocket upgrades arrive on
     * the same connection the API is served over, and ws needs the server
     * object to intercept them. Express alone never exposes it.
     */
    const server = USE_HTTPS
      ? https.createServer({
          key: fs.readFileSync(SSL_KEY_PATH),
          cert: fs.readFileSync(SSL_CERT_PATH),
        }, app)
      : http.createServer(app);
    attachMeetingSignaling(server);

    const listenPort = USE_HTTPS ? HTTPS_PORT : PORT;
    const protocol = USE_HTTPS ? 'https' : 'http';

    server.listen(listenPort, HOST, () => {
      console.log(`Knowledge Store API is running on ${protocol}://${HOST}:${listenPort}`);
    });
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    process.exit(1);
  }
};

startServer();
