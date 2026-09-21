import { User } from '../models/userModel.js';
import { runOnce } from '../models/migrationModel.js';
import { ALL_PERMISSIONS } from './permissionCatalog.js';

/*
 * Permissions added to the defaults after accounts already exist.
 *
 * DEFAULT_USER_PERMISSIONS is only read when an account is created, so adding
 * a key to it does nothing for anyone who registered earlier. That is what
 * made a new post invisible to every existing user: the account had no
 * `posts:view`, so the page was hidden from the sidebar and the notification
 * poll answered 403 — the post was published, and nobody was told.
 *
 * Each entry is applied once, against a marker, and never again: a grant an
 * administrator revokes afterwards has to stay revoked. Adding a page later
 * means adding an entry here with a new id, never editing an old one.
 */
const BACKFILLS = [
  {
    id: 'grant-posts-view-2026-09',
    permissions: ['posts:view'],
    note: 'Posts are announcements for everyone; reading them was added to the defaults after these accounts were created.',
  },
  {
    id: 'grant-meetings-2026-09',
    permissions: ['meetings:view', 'meetings:create', 'meetings:edit', 'meetings:delete'],
    note: 'Meetings shipped after these accounts were created. Edit and delete are scoped to your own meetings by the controller.',
  },
];

export const backfillDefaultPermissions = async () => {
  const applied = [];

  for (const entry of BACKFILLS) {
    // A typo here would write a permission no route ever checks, so every key
    // is validated against the catalog rather than trusted.
    const unknown = entry.permissions.filter((key) => !ALL_PERMISSIONS.includes(key));
    if (unknown.length) {
      console.warn(`Skipping backfill ${entry.id}: ${unknown.join(', ')} not in the catalog.`);
      continue;
    }

    const outcome = await runOnce(entry.id, entry.note, () => User.updateMany(
      {
        // Administrators bypass the list, so there is nothing to grant them.
        role: { $ne: 'admin' },
        // Matches an account missing even one of the keys. An $or of $ne
        // rather than a negated $all: $not takes an operator expression, and
        // wrapping $all in it is not something to rely on. $addToSet then
        // leaves the keys they already have alone.
        $or: entry.permissions.map((key) => ({ permissions: { $ne: key } })),
      },
      { $addToSet: { permissions: { $each: entry.permissions } } },
    ));

    if (outcome.applied) {
      const changed = outcome.result?.modifiedCount || 0;
      applied.push(`${entry.permissions.join(', ')} → ${changed} account(s)`);
    }
  }

  if (applied.length) console.log('Permission backfill:', applied.join('; '));
  return applied;
};
