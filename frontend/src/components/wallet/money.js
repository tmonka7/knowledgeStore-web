/*
 * The wallet holds two currencies and never converts between them: there is no
 * exchange rate anywhere in this app, so a combined figure would be invented.
 * Each entry carries its own code, and every total is reported per currency.
 *
 * REM is not an ISO 4217 code, so Intl cannot format it as a currency — it is
 * written as a plain number with the code after it, which is also what the
 * fallback below produces for anything else Intl rejects.
 */
export const CURRENCIES = ['USD', 'REM'];

export const DEFAULT_CURRENCY = 'USD';

const LAST_USED_KEY = 'wallet-currency';

// Codes Intl can style as currency. Anything outside this set is formatted as
// a number followed by its code.
const ISO_CURRENCIES = new Set(['USD']);

const numberFormat = (digits, compact) => new Intl.NumberFormat(undefined, {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits,
  notation: compact ? 'compact' : 'standard',
});

export const formatMoney = (value, currency = DEFAULT_CURRENCY, { compact = false } = {}) => {
  const amount = Number(value) || 0;
  const code = CURRENCIES.includes(currency) ? currency : DEFAULT_CURRENCY;
  const digits = compact ? 0 : 2;
  // Compact notation only once the figure is long enough to need it, so small
  // amounts still read as themselves on the stat cards.
  const useCompact = compact && Math.abs(amount) >= 10000;

  if (ISO_CURRENCIES.has(code)) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: code,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        notation: useCompact ? 'compact' : 'standard',
      }).format(amount);
    } catch (error) {
      /* Falls through to the plain form below. */
    }
  }

  return `${numberFormat(digits, useCompact).format(amount)} ${code}`;
};

/**
 * The currency the last entry was recorded in, used only to preselect the
 * field in the form. It is a convenience, never a filter: the statistics
 * always show every currency.
 */
export const readLastCurrency = () => {
  const stored = localStorage.getItem(LAST_USED_KEY);
  return CURRENCIES.includes(stored) ? stored : DEFAULT_CURRENCY;
};

export const rememberCurrency = (currency) => {
  if (CURRENCIES.includes(currency)) localStorage.setItem(LAST_USED_KEY, currency);
};
