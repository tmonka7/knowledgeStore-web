import {
  ApiOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  DesktopOutlined,
  HeartOutlined,
  PieChartOutlined,
  ThunderboltOutlined,
  WifiOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import StatusBadge from '../components/ui/StatusBadge';
import { useLanguage } from '../i18n';

export default function SystemMonitorDashboard({ systemStatus, records, users, categories }) {
  const { t } = useLanguage();
  const graphHistory = systemStatus.history && systemStatus.history.length ? systemStatus.history : [
    { time: 'now', memory: 0, cpu: 0 },
  ];

  const buildChartPoints = (values = [], width = 320, height = 120) => {
    if (!values.length) return '';
    const min = 0;
    const max = 100;

    return values.map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const y = height - ((value - min) / Math.max(1, max - min)) * (height - 12) - 6;
      return `${x},${y}`;
    }).join(' ');
  };

  const buildTimeTicks = (items = []) => {
    if (!items.length) return [];
    return items.map((item, index) => {
      const position = items.length === 1 ? 50 : (index / Math.max(1, items.length - 1)) * 100;
      return { label: item.time || `T${index + 1}`, position };
    });
  };

  const isOnline = systemStatus.api === 'online';
  const cpuPercent = Math.round(systemStatus.cpuPercent || 0);
  const memoryPercent = Math.round(systemStatus.memoryPercent || 0);

  return (
    <div className="vision-page vision-stack">
      <PageHeader
        title={t('systemMonitoring')}
        subtitle={t('systemMonitoringSubtitle')}
        actions={(
          <StatusBadge tone={isOnline ? 'green' : 'red'} dot>
            {isOnline ? t('live') : t('offline')}
          </StatusBadge>
        )}
      />

      <div className="vision-stat-grid cols-5 vision-monitor-stats">
        <StatCard
          tone="blue"
          icon={<ThunderboltOutlined />}
          label="CPU"
          value={`${cpuPercent}%`}
          meta={`${systemStatus.cpu || 'N/A'} logical processors`}
        />
        <StatCard
          tone="violet"
          icon={<PieChartOutlined />}
          label="Memory"
          value={`${memoryPercent}%`}
          meta={systemStatus.memory || 'N/A'}
        />
        <StatCard
          tone={isOnline ? 'green' : 'red'}
          icon={<ApiOutlined />}
          label="API"
          value={systemStatus.api}
          meta={`Last check: ${systemStatus.lastUpdated}`}
        />
        <StatCard
          tone="cyan"
          icon={<ClockCircleOutlined />}
          label="Runtime"
          value={systemStatus.lastUpdated}
          meta="Refresh every 3 sec"
        />
        <StatCard
          tone="amber"
          icon={<WifiOutlined />}
          label="Network"
          value="--"
          meta="Network usage"
        />
      </div>

      <div className="vision-monitor-graphs">
        <section className="vision-panel vision-panel-tight">
          <div className="vision-panel-head">
            <h3 className="vision-section-title">{t('memoryUsage')}</h3>
            <StatusBadge tone="violet">{memoryPercent}%</StatusBadge>
          </div>
          <div className="vision-graph-head">
            <span className="vision-cell-muted">Used</span>
            <strong>{systemStatus.memory || 'N/A'}</strong>
          </div>
          <div className="vision-graph-metric">
            <span className="vision-graph-value">{memoryPercent}%</span>
            <span className="vision-cell-muted">of browser heap</span>
          </div>
          <svg viewBox="0 0 320 120" className="vision-graph-svg" role="img" aria-label={t('memoryUsageGraph')}>
            <g className="vision-graph-grid">
              <line x1="10" y1="20" x2="310" y2="20" />
              <line x1="10" y1="50" x2="310" y2="50" />
              <line x1="10" y1="80" x2="310" y2="80" />
            </g>
            <line x1="10" y1="96" x2="310" y2="96" className="vision-graph-axis" />
            <polyline
              className="vision-graph-line is-memory"
              points={buildChartPoints(graphHistory.map((item) => item.memory))}
            />
            {buildTimeTicks(graphHistory).map((tick) => (
              <text key={`${tick.label}-${tick.position}`} x={12 + (tick.position / 100) * 296} y="115" textAnchor="middle" className="vision-graph-label">
                {tick.label}
              </text>
            ))}
          </svg>
        </section>

        <section className="vision-panel vision-panel-tight">
          <div className="vision-panel-head">
            <h3 className="vision-section-title">{t('cpuLoad')}</h3>
            <StatusBadge tone="blue">{cpuPercent}%</StatusBadge>
          </div>
          <div className="vision-graph-head">
            <span className="vision-cell-muted">Load</span>
            <strong>{cpuPercent}% / {systemStatus.cpu || 'N/A'} cores</strong>
          </div>
          <div className="vision-graph-metric">
            <span className="vision-graph-value">{cpuPercent}%</span>
            <span className="vision-cell-muted">processor load</span>
          </div>
          <svg viewBox="0 0 320 120" className="vision-graph-svg" role="img" aria-label={t('cpuUsageGraph')}>
            <g className="vision-graph-grid">
              <line x1="10" y1="20" x2="310" y2="20" />
              <line x1="10" y1="50" x2="310" y2="50" />
              <line x1="10" y1="80" x2="310" y2="80" />
            </g>
            <line x1="10" y1="96" x2="310" y2="96" className="vision-graph-axis" />
            <polyline
              className="vision-graph-line is-cpu"
              points={buildChartPoints(graphHistory.map((item) => item.cpu))}
            />
            {buildTimeTicks(graphHistory).map((tick) => (
              <text key={`${tick.label}-${tick.position}-cpu`} x={12 + (tick.position / 100) * 296} y="115" textAnchor="middle" className="vision-graph-label">
                {tick.label}
              </text>
            ))}
          </svg>
        </section>

        <section className="vision-panel vision-panel-tight">
          <div className="vision-panel-head">
            <h3 className="vision-section-title">{t('networkUsageTitle')}</h3>
            <StatusBadge tone="cyan">--</StatusBadge>
          </div>
          <div className="vision-graph-head">
            <span className="vision-cell-muted">Total</span>
            <strong>-- MB/s</strong>
          </div>
          <div className="vision-graph-metric">
            <span className="vision-graph-value">--</span>
            <span className="vision-cell-muted">network bandwidth</span>
          </div>
          <svg viewBox="0 0 320 120" className="vision-graph-svg" role="img" aria-label={t('networkUsageGraph')}>
            <g className="vision-graph-grid">
              <line x1="10" y1="20" x2="310" y2="20" />
              <line x1="10" y1="50" x2="310" y2="50" />
              <line x1="10" y1="80" x2="310" y2="80" />
            </g>
            <line x1="10" y1="96" x2="310" y2="96" className="vision-graph-axis" />
            <polyline
              className="vision-graph-line is-network"
              points={buildChartPoints(graphHistory.map((item) => (item.network || 0)))}
            />
            {buildTimeTicks(graphHistory).map((tick) => (
              <text key={`${tick.label}-${tick.position}-network`} x={12 + (tick.position / 100) * 296} y="115" textAnchor="middle" className="vision-graph-label">
                {tick.label}
              </text>
            ))}
          </svg>
        </section>
      </div>

      <div className="vision-monitor-info">
        <section className="vision-panel vision-panel-tight">
          <div className="vision-panel-head">
            <div className="vision-panel-head-title">
              <span className="vision-panel-icon"><DatabaseOutlined /></span>
              <h3 className="vision-section-title">{t('databaseSummary')}</h3>
            </div>
          </div>
          <ul className="vision-facts">
            <li><span>Users</span><strong>{users.length}</strong></li>
            <li><span>Records</span><strong>{records.length}</strong></li>
            <li><span>Categories</span><strong>{categories.length}</strong></li>
          </ul>
        </section>

        <section className="vision-panel vision-panel-tight">
          <div className="vision-panel-head">
            <div className="vision-panel-head-title">
              <span className="vision-panel-icon"><DesktopOutlined /></span>
              <h3 className="vision-section-title">{t('runtimeInfo')}</h3>
            </div>
          </div>
          <ul className="vision-facts">
            <li><span>Browser</span><strong>{navigator.userAgent.split(')')[0].split('(')[1] || 'Browser'}</strong></li>
            <li><span>Platform</span><strong>{navigator.platform || 'Unknown'}</strong></li>
            <li><span>Language</span><strong>{navigator.language || 'en-US'}</strong></li>
          </ul>
        </section>

        <section className="vision-panel vision-panel-tight">
          <div className="vision-panel-head">
            <div className="vision-panel-head-title">
              <span className="vision-panel-icon"><HeartOutlined /></span>
              <h3 className="vision-section-title">{t('healthNotes')}</h3>
            </div>
            <StatusBadge tone={isOnline ? 'green' : 'red'} dot>
              {isOnline ? 'Healthy' : 'Degraded'}
            </StatusBadge>
          </div>
          <p className="vision-monitor-note">Frontend is connected to the app and the last backend health check was captured successfully.</p>
          <p className="vision-monitor-note">Refresh interval: every 3 seconds.</p>
        </section>
      </div>
    </div>
  );
}
