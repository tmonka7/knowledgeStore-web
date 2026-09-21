import jwt from 'jsonwebtoken';
import { hasPermission } from './permissionCatalog.js';
import { getUserById } from '../models/userModel.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'knowledge-store-secret';

export const sanitizeUser = (user) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  fullName: user.fullName,
  role: user.role,
  gender: user.gender || '',
  birthday: user.birthday || '',
  phone: user.phone || '',
  address: user.address || '',
  job: user.job || '',
  permissions: Array.isArray(user.permissions) ? user.permissions : [],
  faceImage: user.faceImage || null,
  createdAt: user.createdAt,
});

export const createToken = (user) => jwt.sign(
  { sub: user.id, username: user.username, role: user.role },
  JWT_SECRET,
  { expiresIn: '8h' },
);

export const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authentication required.' });
  }

  const token = authHeader.replace('Bearer ', '');
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
};

// Permissions are read from the database rather than the token, so a change
// takes effect on the user's next request instead of their next login.
const loadCurrentUser = async (req) => {
  if (!req.currentUser) {
    req.currentUser = await getUserById(req.user.sub);
  }
  return req.currentUser;
};

export const requirePermission = (permission) => async (req, res, next) => {
  try {
    const me = await loadCurrentUser(req);
    if (!me) {
      return res.status(401).json({ message: 'User no longer exists.' });
    }
    if (!hasPermission(me, permission)) {
      return res.status(403).json({ message: `You do not have the "${permission}" permission.` });
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

export const requireAdmin = async (req, res, next) => {
  try {
    const me = await loadCurrentUser(req);
    if (!me) {
      return res.status(401).json({ message: 'User no longer exists.' });
    }
    if (me.role !== 'admin') {
      return res.status(403).json({ message: 'Administrator access required.' });
    }
    return next();
  } catch (error) {
    return next(error);
  }
};
