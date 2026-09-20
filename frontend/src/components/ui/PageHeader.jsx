/** Page title, subtitle and right-aligned action buttons. */
export default function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="vision-page-header">
      <div>
        <h1 className="vision-page-title">{title}</h1>
        {subtitle && <p className="vision-page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="vision-page-actions">{actions}</div>}
    </div>
  );
}
