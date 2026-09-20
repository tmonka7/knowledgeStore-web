import { LeftOutlined, RightOutlined } from '@ant-design/icons';

/** Compact numbered pager. Renders nothing when there is a single page. */
export default function Pagination({ current, total, onChange }) {
  if (total <= 1) return null;

  return (
    <div className="vision-pagination">
      <button
        type="button"
        className="vision-pager-btn"
        disabled={current === 1}
        onClick={() => onChange(current - 1)}
        aria-label="Previous page"
      >
        <LeftOutlined />
      </button>
      {Array.from({ length: total }, (_, index) => index + 1).map((page) => (
        <button
          key={page}
          type="button"
          className={`vision-pager-btn${page === current ? ' is-active' : ''}`}
          onClick={() => onChange(page)}
          aria-current={page === current ? 'page' : undefined}
        >
          {page}
        </button>
      ))}
      <button
        type="button"
        className="vision-pager-btn"
        disabled={current === total}
        onClick={() => onChange(current + 1)}
        aria-label="Next page"
      >
        <RightOutlined />
      </button>
    </div>
  );
}
