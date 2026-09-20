/**
 * Filter toolbar shell. Children are the fields; `actions` sits on the right
 * and stacks underneath on mobile.
 */
export default function FilterBar({ children, actions, className = '' }) {
  return (
    <div className={`vision-filter-bar ${className}`.trim()}>
      {children}
      {actions && <div className="vision-filter-actions">{actions}</div>}
    </div>
  );
}
