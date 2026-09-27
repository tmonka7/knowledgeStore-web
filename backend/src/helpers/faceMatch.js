/*
 * Face descriptor maths, in one place.
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

export const isFaceDescriptor = (descriptor) => Array.isArray(descriptor)
  && descriptor.length === 128
  && descriptor.every((value) => Number.isFinite(Number(value)));

export const isFaceImage = (image) => typeof image === 'string'
  && /^data:image\/(jpeg|jpg|png);base64,/.test(image)
  && image.length <= 2_000_000;

export const faceDistance = (left, right) => Math.sqrt(
  left.reduce((sum, value, index) => sum + ((Number(value) - Number(right[index])) ** 2), 0),
);
