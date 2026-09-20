/**
 * Statistic tile used across Users, Data, Camera and Live View.
 *
 * tone: blue | violet | cyan | green | amber | red
 * trend: 'up' | 'down' | undefined — only colours the meta line.
 */
export default function StatCard({ icon, label, value, meta, tone = 'blue', trend }) {
  const metaClass = ['vision-stat-meta', trend === 'up' && 'is-up', trend === 'down' && 'is-down']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={`vision-stat-card tone-${tone}`}>
      <span className="vision-stat-icon">{icon}</span>
      <div className="vision-stat-body">
        <div className="vision-stat-label">{label}</div>
        <div className="vision-stat-value">{value}</div>
        {meta && <div className={metaClass}>{meta}</div>}
      </div>
    </div>
  );
}
