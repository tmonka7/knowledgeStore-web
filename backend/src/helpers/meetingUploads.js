import path from 'node:path';

/*
 * Where meeting recordings land.
 *
 * Its own folder under uploads/ for the same reason chat files have one: the
 * orphan sweep on the Database page walks the whole tree, and a recording that
 * nothing appeared to reference would be deleted as rubbish. Meetings are
 * listed in getReferencedUploads() so that cannot happen.
 */
export const MEETING_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'meetings');

/**
 * Turns a stored recording path into an absolute one, refusing anything that
 * points outside the meetings folder.
 *
 * Deleting a recording takes an id from the request, and the path it maps to
 * comes out of the database — but a document written by an older or buggier
 * version of this code is not a good enough reason to let `..` through to
 * fs.unlink.
 */
export const resolveMeetingUpload = (storedPath) => {
  const relative = String(storedPath || '')
    .replace(/^\/+/, '')
    .replace(/^uploads\/meetings\/?/, '');
  if (!relative) return null;

  const root = path.resolve(MEETING_UPLOAD_DIR);
  const absolute = path.resolve(root, relative);

  // path.relative is the check, not a startsWith on the string: 'uploads/meetings2'
  // starts with 'uploads/meetings' and is a different folder.
  const inside = path.relative(root, absolute);
  if (inside.startsWith('..') || path.isAbsolute(inside)) return null;

  return absolute;
};
