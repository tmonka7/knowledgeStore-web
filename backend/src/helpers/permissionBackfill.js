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
 * administrator revokes afterwards has to stay revoked.
 */
const BACKFILLS = [
  {
    id: 'grant-posts-view-2026-09',
    permission: 'posts:view',
    note: 'Posts are announcements for everyone; reading them was added to the defaults after these accounts were created.',
  },
];

export const backfillDefaultPermissions = async () => {
  const applied = [];

  for (const entry of BACKFILLS) {
    // A typo here would write a permission no route ever checks, so the key is
    // validated against the catalog rather than trusted.
    if (!ALL_PERMISSIONS.includes(entry.permission)) {
      console.warn(`Skipping backfill ${entry.id}: ${entry.permission} is not in the catalog.`);
      continue;
    }

    const outcome = await runOnce(entry.id, entry.note, () => User.updateMany(
      // Administrators bypass the list, so there is nothing to grant them.
      { role: { $ne: 'admin' }, permissions: { $ne: entry.permission } },
      { $addToSet: { permissions: entry.permission } },
    ));

    if (outcome.applied) {
      const changed = outcome.result?.modifiedCount || 0;
      applied.push(`${entry.permission} → ${changed} account(s)`);
    }
  }

  if (applied.length) console.log('Permission backfill:', applied.join('; '));
  return applied;
};
