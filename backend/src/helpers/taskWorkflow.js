/**
 * Board columns a task may be moved to. `reopened` stays a stored status so
 * older tasks can still be moved off it, but it is not a destination.
 */
export const TASK_STATUSES = ['open', 'in_progress', 'resolved', 'verified', 'reopened', 'closed'];

export const BOARD_STATUSES = ['open', 'in_progress', 'resolved', 'verified', 'closed'];

export const TASK_TYPES = ['bug', 'task', 'feature'];

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export const RESOLUTIONS = ['fixed', 'wont_fix', 'duplicate', 'cannot_reproduce', 'done'];

/** Work that is finished as far as progress is concerned. */
export const DONE_STATUSES = ['verified', 'closed'];

export const nextStatuses = (status) => BOARD_STATUSES.filter((item) => item !== status);

export const canTransition = (from, to) => from !== to && BOARD_STATUSES.includes(to);
