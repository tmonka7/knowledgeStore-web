/*
 * Mirrors backend/src/helpers/taskWorkflow.js.
 *
 * A card may move to any other column. Reopen is not a column and not a
 * destination: a task already in that status can still be moved onto the
 * board. The API re-checks the destination.
 */
export const STATUS_COLUMNS = [
  { key: 'open', label: 'Open', tone: 'grey', hint: 'Reported, not picked up yet' },
  { key: 'in_progress', label: 'In Progress', tone: 'blue', hint: 'Someone is working on it' },
  { key: 'resolved', label: 'Resolved', tone: 'violet', hint: 'Waiting for verification' },
  { key: 'verified', label: 'Verified', tone: 'green', hint: 'Checked by someone else' },
  { key: 'closed', label: 'Closed', tone: 'cyan', hint: 'Done and filed away' },
];

export const STATUS_LABEL = {
  ...Object.fromEntries(STATUS_COLUMNS.map((column) => [column.key, column.label])),
  reopened: 'Reopened',
};
export const STATUS_TONE = {
  ...Object.fromEntries(STATUS_COLUMNS.map((column) => [column.key, column.tone])),
  reopened: 'red',
};

const columnKeys = STATUS_COLUMNS.map((column) => column.key);

export const nextStatuses = (status) => columnKeys.filter((key) => key !== status);

export const canTransition = (from, to) => from !== to && columnKeys.includes(to);

export const TRANSITION_LABEL = {
  open: 'Move back to open',
  in_progress: 'Start work',
  resolved: 'Resolve',
  verified: 'Verify',
  closed: 'Close',
};

/** Moving no longer asks for a resolution or a reason before the status changes. */
export const transitionNeeds = () => '';

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
