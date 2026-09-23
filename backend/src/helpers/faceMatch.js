/*
 * Face descriptor maths, in one place.
 *
 * This was inside authController, which was fine while signing in was the only
 * thing that compared faces. Automatic attendance compares them too, and the
 * two must agree: if attendance decided two descriptors were the same person
 * at a distance sign-in would reject, an attendance list would name people the
 * system would refuse to let in. Same function, same thresholds, one file.
 *
 * The distance is plain Euclidean over the 128 dimensions face-api produces.
 * Descriptors are already L2-normalised by the model, so this is monotonic
 * with cosine distance and the usual published thresholds apply.
 */

// Distance below which two descriptors are considered the same person. Looser
// than this and a stranger starts matching; tighter and the same person in
// different light stops matching.
export const FACE_MATCH_MAX = Number(process.env.FACE_MATCH_MAX) || 0.5;

/*
 * How much closer the best match must be than the runner-up.
 *
 * Matching a face against a roster is a search over every account, not a check
 * against one, so the risk that grows with the number of people is not "is
 * this close enough" but "is this closer to the right person than to somebody
 * else". If two accounts are near-equally close, the honest answer is that the
 * system does not know which, and it refuses rather than picking the smaller
 * number.
 */
export const FACE_MATCH_MARGIN = Number(process.env.FACE_MATCH_MARGIN) || 0.05;

/*
 * The distance at which two sightings during one sweep are treated as the same
 * face. Deliberately tighter than FACE_MATCH_MAX.
 *
 * These two numbers answer different questions. FACE_MATCH_MAX asks "is this
 * the person whose descriptor we enrolled", across months, cameras and
 * lighting. This one asks "is this the person we saw four seconds ago, in the
 * same room, under the same light, from an overlapping angle" — conditions so
 * similar that a genuine re-sighting lands far closer than 0.5. Using the
 * looser number here would merge two colleagues who happen to resemble each
 * other into a single attendance row, and the merge is invisible: the sweep
 * would simply report one person fewer than walked past it.
 */
export const FACE_SAME_SIGHTING = Number(process.env.FACE_SAME_SIGHTING) || 0.38;

export const isFaceDescriptor = (descriptor) => Array.isArray(descriptor)
  && descriptor.length === 128
  && descriptor.every((value) => Number.isFinite(Number(value)));

export const isFaceImage = (image) => typeof image === 'string'
  && /^data:image\/(jpeg|jpg|png);base64,/.test(image)
  && image.length <= 2_000_000;

export const faceDistance = (left, right) => Math.sqrt(
  left.reduce((sum, value, index) => sum + ((Number(value) - Number(right[index])) ** 2), 0),
);

/**
 * Best and runner-up match for one descriptor over a list of candidates.
 *
 * Returns { match, distance, runnerUp, ambiguous } where `match` is null when
 * nothing was close enough, and `ambiguous` is true when something was close
 * enough but the runner-up was nearly as close. A caller that treats those two
 * the same is throwing away the distinction that stops the wrong name being
 * written down.
 *
 * `descriptorOf` pulls the 128 numbers off whatever the candidates are, so the
 * same function serves user accounts and stored visitor faces.
 */
export const bestMatch = (descriptor, candidates, descriptorOf = (item) => item.faceDescriptor, {
  maxDistance = FACE_MATCH_MAX,
  margin = FACE_MATCH_MARGIN,
} = {}) => {
  let match = null;
  let distance = Infinity;
  let runnerUp = Infinity;

  for (const candidate of candidates) {
    const other = descriptorOf(candidate);
    if (!other?.length) continue;

    const current = faceDistance(other, descriptor);
    if (current < distance) {
      runnerUp = distance;
      distance = current;
      match = candidate;
    } else if (current < runnerUp) {
      runnerUp = current;
    }
  }

  if (!match || distance > maxDistance) {
    return { match: null, distance, runnerUp, ambiguous: false };
  }

  // A finite runner-up that is not clearly further away means the roster
  // cannot tell these people apart on this frame.
  const ambiguous = Number.isFinite(runnerUp) && (runnerUp - distance) < margin;
  return { match: ambiguous ? null : match, distance, runnerUp, ambiguous };
};
