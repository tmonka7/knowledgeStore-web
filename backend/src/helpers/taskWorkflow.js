/**
 * The bug lifecycle: report -> resolve -> verify.
 *
 * Statuses and their legal moves live here, not in the controller and not in
 * the browser, because the whole point of a verification step is that the
 * server refuses to skip it. The board mirrors this table to grey out columns
 * a card cannot be dropped on, but the API is what decides.
 */
export const TASK_STATUSES = ['open', 'in_progress', 'resolved', 'verified', 'reopened', 'closed'];

export const TASK_TYPES = ['bug', 'task', 'feature'];

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export const RESOLUTIONS = ['fixed', 'wont_fix', 'duplicate', 'cannot_reproduce', 'done'];

/** Work that is finished as far as progress is concerned. */
export const DONE_STATUSES = ['verified', 'closed'];

const TRANSITIONS = {
  open: ['in_progress', 'resolved', 'closed'],
  in_progress: ['resolved', 'open', 'closed'],
  // Nothing goes straight from resolved to closed: it is verified, or it is
  // sent back. That single rule is what makes the verification step real.
  resolved: ['verified', 'reopened'],
  verified: ['closed', 'reopened'],
  reopened: ['in_progress', 'resolved', 'closed'],
  closed: ['reopened'],
};

export const nextStatuses = (status) => TRANSITIONS[status] || [];

export const canTransition = (from, to) => nextStatuses(from).includes(to);
