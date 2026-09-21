import fs from 'node:fs/promises';
import path from 'node:path';
import { ChatMessage } from '../models/chatModel.js';

/*
 * Files sent in chat are kept for a week and then deleted.
 *
 * Deleting the file does not delete the message: the name stays, with a tag
 * appended, so a conversation still reads as it happened — "they sent me the
 * log on the 3rd" — rather than silently losing the turn. That tagged name is
 * also how the UI knows to stop offering a download.
 */
export const CHAT_FILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Appended to the stored file name once the file itself is gone. */
export const DELETED_NAME_TAG = '(deleted)';

export const CHAT_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'chat');

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export const expiryFrom = (from = new Date()) => new Date(from.getTime() + CHAT_FILE_TTL_MS);

export const tagDeletedName = (name) => {
  const current = String(name || '');
  // Guarded so a second sweep of the same row cannot stack the tag.
  return current.endsWith(DELETED_NAME_TAG) ? current : `${current} ${DELETED_NAME_TAG}`;
};

/**
 * Resolves a stored attachment path to a file inside the chat upload folder.
 *
 * The path is one this server wrote, but it is read back out of the database,
 * so it is checked rather than trusted: anything that resolves outside the
 * folder is refused instead of unlinked.
 */
const resolveUpload = (storedPath) => {
  const relative = String(storedPath || '').replace(/^\/+/, '');
  const absolute = path.resolve(process.cwd(), relative);
  const root = path.resolve(CHAT_UPLOAD_DIR);
  return absolute === root || absolute.startsWith(`${root}${path.sep}`) ? absolute : '';
};

/**
 * Deletes every chat file whose week is up and tags its name.
 *
 * Returns what it did, so the caller can log it: { removed, missing, refused }.
 */
export const sweepExpiredChatFiles = async (now = new Date()) => {
  const due = await ChatMessage.find({
    'attachment.expiresAt': { $lte: now },
    'attachment.deletedAt': null,
  });

  let removed = 0;
  let missing = 0;
  let refused = 0;

  for (const message of due) {
    const absolute = resolveUpload(message.attachment.path);

    if (!absolute) {
      refused += 1;
      continue;
    }

    try {
      await fs.unlink(absolute);
      removed += 1;
    } catch (error) {
      // Already gone is the expected case on a second run or after a manual
      // cleanup; the row is still tagged so the UI stops offering it.
      if (error.code !== 'ENOENT') throw error;
      missing += 1;
    }

    message.attachment.name = tagDeletedName(message.attachment.name);
    message.attachment.deletedAt = now;
    await message.save();
  }

  return { due: due.length, removed, missing, refused };
};

/**
 * Runs the sweep at boot and every hour after.
 *
 * Hourly rather than daily because the app is often restarted, and an interval
 * this cheap (one indexed query that usually matches nothing) can afford to be
 * frequent. The timer is unref'd so it never holds the process open.
 */
export const startChatRetention = () => {
  const run = async () => {
    try {
      const result = await sweepExpiredChatFiles();
      if (result.removed || result.missing || result.refused) {
        console.log('Chat retention:', result);
      }
    } catch (error) {
      console.error('Chat retention sweep failed:', error.message);
    }
  };

  run();
  const timer = setInterval(run, SWEEP_INTERVAL_MS);
  timer.unref?.();
  return timer;
};
