import { Button } from 'antd';
import {
  ArrowRightOutlined,
  DatabaseOutlined,
  EnvironmentOutlined,
  FileTextOutlined,
  FolderOutlined,
  HddOutlined,
  MoreOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  SafetyOutlined,
  SettingOutlined,
  TagsOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';

const recentData = [
  { id: 'DS-0001', name: 'Project Plan', category: 'Documents', size: '2.5 MB', createdAt: '2025-09-17 09:32', action: '⋮' },
  { id: 'DS-0002', name: 'Customer List', category: 'Customers', size: '1.2 MB', createdAt: '2025-09-17 08:45', action: '⋮' },
  { id: 'DS-0003', name: 'Product Image', category: 'Images', size: '5.6 MB', createdAt: '2025-09-16 16:20', action: '⋮' },
  { id: 'DS-0004', name: 'System Log', category: 'Logs', size: '842 KB', createdAt: '2025-09-16 14:12', action: '⋮' },
  { id: 'DS-0005', name: 'Report Q3', category: 'Reports', size: '3.1 MB', createdAt: '2025-09-16 11:03', action: '⋮' },
];

const basicCards = [
  { title: 'Categories', icon: <FolderOutlined />, count: '12 categories', desc: 'Manage data categories and classification rules.', tone: 'blue' },
  { title: 'Tags', icon: <TagsOutlined />, count: '36 tags', desc: 'Manage tags for better data organization.', tone: 'green' },
  { title: 'Storage Locations', icon: <EnvironmentOutlined />, count: '8 locations', desc: 'Manage storage locations and directories.', tone: 'violet' },
  { title: 'Data Types', icon: <FileTextOutlined />, count: '15 types', desc: 'Manage data types and file formats.', tone: 'amber' },
  { title: 'Retention Rules', icon: <SafetyOutlined />, count: '6 rules', desc: 'Set data retention policies and lifecycle rules.', tone: 'red' },
];

const SUMMARY_ICONS = {
  database: <DatabaseOutlined />,
  users: <TeamOutlined />,
  storage: <HddOutlined />,
  status: <SafetyCertificateOutlined />,
};

const SUMMARY_TONES = {
  database: 'blue',
  users: 'violet',
  storage: 'cyan',
  status: 'green',
};

const trendOf = (change = '') => {
  if (change.startsWith('↑')) return 'up';
  if (change.startsWith('↓')) return 'down';
  return undefined;
};

export default function OverviewPage({ summaryCards, user }) {
  return (
    <div className="vision-page vision-stack">
      <PageHeader
        title="Overview"
        subtitle="Platform activity, storage and system health at a glance."
      />

      <section className="vision-hero">
        <div className="vision-hero-copy">
          <h2 className="vision-hero-title">VisionAI — AI Security Platform</h2>
          <div className="vision-hero-tags">
            <span>Efficient</span>
            <span className="vision-hero-dot">•</span>
            <span>Secure</span>
            <span className="vision-hero-dot">•</span>
            <span>Reliable</span>
          </div>
          <p>Monitor cameras, data and system status from a single console, and keep every record secure across its entire lifecycle.</p>
        </div>
        <div className="vision-hero-art" aria-hidden="true">
          <span className="vision-hero-orb" />
          <span className="vision-hero-ring" />
          <span className="vision-hero-bar bar-a" />
          <span className="vision-hero-bar bar-b" />
          <span className="vision-hero-bar bar-c" />
        </div>
      </section>

      <div className="vision-stat-grid vision-overview-stats">
        {summaryCards.map((card) => (
          <StatCard
            key={card.title}
            tone={SUMMARY_TONES[card.icon] || 'blue'}
            icon={SUMMARY_ICONS[card.icon]}
            label={card.title}
            value={card.value}
            trend={trendOf(card.change)}
            meta={(
              <>
                <span className="vision-stat-change">{card.change}</span>
                {' '}
                {card.meta}
              </>
            )}
          />
        ))}
      </div>

      <div className="vision-overview-split">
        <section className="vision-panel vision-panel-tight">
          <div className="vision-panel-head">
            <h3 className="vision-section-title">Recent Data</h3>
            <button type="button" className="vision-link-btn">
              View All
              <ArrowRightOutlined />
            </button>
          </div>

          <div className="vision-table-scroll">
            <table className="vision-data-table vision-static-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Size</th>
                  <th>Created At</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {recentData.map((row) => (
                  <tr key={row.id}>
                    <td className="vision-cell-muted">{row.id}</td>
                    <td>
                      <div className="vision-file-cell">
                        <span className="vision-file-icon"><FileTextOutlined /></span>
                        <span className="vision-file-name">{row.name}</span>
                      </div>
                    </td>
                    <td><span className="vision-badge is-grey">{row.category}</span></td>
                    <td className="vision-cell-muted">{row.size}</td>
                    <td className="vision-cell-muted">{row.createdAt}</td>
                    <td className="col-actions">
                      {/* Not a button: this demo row has no action wired to it. */}
                      <span className="vision-cell-muted" aria-hidden="true"><MoreOutlined /></span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="vision-panel vision-panel-tight">
          <div className="vision-panel-head">
            <h3 className="vision-section-title">Storage Usage</h3>
            <button type="button" className="vision-link-btn">
              View Details
              <ArrowRightOutlined />
            </button>
          </div>

          <div className="vision-donut-wrap">
            <div className="vision-donut" style={{ '--donut-value': '24%' }}>
              <div className="vision-donut-inner">
                <span>24%</span>
              </div>
            </div>
            <ul className="vision-legend">
              <li><span className="vision-legend-dot is-used" />Used Space<strong>2.4 TB</strong></li>
              <li><span className="vision-legend-dot is-free" />Free Space<strong>7.6 TB</strong></li>
              <li><span className="vision-legend-dot is-total" />Total Space<strong>10 TB</strong></li>
            </ul>
          </div>
        </section>
      </div>

      <section className="vision-panel">
        <div className="vision-panel-head">
          <div className="vision-panel-head-title">
            <span className="vision-panel-icon"><SettingOutlined /></span>
            <h3 className="vision-section-title">Basic Data</h3>
          </div>
          <Button type="primary" className="vision-btn-primary" icon={<PlusOutlined />}>
            Add Category
          </Button>
        </div>

        <div className="vision-basic-grid">
          {basicCards.map((card) => (
            <article key={card.title} className={`vision-basic-card tone-${card.tone}`}>
              <span className="vision-basic-icon">{card.icon}</span>
              <h4 className="vision-basic-title">{card.title}</h4>
              <p className="vision-basic-desc">{card.desc}</p>
              <span className="vision-badge is-grey">{card.count}</span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
