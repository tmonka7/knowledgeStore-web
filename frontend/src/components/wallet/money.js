export const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'KRW', 'INR', 'VND'];

export const DEFAULT_CURRENCY = 'USD';

const zeroDecimal = new Set(['JPY', 'KRW', 'VND']);

/**
 * Amounts are stored as plain numbers; the currency is a display choice kept
 * in localStorage, so switching it never rewrites a single stored figure.
 */
export const formatMoney = (value, currency = DEFAULT_CURRENCY, { compact = false } = {}) => {
  const amount = Number(value) || 0;
  const digits = zeroDecimal.has(currency) ? 0 : 2;

  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: compact ? 0 : digits,
      maximumFractionDigits: compact ? 0 : digits,
      notation: compact && Math.abs(amount) >= 10000 ? 'compact' : 'standard',
    }).format(amount);
  } catch (error) {
    // An unknown currency code should not take the page down with it.
    return `${amount.toFixed(digits)} ${currency}`;
  }
};

export const readStoredCurrency = () => {
  const stored = localStorage.getItem('wallet-currency');
  return CURRENCIES.includes(stored) ? stored : DEFAULT_CURRENCY;
};
