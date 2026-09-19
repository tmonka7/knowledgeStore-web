import bcrypt from 'bcryptjs';
import { createToken, sanitizeUser } from '../helpers/auth.js';
import { User, createUser, getUserByUsername } from '../models/store.js';

export const register = async (req, res) => {
  // `role` is deliberately not read from the body: public self-registration must
  // never be able to mint an admin. An admin promotes accounts via PUT /users/:id.
  const { username, email, fullName, password } = req.body || {};

  if (!username || !email || !fullName || !password) {
    return res.status(400).json({ message: 'Username, email, full name, and password are required.' });
  }

  const existingUser = await User.findOne({
    $or: [
      { username: String(username).toLowerCase() },
      { email: String(email).toLowerCase() },
    ],
  });

  if (existingUser) {
    return res.status(409).json({ message: 'User already exists.' });
  }

  const newUser = await createUser({ username, email, fullName, password, role: 'user' });
  const token = createToken(newUser.toObject ? newUser.toObject() : newUser);

  return res.status(201).json({
    token,
    user: sanitizeUser(newUser.toObject ? newUser.toObject() : newUser),
  });
};

export const login = async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  const user = await getUserByUsername(username);
  if (!user) {
    return res.status(401).json({ message: 'Invalid username or password.' });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ message: 'Invalid username or password.' });
  }

  const token = createToken(user.toObject ? user.toObject() : user);
  return res.json({
    token,
    user: sanitizeUser(user.toObject ? user.toObject() : user),
  });
};
