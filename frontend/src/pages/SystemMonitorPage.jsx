import { Card, Col, Descriptions, Row, Space, Tag, Typography } from 'antd';

const { Text } = Typography;

export default function SystemMonitorDashboard({ systemStatus, records, users, categories }) {
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

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <div className="task-manager-panel">
        <div className="task-manager-header">
          <div>
            <Text className="task-manager-title">Performance</Text>
          </div>
          <Tag color={systemStatus.api === 'online' ? 'green' : 'red'} className="task-manager-live-tag">
            {systemStatus.api === 'online' ? 'Live' : 'Offline'}
          </Tag>
        </div>

        <div className="task-manager-summary-grid">
          <div className="task-manager-stat-card cpu-card">
            <div className="task-manager-stat-top">
              <span>CPU</span>
              <strong>{Math.round(systemStatus.cpuPercent || 0)}%</strong>
            </div>
            <div className="task-progress-track">
              <span className="task-progress-fill cpu-fill" style={{ width: `${Math.min(100, Math.max(0, systemStatus.cpuPercent || 0))}%` }} />
            </div>
            <small>{systemStatus.cpu || 'N/A'} logical processors</small>
          </div>

          <div className="task-manager-stat-card memory-card">
            <div className="task-manager-stat-top">
              <span>Memory</span>
              <strong>{Math.round(systemStatus.memoryPercent || 0)}%</strong>
            </div>
            <div className="task-progress-track">
              <span className="task-progress-fill memory-fill" style={{ width: `${Math.min(100, Math.max(0, systemStatus.memoryPercent || 0))}%` }} />
            </div>
            <small>{systemStatus.memory || 'N/A'}</small>
          </div>

          <div className="task-manager-stat-card health-card">
            <div className="task-manager-stat-top">
              <span>API</span>
              <strong>{systemStatus.api}</strong>
            </div>
            <div className="task-progress-track small-track">
              <span className={`task-progress-fill ${systemStatus.api === 'online' ? 'healthy-fill' : 'warning-fill'}`} style={{ width: systemStatus.api === 'online' ? '100%' : '45%' }} />
            </div>
            <small>Last check: {systemStatus.lastUpdated}</small>
          </div>

          <div className="task-manager-stat-card uptime-card">
            <div className="task-manager-stat-top">
              <span>Runtime</span>
              <strong>{systemStatus.lastUpdated}</strong>
            </div>
            <div className="task-progress-track small-track">
              <span className="task-progress-fill neutral-fill" style={{ width: '72%' }} />
            </div>
            <small>Refresh every 3 sec</small>
          </div>

          <div className="task-manager-stat-card network-card">
            <div className="task-manager-stat-top">
              <span>Network</span>
              <strong>--</strong>
            </div>
            <div className="task-progress-track">
              <span className="task-progress-fill network-fill" style={{ width: '35%' }} />
            </div>
            <small>Network usage</small>
          </div>
        </div>

        <Row gutter={16} className="performance-graphs-row">
          <Col span={8} className="graph-column">
            <Card className="task-manager-card dark-card" title="Memory Usage" extra={<Tag color="blue">{Math.round(systemStatus.memoryPercent || 0)}%</Tag>}>
              <div className="task-graph-card performance-card">
                <div className="task-graph-header">
                  <Text type="secondary">Used</Text>
                  <Text strong>{systemStatus.memory || 'N/A'}</Text>
                </div>
                <div className="performance-metric">
                  <span className="performance-value">{Math.round(systemStatus.memoryPercent || 0)}%</span>
                  <span className="performance-subvalue">of browser heap</span>
                </div>
                <svg viewBox="0 0 320 120" className="task-graph-svg" role="img" aria-label="Memory usage graph">
                  <g className="task-grid-lines">
                    <line x1="10" y1="20" x2="310" y2="20" />
                    <line x1="10" y1="50" x2="310" y2="50" />
                    <line x1="10" y1="80" x2="310" y2="80" />
                  </g>
                  <line x1="10" y1="96" x2="310" y2="96" className="task-graph-axis" />
                  <polyline
                    className="task-graph-line memory"
                    points={buildChartPoints(graphHistory.map((item) => item.memory))}
                  />
                  {buildTimeTicks(graphHistory).map((tick) => (
                    <text key={`${tick.label}-${tick.position}`} x={12 + (tick.position / 100) * 296} y="115" textAnchor="middle" className="task-graph-label">
                      {tick.label}
                    </text>
                  ))}
                </svg>
              </div>
            </Card>
          </Col>
          <Col span={8} className="graph-column">
            <Card className="task-manager-card dark-card" title="CPU Load" extra={<Tag color="green">{Math.round(systemStatus.cpuPercent || 0)}%</Tag>}>
              <div className="task-graph-card performance-card">
                <div className="task-graph-header">
                  <Text type="secondary">Load</Text>
                  <Text strong>{Math.round(systemStatus.cpuPercent || 0)}% / {systemStatus.cpu || 'N/A'} cores</Text>
                </div>
                <div className="performance-metric">
                  <span className="performance-value">{Math.round(systemStatus.cpuPercent || 0)}%</span>
                  <span className="performance-subvalue">processor load</span>
                </div>
                <svg viewBox="0 0 320 120" className="task-graph-svg" role="img" aria-label="CPU usage graph">
                  <g className="task-grid-lines">
                    <line x1="10" y1="20" x2="310" y2="20" />
                    <line x1="10" y1="50" x2="310" y2="50" />
                    <line x1="10" y1="80" x2="310" y2="80" />
                  </g>
                  <line x1="10" y1="96" x2="310" y2="96" className="task-graph-axis" />
                  <polyline
                    className="task-graph-line cpu"
                    points={buildChartPoints(graphHistory.map((item) => item.cpu))}
                  />
                  {buildTimeTicks(graphHistory).map((tick) => (
                    <text key={`${tick.label}-${tick.position}-cpu`} x={12 + (tick.position / 100) * 296} y="115" textAnchor="middle" className="task-graph-label">
                      {tick.label}
                    </text>
                  ))}
                </svg>
              </div>
            </Card>
          </Col>
          <Col span={8} className="graph-column">
            <Card className="task-manager-card dark-card" title="Network Usage" extra={<Tag color="cyan">--</Tag>}>
              <div className="task-graph-card performance-card">
                <div className="task-graph-header">
                  <Text type="secondary">Total</Text>
                  <Text strong>-- MB/s</Text>
                </div>
                <div className="performance-metric">
                  <span className="performance-value">--</span>
                  <span className="performance-subvalue">network bandwidth</span>
                </div>
                <svg viewBox="0 0 320 120" className="task-graph-svg" role="img" aria-label="Network usage graph">
                  <g className="task-grid-lines">
                    <line x1="10" y1="20" x2="310" y2="20" />
                    <line x1="10" y1="50" x2="310" y2="50" />
                    <line x1="10" y1="80" x2="310" y2="80" />
                  </g>
                  <line x1="10" y1="96" x2="310" y2="96" className="task-graph-axis" />
                  <polyline
                    className="task-graph-line network"
                    points={buildChartPoints(graphHistory.map((item) => (item.network || 0)))}
                  />
                  {buildTimeTicks(graphHistory).map((tick) => (
                    <text key={`${tick.label}-${tick.position}-network`} x={12 + (tick.position / 100) * 296} y="115" textAnchor="middle" className="task-graph-label">
                      {tick.label}
                    </text>
                  ))}
                </svg>
              </div>
            </Card>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={8}>
            <Card title="Database Summary" className="task-manager-card dark-card">
              <Descriptions column={1} bordered className="monitor-description">
                <Descriptions.Item label="Users">{users.length}</Descriptions.Item>
                <Descriptions.Item label="Records">{records.length}</Descriptions.Item>
                <Descriptions.Item label="Categories">{categories.length}</Descriptions.Item>
              </Descriptions>
            </Card>
          </Col>
          <Col span={8}>
            <Card title="Runtime Info" className="task-manager-card dark-card">
              <Descriptions column={1} bordered className="monitor-description">
                <Descriptions.Item label="Browser">{navigator.userAgent.split(')')[0].split('(')[1] || 'Browser'}</Descriptions.Item>
                <Descriptions.Item label="Platform">{navigator.platform || 'Unknown'}</Descriptions.Item>
                <Descriptions.Item label="Language">{navigator.language || 'en-US'}</Descriptions.Item>
              </Descriptions>
            </Card>
          </Col>
          <Col span={8}>
            <Card title="Health Notes" className="task-manager-card dark-card">
              <div className="monitor-note">
                <Tag color={systemStatus.api === 'online' ? 'green' : 'red'}>{systemStatus.api === 'online' ? 'Healthy' : 'Degraded'}</Tag>
                <p>Frontend is connected to the app and the last backend health check was captured successfully.</p>
                <p>Refresh interval: every 3 seconds.</p>
              </div>
            </Card>
          </Col>
        </Row>
      </div>
    </Space>
  );
}
