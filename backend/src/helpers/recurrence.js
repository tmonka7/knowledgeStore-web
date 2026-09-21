// Expanding a repeating schedule into the dates it actually falls on.
//
// Dates are plain 'YYYY-MM-DD' strings throughout, never Date objects. A
// schedule is a calendar concept, not an instant: "the 5th" means the 5th
// wherever you are, and storing an instant would shift it across timezones and
// drift over DST. Strings in this format also sort and compare lexicographically,
// so range checks are ordinary string comparisons.
//
// Used by both the calendar range query and the day-before notification check,
// so the two can never disagree about when something repeats.

export const REPEAT_MODES = ['none', 'daily', 'weekly', 'monthly'];

const DAY_MS = 86400000;

/** Guards every date coming from a request body or query string. */
export const isDateKey = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

export const isTimeKey = (value) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

/** UTC midnight for a date key. UTC keeps the arithmetic free of DST jumps. */
const toUtcMs = (key) => {
  const [year, month, day] = key.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};

// Named keyFromMs, not toKey: expandOccurrences takes a `toKey` parameter, and
// a shadowed helper here would be a call to a string.
const keyFromMs = (ms) => {
  const date = new Date(ms);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
};

export const addDays = (key, count) => keyFromMs(toUtcMs(key) + count * DAY_MS);

/** First day of the month `count` months after `key`; always a real date. */
const monthAnchor = (key, count) => {
  const [year, month] = key.split('-').map(Number);
  const index = (month - 1) + count;
  const targetYear = year + Math.floor(index / 12);
  const targetMonth = ((index % 12) + 12) % 12;
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-01`;
};

/**
 * The same day-of-month, `count` months on, or null when that month is too
 * short. A schedule on the 31st simply does not occur in February rather than
 * silently sliding to the 28th — the same choice Google Calendar makes.
 */
const addMonths = (key, count) => {
  const [year, month, day] = key.split('-').map(Number);
  const index = (month - 1) + count;
  const targetYear = year + Math.floor(index / 12);
  const targetMonth = ((index % 12) + 12) % 12;
  // Day 0 of the next month is the last day of this one.
  const daysInMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

// A window is caller-supplied, so bound the work regardless of what it asks for.
const MAX_OCCURRENCES = 1000;

/**
 * Every date `schedule` falls on within [fromKey, toKey], inclusive.
 *
 * @returns {string[]} date keys, ascending
 */
export const expandOccurrences = (schedule, fromKey, toKey) => {
  const start = schedule.date;
  if (!isDateKey(start) || !isDateKey(fromKey) || !isDateKey(toKey)) return [];
  if (fromKey > toKey) return [];

  // repeatUntil only ever narrows the window.
  const limit = isDateKey(schedule.repeatUntil) && schedule.repeatUntil < toKey
    ? schedule.repeatUntil
    : toKey;
  if (start > limit) return [];

  const repeat = REPEAT_MODES.includes(schedule.repeat) ? schedule.repeat : 'none';

  if (repeat === 'none') {
    return start >= fromKey && start <= limit ? [start] : [];
  }

  const occurrences = [];

  if (repeat === 'monthly') {
    for (let count = 0; count < MAX_OCCURRENCES; count += 1) {
      // Compare on the month, not the day: the day may not exist this month.
      if (monthAnchor(start, count) > limit) break;
      const key = addMonths(start, count);
      if (key && key >= fromKey && key <= limit) occurrences.push(key);
    }
    return occurrences;
  }

  const step = (repeat === 'daily' ? 1 : 7) * DAY_MS;
  const startMs = toUtcMs(start);
  const fromMs = toUtcMs(fromKey);

  // Jump straight to the first occurrence inside the window; a daily schedule
  // started years ago should not be stepped through one day at a time.
  let cursor = startMs;
  if (fromMs > startMs) {
    cursor = startMs + Math.ceil((fromMs - startMs) / step) * step;
  }

  while (occurrences.length < MAX_OCCURRENCES) {
    const key = keyFromMs(cursor);
    if (key > limit) break;
    occurrences.push(key);
    cursor += step;
  }

  return occurrences;
};

/**
 * Flatten schedules into dated occurrences for a window, sorted for display.
 *
 * @returns {{scheduleId, title, notes, date, time, repeat}[]}
 */
export const occurrencesInRange = (schedules, fromKey, toKey) => {
  const flattened = [];

  for (const schedule of schedules) {
    for (const date of expandOccurrences(schedule, fromKey, toKey)) {
      flattened.push({
        scheduleId: schedule.id,
        title: schedule.title,
        notes: schedule.notes,
        date,
        time: schedule.time,
        repeat: schedule.repeat,
      });
    }
  }

  return flattened.sort((a, b) => (
    a.date === b.date ? String(a.time).localeCompare(String(b.time)) : a.date.localeCompare(b.date)
  ));
};
