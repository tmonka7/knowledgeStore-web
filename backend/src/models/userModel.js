import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import { DEFAULT_USER_PERMISSIONS, sanitizePermissions } from '../helpers/permissionCatalog.js';
import { USER_GENDERS } from '../helpers/userProfile.js';
import { ACCOUNT_STATUSES, DEFAULT_ACCOUNT_STATUS } from '../helpers/accountStatus.js';

const userSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true, default: () => randomUUID() },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  fullName: { type: String, required: true, trim: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  // Whether the account may be used at all, decided by an administrator.
  // New accounts start 'pending'; see helpers/accountStatus.js. Existing
  // accounts predate this field and are set to 'allowed' once, at boot, by
  // helpers/accountStatusBackfill.js — without that they would all read as
  // 'pending' and everybody would be locked out by an upgrade.
  status: { type: String, enum: ACCOUNT_STATUSES, default: DEFAULT_ACCOUNT_STATUS, index: true },
  // Personal details. All optional: an account is usable without any of them,
  // and '' is the stored form of "not given" so a read never has to cope with
  // both undefined and null. `birthday` is a 'YYYY-MM-DD' string rather than a
  // Date for the same reason wallet entries are — a birthday is a calendar
  // day, and a Date would shift it across a timezone boundary.
  gender: { type: String, enum: [...USER_GENDERS, ''], default: '' },
  birthday: { type: String, default: '' },
  phone: { type: String, default: '', trim: true },
  address: { type: String, default: '', trim: true },
  job: { type: String, default: '', trim: true },
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
    // Explicit rather than left to the schema default: the seeded account is
    // the one that approves the others, so it must never be the one waiting
    // for approval.
    status: 'allowed',
    passwordHash,
  });
};

export const createUser = async ({
  username,
  email,
  fullName,
  password,
  role = 'user',
  // Only passed by a caller creating an account on an administrator's behalf.
  // Public registration leaves it out, so it lands on the schema default of
  // 'pending' and waits to be approved.
  status,
  permissions,
  faceDescriptor,
  faceImage,
  // Already normalised by readProfileFields; spread last so an absent field
  // falls back to the schema default rather than storing undefined.
  profile = {},
}) => {
  const passwordHash = await bcrypt.hash(password, 10);
  return User.create({
    id: randomUUID(),
    username: String(username).trim(),
    email: String(email).trim(),
    fullName: String(fullName).trim(),
    role,
    ...(status ? { status } : {}),
    ...profile,
    permissions: permissions ? sanitizePermissions(permissions) : [...DEFAULT_USER_PERMISSIONS],
    passwordHash,
    faceDescriptor,
    faceImage,
  });
};

export const getUsers = () => User.find().select('+faceImage').sort({ createdAt: -1 });
export const getUserById = (id) => User.findOne({ id }).select('+faceImage');

/**
 * The account behind a request, without the face photo.
 *
 * faceDescriptor and faceImage are `select: false`, so a plain findOne leaves
 * them out. That matters because the auth middleware now reads the account on
 * every single request, and the face image is a base64 data URL of up to two
 * megabytes — fetching it to check a status field would be the most expensive
 * thing most requests do.
 */
export const getAccountById = (id) => User.findOne({ id });
export const getUserByUsername = (username) => User.findOne({ username: String(username).toLowerCase() }).select('+faceDescriptor');

/**
 * Every account a face could be matched against.
 *
 * Narrowed to approved accounts on purpose. Signing in by face is a search
 * rather than a lookup — there is no username to start from — so the smaller
 * the candidate set, the lower the chance of matching the wrong person. It
 * also means a denied account cannot be identified, let alone let in.
 */
export const getFaceCandidates = () => User
  .find({ status: 'allowed', faceDescriptor: { $ne: null } })
  .select('+faceDescriptor');

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
      // Approved on creation. This account is the way back in after a reset,
      // and an administrator who has to be approved by an administrator is a
      // locked door with the key inside.
      status: 'allowed',
    });
    return { created: true, user };
  }

  existing.username = cleanUsername;
  existing.email = cleanEmail;
  if (fullName) existing.fullName = String(fullName).trim();
  existing.role = 'admin';
  existing.status = 'allowed';
  existing.passwordHash = await bcrypt.hash(password, 10);
  await existing.save();

  return { created: false, user: existing };
};
