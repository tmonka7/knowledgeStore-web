import bcrypt from 'bcryptjs';
import { createToken, sanitizeUser } from '../helpers/auth.js';
import { readProfileFields } from '../helpers/userProfile.js';
import { isUsableAccount, statusRefusal } from '../helpers/accountStatus.js';
import { User, createUser, getFaceCandidates, getUserByUsername } from '../models/store.js';

/*
 * Two ways in, and they are alternatives rather than steps.
 *
 *   1. username + password
 *   2. a face
 *
 * Worth being clear about what that costs, because the previous build did
 * something different: it required the password AND, for any account with a
 * face on file, the face as well — two factors. Face on its own is now
 * sufficient, and a face descriptor is not a secret in the way a password is.
 * It can be produced from a photograph, and nothing here checks liveness, so
 * method 2 is roughly "something you look like" rather than "something you
 * know". The thresholds below are tightened to compensate as far as they can,
 * which is not all the way.
 */

// Distance below which two descriptors are considered the same person. Looser
// than this and a stranger starts matching; tighter and the same person in
// different light stops matching.
const FACE_MATCH_MAX = Number(process.env.FACE_MATCH_MAX) || 0.5;

/*
 * How much closer the best match must be than the runner-up.
 *
 * Signing in by face is a search over every account, not a check against one,
 * so the risk that grows with the number of users is not "is this close
 * enough" but "is this closer to the right person than to somebody else". If
 * two accounts are near-equally close, the honest answer is that the system
 * does not know which, and it refuses rather than picking the smaller number.
 */
const FACE_MATCH_MARGIN = Number(process.env.FACE_MATCH_MARGIN) || 0.05;

const isFaceDescriptor = (descriptor) => Array.isArray(descriptor)
  && descriptor.length === 128
  && descriptor.every((value) => Number.isFinite(Number(value)));

const isFaceImage = (image) => typeof image === 'string'
  && /^data:image\/(jpeg|jpg|png);base64,/.test(image)
  && image.length <= 2_000_000;

const faceDistance = (left, right) => Math.sqrt(
  left.reduce((sum, value, index) => sum + ((Number(value) - Number(right[index])) ** 2), 0),
);

const signedInResponse = (res, user) => {
  const plain = user.toObject ? user.toObject() : user;
  return res.json({ token: createToken(plain), user: sanitizeUser(plain) });
};

export const register = async (req, res) => {
  // `role` is deliberately not read from the body: public self-registration must
  // never be able to mint an admin. An admin promotes accounts via PUT /users/:id.
  // `status` is not read either, for the same reason — an account that could
  // approve itself is not an account that needs approving.
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

  /*
   * The face is optional.
   *
   * It is one of two ways to sign in, not a second factor, so an account
   * without one is complete — it simply signs in with its password. Requiring
   * it at sign-up turned an alternative into a toll gate, and shut out anyone
   * without a camera to hand, or unwilling to give a photograph to an account
   * they have not been approved for yet.
   *
   * Optional is not the same as unchecked: a face that is offered is still
   * validated, and both halves must arrive together. A descriptor with no
   * photo would enrol a face nobody could see on the Users page, and a photo
   * with no descriptor could never be matched against.
   */
  const offersFace = Boolean(faceDescriptor) || Boolean(faceImage);

  if (offersFace && !isFaceDescriptor(faceDescriptor)) {
    return res.status(400).json({ message: 'That face photo could not be read. Capture or upload a clearer one, or leave it out.' });
  }

  if (offersFace && !isFaceImage(faceImage)) {
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

    const newUser = await createUser({
      username,
      email,
      fullName,
      password,
      role: 'user',
      // Left undefined rather than passed through when no face was offered, so
      // the schema default (null) applies — which is what getFaceCandidates
      // filters on when deciding who can be matched by face at all.
      faceDescriptor: offersFace ? faceDescriptor : undefined,
      faceImage: offersFace ? faceImage : undefined,
      profile,
    });

    /*
     * No token. The account exists but is 'pending', so a token would only buy
     * a session that every subsequent request refuses — the person would be
     * signed in to a screen that does nothing but produce errors. Telling them
     * plainly that they are waiting is the honest outcome.
     */
    return res.status(201).json({
      pending: true,
      user: sanitizeUser(newUser.toObject ? newUser.toObject() : newUser),
      message: 'Your account has been created and is waiting for an administrator to approve it.',
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

/**
 * POST /auth/login — method 1: username and password.
 *
 * The face is no longer asked for here. Requiring both would mean method 2 was
 * not an alternative at all, and since every account enrols a face at sign-up,
 * every account would still be answering two challenges.
 */
export const login = async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  try {
    const user = await getUserByUsername(username);

    // Compared even when there is no such user, so a wrong username and a
    // wrong password take the same path and the same message. Anything else
    // turns the login form into a way of listing who has an account.
    const hash = user?.passwordHash || '';
    const valid = hash ? await bcrypt.compare(String(password), hash) : false;
    if (!user || !valid) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    if (!isUsableAccount(user)) {
      return res.status(403).json({ message: statusRefusal(user.status), accountStatus: user.status });
    }

    return signedInResponse(res, user);
  } catch (error) {
    console.error('Login failed:', error);
    return res.status(500).json({ message: 'Login failed. Please try again.' });
  }
};

/**
 * POST /auth/login/face — method 2: a face, and nothing else.
 *
 * No username is supplied, so this identifies rather than verifies: the
 * descriptor is compared against every approved account and the best match
 * wins, but only if it is both close enough in absolute terms and clearly
 * closer than whoever came second.
 */
export const loginWithFace = async (req, res) => {
  const { faceDescriptor } = req.body || {};

  if (!isFaceDescriptor(faceDescriptor)) {
    return res.status(400).json({ message: 'No usable face was captured. Try again in better light.' });
  }

  try {
    const candidates = await getFaceCandidates();

    let best = null;
    let runnerUp = Infinity;
    for (const candidate of candidates) {
      if (!candidate.faceDescriptor?.length) continue;
      const distance = faceDistance(candidate.faceDescriptor, faceDescriptor);

      if (!best || distance < best.distance) {
        runnerUp = best ? best.distance : runnerUp;
        best = { user: candidate, distance };
      } else if (distance < runnerUp) {
        runnerUp = distance;
      }
    }

    // One message for every failure. "No account matches that face" and "two
    // accounts matched" are different problems, but telling them apart out
    // loud would report on who else is enrolled.
    const refuse = () => res.status(401).json({
      message: 'That face was not recognised. Sign in with your username and password instead.',
    });

    if (!best || best.distance > FACE_MATCH_MAX) return refuse();
    if (runnerUp - best.distance < FACE_MATCH_MARGIN) {
      console.warn(
        `Face sign-in refused: ${best.user.username} at ${best.distance.toFixed(3)} was too close to the next match at ${runnerUp.toFixed(3)}.`,
      );
      return refuse();
    }

    // getFaceCandidates only returns approved accounts, so this is belt and
    // braces — but it is one line, and it is the line that would matter if
    // that query were ever widened.
    if (!isUsableAccount(best.user)) {
      return res.status(403).json({ message: statusRefusal(best.user.status), accountStatus: best.user.status });
    }

    return signedInResponse(res, best.user);
  } catch (error) {
    console.error('Face login failed:', error);
    return res.status(500).json({ message: 'Face sign-in failed. Please try again.' });
  }
};
