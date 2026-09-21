/*
 * Mirrors backend/src/helpers/taskWorkflow.js.
 *
 * The copy exists so the board can grey out a column a card cannot be dropped
 * on, and so the drawer only offers the moves that will be accepted. The API
 * re-checks every one of them: this file shapes the UI, it does not decide.
 */
export const STATUS_COLUMNS = [
  { key: 'open', label: 'Open', tone: 'grey', hint: 'Reported, not picked up yet' },
  { key: 'in_progress', label: 'In Progress', tone: 'blue', hint: 'Someone is working on it' },
  { key: 'resolved', label: 'Resolved', tone: 'violet', hint: 'Waiting for verification' },
  { key: 'verified', label: 'Verified', tone: 'green', hint: 'Checked by someone else' },
  { key: 'reopened', label: 'Reopened', tone: 'red', hint: 'Verification failed' },
  { key: 'closed', label: 'Closed', tone: 'cyan', hint: 'Done and filed away' },
];

export const STATUS_LABEL = Object.fromEntries(STATUS_COLUMNS.map((column) => [column.key, column.label]));
export const STATUS_TONE = Object.fromEntries(STATUS_COLUMNS.map((column) => [column.key, column.tone]));

const TRANSITIONS = {
  open: ['in_progress', 'resolved', 'closed'],
  in_progress: ['resolved', 'open', 'closed'],
  resolved: ['verified', 'reopened'],
  verified: ['closed', 'reopened'],
  reopened: ['in_progress', 'resolved', 'closed'],
  closed: ['reopened'],
};

export const nextStatuses = (status) => TRANSITIONS[status] || [];

export const canTransition = (from, to) => nextStatuses(from).includes(to);

export const TRANSITION_LABEL = {
  open: 'Move back to open',
  in_progress: 'Start work',
  resolved: 'Resolve',
  verified: 'Verify',
  reopened: 'Reopen',
  closed: 'Close',
};

/** A resolution is required to resolve; a reason is required to reopen. */
export const transitionNeeds = (to) => ({
  resolved: 'resolution',
  reopened: 'note',
}[to] || '');

export const RESOLUTIONS = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'done', label: 'Done' },
  { value: 'wont_fix', label: "Won't fix" },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'cannot_reproduce', label: 'Cannot reproduce' },
];

export const RESOLUTION_LABEL = Object.fromEntries(RESOLUTIONS.map((item) => [item.value, item.label]));

export const PRIORITIES = [
  { value: 'urgent', label: 'Urgent', tone: 'red' },
  { value: 'high', label: 'High', tone: 'amber' },
  { value: 'normal', label: 'Normal', tone: 'blue' },
  { value: 'low', label: 'Low', tone: 'grey' },
];

export const PRIORITY_TONE = Object.fromEntries(PRIORITIES.map((item) => [item.value, item.tone]));
export const PRIORITY_LABEL = Object.fromEntries(PRIORITIES.map((item) => [item.value, item.label]));

export const TASK_TYPES = [
  { value: 'bug', label: 'Bug' },
  { value: 'task', label: 'Task' },
  { value: 'feature', label: 'Feature' },
];

export const TYPE_LABEL = Object.fromEntries(TASK_TYPES.map((item) => [item.value, item.label]));

export const PROJECT_STATUSES = [
  { value: 'planning', label: 'Planning', tone: 'grey' },
  { value: 'active', label: 'Active', tone: 'green' },
  { value: 'on_hold', label: 'On hold', tone: 'amber' },
  { value: 'completed', label: 'Completed', tone: 'blue' },
  { value: 'archived', label: 'Archived', tone: 'grey' },
];

export const PROJECT_STATUS_LABEL = Object.fromEntries(PROJECT_STATUSES.map((item) => [item.value, item.label]));
export const PROJECT_STATUS_TONE = Object.fromEntries(PROJECT_STATUSES.map((item) => [item.value, item.tone]));
