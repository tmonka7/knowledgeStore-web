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
import MetricChart from '../components/ui/MetricChart';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import StatusBadge from '../components/ui/StatusBadge';

/** A rounded top for the latency axis, so it reads 200 ms rather than 187 ms. */
const niceCeiling = (value, floor) => {
  const target = Math.max(value, floor);
  const magnitude = 10 ** Math.floor(Math.log10(target));
  return Math.ceil(target / magnitude) * magnitude;
};

const percent = (value) => `${Math.round(value)}%`;
const milliseconds = (value) => `${Math.round(value)} ms`;

export default function SystemMonitorDashboard({ systemStatus, records, users, categories }) {
  const history = systemStatus.history || [];

  const isOnline = systemStatus.api === 'online';
  const cpuPercent = Math.round(systemStatus.cpuPercent || 0);
  const memoryPercent = Math.round(systemStatus.memoryPercent || 0);
  const latency = systemStatus.latency;

  const seriesOf = (key) => history
    .filter((sample) => Number.isFinite(sample[key]))
    .map((sample) => ({ time: sample.time, value: sample[key] }));

  const latencySeries = seriesOf('latency');
  const latencyCeiling = niceCeiling(Math.max(0, ...latencySeries.map((sample) => sample.value)), 50);

  return (
    <div className="vision-page vision-stack">
      <PageHeader
        title="System Monitoring"
        subtitle="Live performance, database totals and runtime health."
        actions={(
          <StatusBadge tone={isOnline ? 'green' : 'red'} dot>
            {isOnline ? 'Live' : 'Offline'}
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
          label="Latency"
          value={Number.isFinite(latency) ? `${latency} ms` : '—'}
          meta="Round trip to /api/health"
        />
      </div>

      <div className="vision-monitor-graphs">
        <section className="vision-panel vision-panel-tight">
          <div className="vision-panel-head">
            <h3 className="vision-section-title">Memory Usage</h3>
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
          <MetricChart
            series={seriesOf('memory')}
            color="var(--v-secondary)"
            formatValue={percent}
            ariaLabel="Memory usage over time, as a percentage of the browser heap"
          />
        </section>

        <section className="vision-panel vision-panel-tight">
          <div className="vision-panel-head">
            <h3 className="vision-section-title">CPU Load</h3>
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
          <MetricChart
            series={seriesOf('cpu')}
            color="var(--v-primary)"
            formatValue={percent}
            ariaLabel="Processor load over time, as a percentage"
          />
        </section>

        <section className="vision-panel vision-panel-tight">
          <div className="vision-panel-head">
            <h3 className="vision-section-title">API Latency</h3>
            <StatusBadge tone={isOnline ? 'cyan' : 'red'}>
              {Number.isFinite(latency) ? `${latency} ms` : 'No reply'}
            </StatusBadge>
          </div>
          <div className="vision-graph-head">
            <span className="vision-cell-muted">Round trip</span>
            <strong>{Number.isFinite(latency) ? `${latency} ms` : 'unreachable'}</strong>
          </div>
          <div className="vision-graph-metric">
            <span className="vision-graph-value">{Number.isFinite(latency) ? latency : '—'}</span>
            <span className="vision-cell-muted">ms to /api/health</span>
          </div>
          {/* Latency has no natural ceiling, so the axis follows the window's
              own peak instead of a fixed 100. */}
          <MetricChart
            series={latencySeries}
            color="var(--v-cyan)"
            max={latencyCeiling}
            formatValue={milliseconds}
            ariaLabel="Round-trip time of the health check, in milliseconds"
            emptyLabel="No successful health check yet"
          />
        </section>
      </div>

      <div className="vision-monitor-info">
        <section className="vision-panel vision-panel-tight">
          <div className="vision-panel-head">
            <div className="vision-panel-head-title">
              <span className="vision-panel-icon"><DatabaseOutlined /></span>
              <h3 className="vision-section-title">Database Summary</h3>
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
              <h3 className="vision-section-title">Runtime Info</h3>
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
              <h3 className="vision-section-title">Health Notes</h3>
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
