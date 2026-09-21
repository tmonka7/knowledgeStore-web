import bcrypt from 'bcryptjs';
import { createToken, sanitizeUser } from '../helpers/auth.js';
import { readProfileFields } from '../helpers/userProfile.js';
import { User, createUser, getUserByUsername } from '../models/store.js';

export const register = async (req, res) => {
  // `role` is deliberately not read from the body: public self-registration must
  // never be able to mint an admin. An admin promotes accounts via PUT /users/:id.
  const { faceDescriptor, faceImage } = req.body || {};
  const username = String(req.body?.username ?? '').trim().toLowerCase();
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const fullName = String(req.body?.fullName ?? '').trim();
  const password = String(req.body?.password ?? '');

  if (!username || !email || !fullName || !password) {
    return res.status(400).json({ message: 'Username, email, full name, and password are required.' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: 'Please enter a valid email address.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters.' });
  }

  if (!isFaceDescriptor(faceDescriptor)) {
    return res.status(400).json({ message: 'A face photo is required to create an account. Capture or upload one and try again.' });
  }

  if (!isFaceImage(faceImage)) {
    return res.status(400).json({ message: 'The face photo is invalid or too large. Please use a different photo.' });
  }

  // Gender, birthday, phone, address and job are all optional here: the sign-up
  // form offers them, and an account that skips them is still complete.
  const { values: profile, error: profileError } = readProfileFields(req.body || {});
  if (profileError) {
    return res.status(400).json({ message: profileError });
  }

  try {
    const existingUser = await User.findOne({ $or: [{ username }, { email }] });

    if (existingUser) {
      const field = existingUser.username === username ? 'username' : 'email';
      return res.status(409).json({ message: `That ${field} is already registered.` });
    }

    const newUser = await createUser({ username, email, fullName, password, role: 'user', faceDescriptor, faceImage, profile });
    const token = createToken(newUser.toObject ? newUser.toObject() : newUser);

    return res.status(201).json({
      token,
      user: sanitizeUser(newUser.toObject ? newUser.toObject() : newUser),
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'That username or email is already registered.' });
    }
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ message: Object.values(error.errors)[0]?.message || 'Invalid registration details.' });
    }
    console.error('Registration failed:', error);
    return res.status(500).json({ message: 'Registration failed. Please try again.' });
  }
};

export const login = async (req, res) => {
  const { username, password, faceDescriptor } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  try {
    const user = await getUserByUsername(username);
    if (!user?.passwordHash) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    const valid = await bcrypt.compare(String(password), user.passwordHash);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    if (user.faceDescriptor?.length) {
      if (faceDescriptor == null) {
        return res.status(401).json({ message: 'This account requires face verification. Use "Login with Face".', faceRequired: true });
      }
      if (!isFaceDescriptor(faceDescriptor) || faceDistance(user.faceDescriptor, faceDescriptor) > 0.6) {
        return res.status(401).json({ message: 'Face verification failed.' });
      }
    }

    const token = createToken(user.toObject ? user.toObject() : user);
    return res.json({
      token,
      user: sanitizeUser(user.toObject ? user.toObject() : user),
    });
  } catch (error) {
    console.error('Login failed:', error);
    return res.status(500).json({ message: 'Login failed. Please try again.' });
  }
};

const isFaceDescriptor = (descriptor) => Array.isArray(descriptor)
  && descriptor.length === 128
  && descriptor.every((value) => Number.isFinite(Number(value)));

const isFaceImage = (image) => typeof image === 'string'
  && /^data:image\/(jpeg|jpg|png);base64,/.test(image)
  && image.length <= 2_000_000;

const faceDistance = (left, right) => Math.sqrt(
  left.reduce((sum, value, index) => sum + ((Number(value) - Number(right[index])) ** 2), 0),
);
