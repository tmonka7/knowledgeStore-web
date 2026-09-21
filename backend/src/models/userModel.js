import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import { DEFAULT_USER_PERMISSIONS, sanitizePermissions } from '../helpers/permissionCatalog.js';

const userSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true, default: () => randomUUID() },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  fullName: { type: String, required: true, trim: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  // Admins bypass this list entirely; see hasPermission.
  permissions: { type: [String], default: () => [...DEFAULT_USER_PERMISSIONS] },
  passwordHash: { type: String, required: true },
  faceDescriptor: { type: [Number], default: null, select: false },
  faceImage: { type: String, default: null, select: false },
  createdAt: { type: Date, default: Date.now },
}, { collection: 'users' });

export const User = mongoose.models.User || mongoose.model('User', userSchema);

export const ensureSeedAdmin = async () => {
  const existingAdmin = await User.findOne({ username: 'admin' });
  if (existingAdmin) {
    return existingAdmin;
  }

  const passwordHash = await bcrypt.hash('admin123', 10);
  return User.create({
    id: randomUUID(),
    username: 'admin',
    email: 'admin@knowledge.store',
    fullName: 'System Administrator',
    role: 'admin',
    passwordHash,
  });
};

export const createUser = async ({ username, email, fullName, password, role = 'user', permissions, faceDescriptor, faceImage }) => {
  const passwordHash = await bcrypt.hash(password, 10);
  return User.create({
    id: randomUUID(),
    username: String(username).trim(),
    email: String(email).trim(),
    fullName: String(fullName).trim(),
    role,
    permissions: permissions ? sanitizePermissions(permissions) : [...DEFAULT_USER_PERMISSIONS],
    passwordHash,
    faceDescriptor,
    faceImage,
  });
};

export const getUsers = () => User.find().select('+faceImage').sort({ createdAt: -1 });
export const getUserById = (id) => User.findOne({ id }).select('+faceImage');
export const getUserByUsername = (username) => User.findOne({ username: String(username).toLowerCase() }).select('+faceDescriptor');

/**
 * Creates the superuser used by Database Management, or promotes and re-keys
 * the matching account when one already exists — running initialization twice
 * should leave you with a usable administrator either way.
 */
export const ensureSuperuser = async ({ username, email, fullName, password }) => {
  const cleanUsername = String(username).trim().toLowerCase();
  const cleanEmail = String(email).trim().toLowerCase();
  const existing = await User.findOne({ $or: [{ username: cleanUsername }, { email: cleanEmail }] });

  if (!existing) {
    const user = await createUser({
      username: cleanUsername,
      email: cleanEmail,
      fullName: String(fullName || '').trim() || 'System Administrator',
      password,
      role: 'admin',
    });
    return { created: true, user };
  }

  existing.username = cleanUsername;
  existing.email = cleanEmail;
  if (fullName) existing.fullName = String(fullName).trim();
  existing.role = 'admin';
  existing.passwordHash = await bcrypt.hash(password, 10);
  await existing.save();

  return { created: false, user: existing };
};
