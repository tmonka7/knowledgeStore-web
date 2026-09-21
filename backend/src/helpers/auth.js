import jwt from 'jsonwebtoken';
import { hasPermission } from './permissionCatalog.js';
import { isUsableAccount, statusRefusal } from './accountStatus.js';
import { getAccountById } from '../models/userModel.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'knowledge-store-secret';

export const sanitizeUser = (user) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  fullName: user.fullName,
  role: user.role,
  status: user.status || 'pending',
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

/**
 * Verifies the token, then checks the account behind it is still usable.
 *
 * The account is read from the database on every request, not taken from the
 * token. A token is a signed snapshot of who you were up to eight hours ago,
 * so without this an account that is deleted, or denied, keeps working until
 * its token happens to expire — and "revoke this person's access" that takes
 * effect some time before tomorrow is not a revocation.
 *
 * The cost is one indexed lookup per request, deliberately without the face
 * photo (see getAccountById). Every permission-gated route already paid it.
 */
export const requireAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authentication required.' });
  }

  const token = authHeader.replace('Bearer ', '');
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }

  try {
    const account = await getAccountById(payload.sub);
    if (!account) {
      return res.status(401).json({ message: 'This account no longer exists.' });
    }
    if (!isUsableAccount(account)) {
      // 403 rather than 401: the credentials were fine, the account is not.
      // `accountStatus` lets the browser sign the person out and say which of
      // the two it was instead of showing a generic failure.
      return res.status(403).json({
        message: statusRefusal(account.status),
        accountStatus: account.status,
      });
    }

    req.user = payload;
    req.currentUser = account;
    return next();
  } catch (error) {
    return next(error);
  }
};

// requireAuth has already loaded and checked the account; this is the fallback
// for any route that reaches a permission check without having gone through it.
const loadCurrentUser = async (req) => {
  if (!req.currentUser) {
    req.currentUser = await getAccountById(req.user.sub);
  }
  return req.currentUser;
};

// Permissions are read from the database rather than the token, so a change
// takes effect on the user's next request instead of their next login.
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
