// Who may do what with a dataset (Tools > AI: translation, YOLO, Speech to
// Text, voice, command sets, and Speaker recognition's speakers).
//
// Datasets are shared: everyone who can open a tool sees every dataset in it,
// trains and tests on them, and adds to them — recordings, files, rows,
// samples. Changing what a dataset is (its name, commands, classes, script,
// languages), removing what someone else added, and deleting the dataset are
// for the person who created it and administrators.
//
// A caller is { id, admin }. Code that only reads (training jobs, exports)
// may pass a bare user id, which is read as a non-admin caller.

import { JobError } from './translationJobs.js';
import { User } from '../models/userModel.js';

/** The caller of a request: the signed-in account and whether it is an administrator. */
export const callerOf = (req) => ({ id: String(req.user?.sub || ''), admin: req.currentUser?.role === 'admin' });

export const asCaller = (value) => (value && typeof value === 'object'
  ? { id: String(value.id || ''), admin: Boolean(value.admin) }
  : { id: String(value || ''), admin: false });

export const canManage = (caller, ownerId) => {
  const who = asCaller(caller);
  return who.admin || (Boolean(who.id) && who.id === ownerId);
};

/** Throws unless the caller created the dataset or is an administrator. */
export const requireManage = (caller, ownerId, what = 'dataset') => {
  if (!canManage(caller, ownerId)) {
    throw new JobError(`Only the person who created this ${what}, or an administrator, can do that.`, 403);
  }
};

/**
 * May the caller change or remove something inside a dataset — a recording,
 * a row, a sample? Yes for the dataset's managers, and for whoever added it.
 * Things with no `addedBy` were there before sharing, or added by the owner.
 */
export const canChangeItem = (caller, ownerId, addedBy) => {
  const who = asCaller(caller);
  return canManage(who, ownerId) || (Boolean(addedBy) && addedBy === who.id);
};

/*
 * Owner names, for "by …" beside each dataset. Read from the accounts once in
 * a while rather than per dataset: lists are fetched often and accounts
 * change rarely.
 */
const NAMES_MS = 30 * 1000;
let names = { at: 0, map: new Map(), pending: null };

const ownerNameMap = async () => {
  if (Date.now() - names.at < NAMES_MS) return names.map;
  if (!names.pending) {
    names.pending = User.find().select('id fullName username').lean()
      .then((users) => {
        names = { at: Date.now(), map: new Map(users.map((user) => [user.id, user.fullName || user.username])), pending: null };
        return names.map;
      })
      .catch(() => {
        names.pending = null;
        return names.map;
      });
  }
  return names.pending;
};

/** Adds ownerName, mine and canManage to a dataset (or anything with an ownerId). */
export const describeOwner = async (caller, item) => {
  const who = asCaller(caller);
  const map = await ownerNameMap();
  return {
    ...item,
    ownerName: map.get(item.ownerId) || '',
    mine: item.ownerId === who.id,
    canManage: canManage(who, item.ownerId),
  };
};

export const describeOwners = async (caller, items) => {
  await ownerNameMap();
  return Promise.all(items.map((item) => describeOwner(caller, item)));
};
