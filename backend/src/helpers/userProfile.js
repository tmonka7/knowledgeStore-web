// Import-free on purpose: userModel reads the gender list from here, and the
// permission middleware imports userModel — anything imported here would end
// up in that cycle.

export const USER_GENDERS = ['male', 'female', 'other'];

const trimmed = (value, limit) => String(value ?? '').trim().slice(0, limit);

const isDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * The optional personal details on an account: gender, birthday, phone,
 * address and job.
 *
 * Only the keys actually present in the body come back, so a request that
 * omits a field leaves the stored value alone rather than blanking it. An
 * empty string is a real value — it is how a field is cleared.
 *
 * Returns { values, error }; a non-empty error is the message to send back
 * with a 400.
 */
export const readProfileFields = (body = {}) => {
  const values = {};

  if (body.gender !== undefined) {
    const gender = trimmed(body.gender, 10).toLowerCase();
    if (gender && !USER_GENDERS.includes(gender)) {
      return { values, error: `Gender must be one of ${USER_GENDERS.join(', ')}.` };
    }
    values.gender = gender;
  }

  if (body.birthday !== undefined) {
    const birthday = trimmed(body.birthday, 10);
    if (birthday) {
      if (!isDateKey(birthday)) {
        return { values, error: 'Birthday must be in YYYY-MM-DD format.' };
      }
      // 'T00:00:00Z' rather than the bare date so a day that does not exist,
      // such as 2001-02-30, is rejected instead of rolling into March.
      const date = new Date(`${birthday}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) {
        return { values, error: 'That birthday is not a real date.' };
      }
      if (date.getTime() > Date.now()) {
        return { values, error: 'Birthday cannot be in the future.' };
      }
    }
    values.birthday = birthday;
  }

  if (body.phone !== undefined) values.phone = trimmed(body.phone, 40);
  if (body.address !== undefined) values.address = trimmed(body.address, 200);
  if (body.job !== undefined) values.job = trimmed(body.job, 80);

  return { values, error: '' };
};
