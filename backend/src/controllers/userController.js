import bcrypt from 'bcryptjs';
import { sanitizeUser } from '../helpers/auth.js';
import { PERMISSION_CATALOG, sanitizePermissions } from '../helpers/permissionCatalog.js';
import { User, getUsers, getUserById } from '../models/store.js';

export const listPermissionCatalog = (req, res) => res.json({ catalog: PERMISSION_CATALOG });

export const updateUser = async (req, res) => {
  const { id } = req.params;
  const { fullName, email, role, permissions } = req.body || {};

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

  await target.save();

  return res.json({
    ok: true,
    user: sanitizeUser(target.toObject ? target.toObject() : target),
  });
};

export const listUsers = async (req, res) => {
  const isAdmin = req.user.role === 'admin';

  if (!isAdmin) {
    const me = await getUserById(req.user.sub);
    return res.json({ users: me ? [sanitizeUser(me.toObject ? me.toObject() : me)] : [] });
  }

  const users = await getUsers();
  return res.json({ users: users.map((user) => sanitizeUser(user.toObject ? user.toObject() : user)) });
};

export const getProfile = async (req, res) => {
  const me = await getUserById(req.user.sub);
  if (!me) {
    return res.status(404).json({ message: 'User not found.' });
  }

  return res.json({ user: sanitizeUser(me.toObject ? me.toObject() : me) });
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
