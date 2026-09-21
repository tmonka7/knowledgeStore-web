import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import dataRoutes from './routes/dataRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import mailRoutes from './routes/mailRoutes.js';
import cameraRoutes from './routes/cameraRoutes.js';
import toolRoutes from './routes/toolRoutes.js';
import scheduleRoutes from './routes/scheduleRoutes.js';
import { ensureSeedAdmin, ensureSeedCategories } from './models/store.js';

const app = express();
const PORT = Number(process.env.PORT || 4000);
const uploadDir = path.join(process.cwd(), 'uploads');

fs.mkdirSync(uploadDir, { recursive: true });
console.log(`Starting Knowledge Store API on port ${process.env.PORT}...`);
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/knowledge-store';
// Vite falls back to another port when 5173/4173 is taken (strictPort is off),
// so allow any port on the loopback host instead of a fixed list.
const isLocalOrigin = (origin) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || isLocalOrigin(origin)) {
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
    app.listen(PORT, '127.0.0.1', () => {
      console.log(`Knowledge Store API is running on http://127.0.0.1:${PORT}`);
    });
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    process.exit(1);
  }
};

startServer();
