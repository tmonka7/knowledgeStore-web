import { Card, Col, Row, Space, Tag, Typography } from 'antd';

const { Title, Text } = Typography;

const recentData = [
  { id: 'DS-0001', name: 'Project Plan', category: 'Documents', size: '2.5 MB', createdAt: '2025-09-17 09:32', action: '⋮' },
  { id: 'DS-0002', name: 'Customer List', category: 'Customers', size: '1.2 MB', createdAt: '2025-09-17 08:45', action: '⋮' },
  { id: 'DS-0003', name: 'Product Image', category: 'Images', size: '5.6 MB', createdAt: '2025-09-16 16:20', action: '⋮' },
  { id: 'DS-0004', name: 'System Log', category: 'Logs', size: '842 KB', createdAt: '2025-09-16 14:12', action: '⋮' },
  { id: 'DS-0005', name: 'Report Q3', category: 'Reports', size: '3.1 MB', createdAt: '2025-09-16 11:03', action: '⋮' },
];

const basicCards = [
  { title: 'Categories', icon: '📁', count: '12 categories', desc: 'Manage data categories and classification rules.', tone: 'blue' },
  { title: 'Tags', icon: '🏷️', count: '36 tags', desc: 'Manage tags for better data organization.', tone: 'green' },
  { title: 'Storage Locations', icon: '📍', count: '8 locations', desc: 'Manage storage locations and directories.', tone: 'purple' },
  { title: 'Data Types', icon: '📄', count: '15 types', desc: 'Manage data types and file formats.', tone: 'orange' },
  { title: 'Retention Rules', icon: '🛡️', count: '6 rules', desc: 'Set data retention policies and lifecycle rules.', tone: 'red' },
];

export default function OverviewPage({ summaryCards, user }) {
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <div className="overview-hero">
        <div className="overview-hero-copy">
          <Title level={2} className="overview-hero-title">Data Storage Management System</Title>
          <div className="overview-hero-subtitle">
            <span>Efficient</span>
            <span className="dot-separator">•</span>
            <span>Secure</span>
            <span className="dot-separator">•</span>
            <span>Reliable</span>
          </div>
          <p>Manage your data resources, monitor system status, and ensure data security across the entire lifecycle.</p>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="hero-cloud" />
          <div className="hero-disk" />
          <div className="hero-block block-a" />
          <div className="hero-block block-b" />
          <div className="hero-block block-c" />
        </div>
      </div>

      <Row gutter={16} className="overview-stat-grid">
        {summaryCards.map((card) => (
          <Col span={6} key={card.title}>
            <div className="summary-card">
              <div className="summary-card-icon" style={{ background: card.accent, color: card.color }}>
                {card.icon === 'database' && '🗄️'}
                {card.icon === 'users' && '👥'}
                {card.icon === 'storage' && '💾'}
                {card.icon === 'status' && '⚠️'}
              </div>
              <div className="summary-card-content">
                <div className="summary-card-title">{card.title}</div>
                <div className="summary-card-value">{card.value}</div>
                <div className="summary-card-meta">
                  <span className="summary-card-change">{card.change}</span>
                  <span>{card.meta}</span>
                </div>
              </div>
            </div>
          </Col>
        ))}
      </Row>

      <div className="content-split">
        <div className="data-section">
          <div className="section-header">
            <h3>Recent Data</h3>
            <button type="button" className="view-all-link">View All →</button>
          </div>
          <div className="recent-table-wrap">
            <table className="recent-table">
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
                    <td>{row.id}</td>
                    <td>{row.name}</td>
                    <td>{row.category}</td>
                    <td>{row.size}</td>
                    <td>{row.createdAt}</td>
                    <td>{row.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="storage-panel">
          <div className="section-header">
            <h3>Storage Usage</h3>
            <button type="button" className="view-all-link">View Details →</button>
          </div>
          <div className="donut-wrap">
            <div className="donut-chart">
              <div className="donut-inner">
                <span>24%</span>
              </div>
            </div>
            <div className="legend-list">
              <div className="legend-item"><span className="legend-dot used" /> Used Space <strong>2.4 TB</strong></div>
              <div className="legend-item"><span className="legend-dot free" /> Free Space <strong>7.6 TB</strong></div>
              <div className="legend-item"><span className="legend-dot total" /> Total Space <strong>10 TB</strong></div>
            </div>
          </div>
        </div>
      </div>

      <div className="basic-data-card">
        <div className="basic-data-header">
          <div className="basic-data-title-wrap">
            <div className="basic-data-icon">⚙️</div>
            <h3>Basic Data</h3>
          </div>
          <button type="button" className="add-category-btn">+ Add Category</button>
        </div>

        <div className="basic-card-grid">
          {basicCards.map((card) => (
            <div key={card.title} className={`mini-card tone-${card.tone}`}>
              <div className="mini-card-icon">{card.icon}</div>
              <div className="mini-card-label">{card.title}</div>
              <div className="mini-card-desc">{card.desc}</div>
              <div className="mini-card-count">{card.count}</div>
            </div>
          ))}
        </div>
      </div>
    </Space>
  );
}
