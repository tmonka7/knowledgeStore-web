/**
 * Pill badge. `tone` picks the colour; `dot` adds the leading indicator that
 * animates for the green (online) tone.
 */
export default function StatusBadge({ children, tone = 'grey', dot = false, icon, className = '' }) {
  return (
    <span className={`vision-badge is-${tone} ${className}`.trim()}>
      {dot && <span className="vision-badge-dot" />}
      {icon}
      {children}
    </span>
  );
}

/** Maps a camera status to a badge tone. */
export const cameraTone = (status) => {
  if (status === 'online') return 'green';
  if (status === 'maintenance') return 'amber';
  return 'red';
};
