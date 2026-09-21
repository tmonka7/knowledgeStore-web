import bcrypt from 'bcryptjs';
import { sanitizeUser } from '../helpers/auth.js';
import { PERMISSION_CATALOG, sanitizePermissions } from '../helpers/permissionCatalog.js';
import { readProfileFields } from '../helpers/userProfile.js';
import { ACCOUNT_STATUSES } from '../helpers/accountStatus.js';
import { describeUserFootprint, purgeUser } from '../helpers/userPurge.js';
import { User, getUsers, getUserById } from '../models/store.js';
import { writeLog } from '../models/activityLogModel.js';

export const listPermissionCatalog = (req, res) => res.json({ catalog: PERMISSION_CATALOG });

export const updateUser = async (req, res) => {
  const { id } = req.params;
  const { fullName, email, role, permissions, faceDescriptor, faceImage } = req.body || {};

  const target = await getUserById(id);
  if (!target) {
    return res.status(404).json({ message: 'User not found.' });
  }

  if (role && !['user', 'admin'].includes(role)) {
    return res.status(400).json({ message: 'Role must be either "user" or "admin".' });
  }

  // Without this an admin can strip their own admin rights and lock everyone out
  // of user management, since only admins can restore it.
  if (target.id === req.user.sub && role && role !== 'admin' && target.role === 'admin') {
    return res.status(400).json({ message: 'You cannot remove your own administrator role.' });
  }

  if (email && String(email).toLowerCase() !== target.email) {
    const clash = await User.findOne({ email: String(email).toLowerCase(), id: { $ne: target.id } });
    if (clash) {
      return res.status(409).json({ message: 'That email is already in use.' });
    }
    target.email = String(email).trim().toLowerCase();
  }

  if (fullName) target.fullName = String(fullName).trim();
  if (role) target.role = role;
  if (permissions !== undefined) target.permissions = sanitizePermissions(permissions);

  // Only the personal fields the request actually carries are touched, so an
  // editor that submits just the Basic Info tab cannot blank the rest.
  const { values: profile, error: profileError } = readProfileFields(req.body || {});
  if (profileError) {
    return res.status(400).json({ message: profileError });
  }
  Object.assign(target, profile);

  if (faceDescriptor !== undefined || faceImage !== undefined) {
    if (!isFaceDescriptor(faceDescriptor) || !isFaceImage(faceImage)) {
      return res.status(400).json({ message: 'A valid face image is required.' });
    }
    target.faceDescriptor = faceDescriptor.map((value) => Number(value));
    target.faceImage = faceImage;
  }

  await target.save();

  return res.json({
    ok: true,
    user: sanitizeUser(target.toObject ? target.toObject() : target),
  });
};

const isFaceDescriptor = (descriptor) => Array.isArray(descriptor)
  && descriptor.length === 128
  && descriptor.every((value) => Number.isFinite(Number(value)));

const isFaceImage = (image) => typeof image === 'string'
  && /^data:image\/(jpeg|jpg|png);base64,/.test(image)
  && image.length <= 2_000_000;

/**
 * GET /users
 *
 * Everyone, for anyone holding `users:view`.
 *
 * This used to narrow the list to the caller alone unless `req.user.role` said
 * 'admin' — and that role comes from the JWT, which carries whatever the role
 * was when the token was issued. So a non-admin granted `users:view` saw only
 * themselves, and an account promoted to admin kept seeing only themselves
 * until the next sign-in. The route is already gated on the permission that
 * means "may see the user list"; deciding it a second time here, from a stale
 * copy of the role, was the bug.
 */
export const listUsers = async (req, res) => {
  const users = await getUsers();
  return res.json({ users: users.map((user) => sanitizeUser(user.toObject ? user.toObject() : user)) });
};

/**
 * GET /users/directory
 *
 * Just enough to address someone: id, name and username, for every account.
 *
 * Signed in is the only requirement, because every user needs it — it is what
 * fills the "share this record with" picker, and sharing is not an
 * administrative act. It is deliberately narrower than GET /users, which
 * carries email, role and permissions and stays behind `users:view`.
 */
export const listDirectory = async (req, res) => {
  const users = await getUsers();
  return res.json({
    users: users
      .map((user) => ({ id: user.id, fullName: user.fullName, username: user.username }))
      .sort((a, b) => String(a.fullName).localeCompare(String(b.fullName))),
  });
};

export const getProfile = async (req, res) => {
  const me = await getUserById(req.user.sub);
  if (!me) {
    return res.status(404).json({ message: 'User not found.' });
  }

  return res.json({ user: sanitizeUser(me.toObject ? me.toObject() : me) });
};

/**
 * PUT /user/profile
 *
 * Your own personal details — gender, birthday, phone, address and job.
 *
 * Deliberately narrower than PUT /users/:id: name, email, role, permissions
 * and the face photo stay with an administrator, because they are what the
 * rest of the app identifies and authorises you by. This is the part of an
 * account that is nobody else's business to maintain, which is why it needs
 * no page permission.
 */
export const updateProfile = async (req, res) => {
  const me = await getUserById(req.user.sub);
  if (!me) {
    return res.status(404).json({ message: 'User not found.' });
  }

  const { values, error } = readProfileFields(req.body || {});
  if (error) {
    return res.status(400).json({ message: error });
  }

  Object.assign(me, values);
  await me.save();

  return res.json({ ok: true, user: sanitizeUser(me.toObject ? me.toObject() : me) });
};

export const updatePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Current password and new password are required.' });
  }

  if (String(newPassword).length < 6) {
    return res.status(400).json({ message: 'New password must be at least 6 characters.' });
  }

  const me = await getUserById(req.user.sub);
  if (!me) {
    return res.status(404).json({ message: 'User not found.' });
  }

  const valid = await bcrypt.compare(String(currentPassword), me.passwordHash);
  if (!valid) {
    return res.status(401).json({ message: 'Current password is incorrect.' });
  }

  me.passwordHash = await bcrypt.hash(String(newPassword), 10);
  await me.save();

  return res.json({ ok: true, message: 'Password updated successfully.' });
};

/*
 * Guards shared by "deny this account" and "delete this account".
 *
 * Both can lock everybody out of user management, which is the one door with
 * no way back in: only an administrator can approve or promote, so an
 * installation with no usable administrator cannot be repaired from the
 * application at all.
 */
const wouldRemoveLastAdmin = async (target) => {
  if (target.role !== 'admin') return false;
  const remaining = await User.countDocuments({
    role: 'admin',
    status: 'allowed',
    id: { $ne: target.id },
  });
  return remaining === 0;
};

/**
 * PUT /users/:id/status — Allow, Deny, or back to Pending.
 *
 * Its own endpoint rather than a field on the general update, because it is
 * the one change an administrator makes from a list without opening anything,
 * and because it carries guards the other fields do not need.
 */
export const setUserStatus = async (req, res) => {
  const status = String(req.body?.status || '');
  if (!ACCOUNT_STATUSES.includes(status)) {
    return res.status(400).json({ message: `Status must be one of: ${ACCOUNT_STATUSES.join(', ')}.` });
  }

  const target = await getUserById(req.params.id);
  if (!target) {
    return res.status(404).json({ message: 'User not found.' });
  }

  // You cannot lock yourself out. An administrator who denies their own
  // account loses the page they would need to undo it on.
  if (target.id === req.currentUser.id && status !== 'allowed') {
    return res.status(400).json({ message: 'You cannot deny or suspend your own account.' });
  }

  if (status !== 'allowed' && await wouldRemoveLastAdmin(target)) {
    return res.status(400).json({ message: 'This is the last administrator who can sign in. Approve another one first.' });
  }

  const previous = target.status;
  target.status = status;
  await target.save();

  await writeLog({
    source: 'users',
    action: `user:${status}`,
    message: `${target.username}: ${previous} → ${status}`,
    actor: { id: req.currentUser.id, username: req.currentUser.username },
  });

  return res.json({ ok: true, user: sanitizeUser(target.toObject ? target.toObject() : target) });
};

/**
 * GET /users/:id/deletion-preview
 *
 * What deleting this account would destroy, so the confirmation can say so
 * instead of asking "are you sure?" about an unknown quantity.
 */
export const previewUserDeletion = async (req, res) => {
  const target = await getUserById(req.params.id);
  if (!target) {
    return res.status(404).json({ message: 'User not found.' });
  }

  const footprint = await describeUserFootprint(target.id);

  return res.json({
    user: { id: target.id, username: target.username, fullName: target.fullName, role: target.role },
    ...footprint,
    blocked: await deletionBlocker(target, req.currentUser),
  });
};

const deletionBlocker = async (target, me) => {
  if (target.id === me.id) return 'You cannot delete your own account.';
  if (await wouldRemoveLastAdmin(target)) {
    return 'This is the last administrator who can sign in. Promote another one first.';
  }
  return '';
};

/**
 * DELETE /users/:id
 *
 * Removes the account and everything behind it. See helpers/userPurge.js for
 * exactly what that covers and what is unlinked rather than destroyed.
 */
export const deleteUser = async (req, res) => {
  const target = await getUserById(req.params.id);
  if (!target) {
    return res.status(404).json({ message: 'User not found.' });
  }

  const blocked = await deletionBlocker(target, req.currentUser);
  if (blocked) {
    return res.status(400).json({ message: blocked });
  }

  const removed = await purgeUser(target.id, { newOwnerId: req.currentUser.id });

  // Written after the purge, and by the administrator rather than the deleted
  // account, so it is not one of the log entries the purge just removed.
  await writeLog({
    source: 'users',
    action: 'user:delete',
    message: `Deleted ${target.username} (${target.fullName}) and everything belonging to the account`,
    actor: { id: req.currentUser.id, username: req.currentUser.username },
    meta: removed,
  });

  return res.json({ ok: true, removed });
};
