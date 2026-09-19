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
import { ensureSeedAdmin, ensureSeedCategories } from './models/store.js';

const app = express();
const PORT = Number(process.env.PORT || 4000);
const uploadDir = path.join(process.cwd(), 'uploads');

fs.mkdirSync(uploadDir, { recursive: true });
console.log(`Starting Knowledge Store API on port ${process.env.PORT}...`);
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/knowledge-store';
const allowedOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
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
