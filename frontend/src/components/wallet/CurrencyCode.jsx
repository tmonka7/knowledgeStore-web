import { CURRENCY_TONE } from './money';

/** A currency code in its own colour — USD red, REM (yuan) blue — wherever a figure's currency is named. */
export default function CurrencyCode({ code }) {
  return <span className={`vision-badge is-${CURRENCY_TONE[code] || 'blue'}`}>{code}</span>;
}
