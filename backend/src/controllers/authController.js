import bcrypt from 'bcryptjs';
import { createToken, sanitizeUser } from '../helpers/auth.js';
import { User, createUser, getUserByUsername } from '../models/store.js';

export const register = async (req, res) => {
  // `role` is deliberately not read from the body: public self-registration must
  // never be able to mint an admin. An admin promotes accounts via PUT /users/:id.
  const { username, email, fullName, password, faceDescriptor, faceImage } = req.body || {};

  if (!username || !email || !fullName || !password) {
    return res.status(400).json({ message: 'Username, email, full name, and password are required.' });
  }

  if (!isFaceDescriptor(faceDescriptor) || !isFaceImage(faceImage)) {
    return res.status(400).json({ message: 'A valid face image is required to create an account.' });
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

  const newUser = await createUser({ username, email, fullName, password, role: 'user', faceDescriptor, faceImage });
  const token = createToken(newUser.toObject ? newUser.toObject() : newUser);

  return res.status(201).json({
    token,
    user: sanitizeUser(newUser.toObject ? newUser.toObject() : newUser),
  });
};

export const login = async (req, res) => {
  const { username, password, faceDescriptor } = req.body || {};

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

  if (user.faceDescriptor) {
    if (!isFaceDescriptor(faceDescriptor) || faceDistance(user.faceDescriptor, faceDescriptor) > 0.6) {
      return res.status(401).json({ message: 'Face verification failed.' });
    }
  }

  const token = createToken(user.toObject ? user.toObject() : user);
  return res.json({
    token,
    user: sanitizeUser(user.toObject ? user.toObject() : user),
  });
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
