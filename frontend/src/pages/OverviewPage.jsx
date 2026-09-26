import { useEffect, useMemo, useState } from 'react';
import { Empty, Tooltip } from 'antd';
import {
  ApiOutlined,
  ArrowRightOutlined,
  CalendarOutlined,
  CameraOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  FolderOutlined,
  MailOutlined,
  MessageOutlined,
  ProjectOutlined,
  SafetyCertificateOutlined,
  SwapOutlined,
  TeamOutlined,
  ToolOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import StatusBadge from '../components/ui/StatusBadge';
import { roundedTopBar } from '../components/ui/chartShapes';
import api from '../api';
import { can } from '../permissions';
import { localDateKey } from '../components/schedule/useScheduleReminders';
import { useLanguage } from '../i18n';

const RECENT_LIMIT = 6;
const TOP_CATEGORIES = 6;
const SCHEDULE_WINDOW_DAYS = 30;

/** Categories arrive as a tree; every level counts. */
const countCategories = (nodes = []) => nodes.reduce(
  (total, node) => total + 1 + countCategories(node.children || []),
  0,
);

const daysAgo = (count) => {
  const date = new Date();
  date.setDate(date.getDate() - count);
  return date;
};

const formatDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' });
};

/**
 * Records created per month over the last six months.
 *
 * One series, one hue — this is magnitude over time, not identity, so there is
 * nothing to tell apart by colour and no legend to carry.
 */
function MonthlyRecordsChart({ data }) {
  const width = 320;
  const height = 120;
  const baseline = 96;
  const top = 18;
  const peak = Math.max(1, ...data.map((item) => item.value));
  const slot = (width - 20) / Math.max(1, data.length);
  const barWidth = Math.max(8, slot - 10);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="vision-graph-svg"
      role="img"
      aria-label={`Records added per month: ${data.map((item) => `${item.label} ${item.value}`).join(', ')}`}
    >
      <g className="vision-graph-grid">
        <line x1="10" y1="20" x2="310" y2="20" />
        <line x1="10" y1="58" x2="310" y2="58" />
      </g>
      <line x1="10" y1={baseline} x2="310" y2={baseline} className="vision-graph-axis" />

      {data.map((item, index) => {
        const barHeight = item.value === 0 ? 0 : ((item.value / peak) * (baseline - top));
        const x = 10 + index * slot + (slot - barWidth) / 2;
        const y = baseline - barHeight;

        return (
          <g key={item.label}>
            {barHeight > 0 && (
              <path d={roundedTopBar(x, y, barWidth, barHeight, 4)} className="vision-bar" />
            )}
            {/* Native tooltip: no JS, and it reaches keyboard and screen readers. */}
            <title>{`${item.label}: ${item.value} record${item.value === 1 ? '' : 's'}`}</title>
            <text x={x + barWidth / 2} y={y - 5} textAnchor="middle" className="vision-bar-value">
              {item.value || ''}
            </text>
            <text x={x + barWidth / 2} y={113} textAnchor="middle" className="vision-graph-label">
              {item.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Ranked magnitude, so a single hue and direct values rather than a palette. */
function CategoryBars({ rows, total }) {
  if (!rows.length) {
    return <Empty description="No records yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <ul className="vision-rank-list">
      {rows.map((row) => {
        const share = total ? Math.round((row.value / total) * 100) : 0;
        return (
          <li key={row.label}>
            <Tooltip title={`${row.value} of ${total} records (${share}%)`}>
              <div className="vision-rank-row">
                <span className="vision-rank-label" title={row.label}>{row.label}</span>
                <span className="vision-rank-track">
                  <span className="vision-rank-fill" style={{ width: `${Math.max(2, share)}%` }} />
                </span>
                <span className="vision-rank-value">{row.value}</span>
              </div>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

export default function OverviewPage({
  user,
  users = [],
  records = [],
  categories = [],
  cameras = [],
  systemStatus = {},
  overviewChartData = [],
  onNavigate,
}) {
  const { t } = useLanguage();
  const [schedule, setSchedule] = useState([]);

  const canSeeSchedule = can(user, 'schedule');

  // The only figure on this page that is not already in App state.
  useEffect(() => {
    if (!canSeeSchedule) return undefined;

    let cancelled = false;
    const from = localDateKey();
    const to = localDateKey(new Date(Date.now() + SCHEDULE_WINDOW_DAYS * 86400000));

    api.get('/schedules', { params: { from, to } })
      .then(({ data }) => { if (!cancelled) setSchedule(data.occurrences || []); })
      .catch(() => { /* The rest of the page is still worth showing. */ });

    return () => { cancelled = true; };
  }, [canSeeSchedule]);

  const stats = useMemo(() => {
    const monthStart = daysAgo(30);
    const recentRecords = records.filter((record) => new Date(record.createdAt) >= monthStart).length;
    const admins = users.filter((item) => item.role === 'admin').length;

    const cameraStatus = cameras.reduce((counts, camera) => {
      const key = ['online', 'offline', 'maintenance'].includes(camera.status) ? camera.status : 'offline';
      counts[key] += 1;
      return counts;
    }, { online: 0, offline: 0, maintenance: 0 });

    return { recentRecords, admins, cameraStatus };
  }, [records, users, cameras]);

  const topCategories = useMemo(() => {
    const counts = new Map();
    for (const record of records) {
      const label = record.category || 'Uncategorised';
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, TOP_CATEGORIES);
  }, [records]);

  const recentRecords = useMemo(
    () => [...records]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, RECENT_LIMIT),
    [records],
  );

  /**
   * Every module in the project, with its real count where one exists.
   *
   * `status` is honest rather than flattering: the YOLO page is still a
   * shell, and saying so here is more useful than a count that implies it
   * does something.
   */
  const components = useMemo(() => [
    {
      key: 'records',
      icon: <DatabaseOutlined />,
      title: t('data'),
      tone: 'blue',
      detail: t('totalRecords', { count: records.length }),
      status: 'ready',
    },
    {
      key: 'categories',
      icon: <FolderOutlined />,
      title: t('category'),
      tone: 'violet',
      detail: `${countCategories(categories)} ${t('itemsCount', { count: countCategories(categories) })}`,
      status: 'ready',
    },
    {
      key: 'cameras',
      icon: <CameraOutlined />,
      title: t('cameraManagement'),
      tone: 'cyan',
      detail: `${cameras.length} ${t('cameraManagement')} · ${stats.cameraStatus.online} ${t('online')}`,
      status: 'ready',
    },
    {
      key: 'schedule',
      icon: <CalendarOutlined />,
      title: t('schedule'),
      tone: 'green',
      detail: `${schedule.length} ${t('schedule')}`,
      status: 'ready',
    },
    {
      key: 'lvgl-tool',
      icon: <ToolOutlined />,
      title: 'LVGL',
      tone: 'amber',
      detail: t('toolsLvgl'),
      status: 'ready',
    },
    {
      key: 'convert-tool',
      icon: <SwapOutlined />,
      title: t('toolsConverting'),
      tone: 'amber',
      detail: t('convertingSubtitle'),
      status: 'ready',
    },
    {
      key: 'yolo',
      icon: <ToolOutlined />,
      title: 'YOLO',
      tone: 'red',
      detail: t('yoloUtility'),
      status: 'planned',
    },
    {
      key: 'transformers',
      icon: <ToolOutlined />,
      title: 'Transformers',
      tone: 'red',
      detail: t('transformersUtility'),
      status: 'ready',
    },
    {
      key: 'chat',
      icon: <MessageOutlined />,
      title: t('chat'),
      tone: 'blue',
      detail: t('chatSubtitle'),
      status: 'ready',
    },
    {
      key: 'mail',
      icon: <MailOutlined />,
      title: t('mail'),
      tone: 'violet',
      detail: t('mailSubtitle'),
      status: 'ready',
    },
    {
      key: 'projects',
      icon: <ProjectOutlined />,
      title: t('projectManagement'),
      tone: 'violet',
      detail: t('projectManagement'),
      status: 'ready',
    },
    {
      // My Page is your own account, so it needs no permission to reach —
      // the wallet and contacts tabs inside it still check theirs.
      key: 'my-page',
      always: true,
      icon: <WalletOutlined />,
      title: t('myPage'),
      tone: 'green',
      detail: t('myPage'),
      status: 'ready',
    },
    {
      key: 'database',
      icon: <CloudServerOutlined />,
      title: t('databaseManagement'),
      tone: 'blue',
      detail: t('databaseManagement'),
      status: 'ready',
    },
    {
      key: 'users',
      icon: <TeamOutlined />,
      title: t('users'),
      tone: 'cyan',
      detail: `${users.length} ${t('users')} · ${stats.admins} ${t('administrators')}`,
      status: 'ready',
    },
    {
      key: 'system-monitor',
      icon: <ApiOutlined />,
      title: t('systemMonitoring'),
      tone: 'green',
      detail: `API ${systemStatus.api || 'unknown'}`,
      status: 'ready',
    },
  // Only modules this account can actually open.
  ].filter((item) => item.always || can(user, item.key)), [records, categories, cameras, schedule, users, systemStatus, stats, user, t]);

  const apiOnline = systemStatus.api === 'online';

  return (
    <div className="vision-page vision-stack">
      <PageHeader
        title={t('overview')}
        subtitle={t('overviewSubtitle', { suffix: user?.fullName ? ` - ${user.fullName}` : '' })}
      />

      <section className="vision-hero">
        <div className="vision-hero-copy">
          <h2 className="vision-hero-title">{t('aiSecurityPlatform')}</h2>
          <div className="vision-hero-tags">
            <span>{t('efficient')}</span>
            <span className="vision-hero-dot">•</span>
            <span>{t('secure')}</span>
            <span className="vision-hero-dot">•</span>
            <span>{t('reliable')}</span>
          </div>
          <p>{t('overviewHeroDescription')}</p>
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
        <StatCard
          tone="blue"
          icon={<DatabaseOutlined />}
          label={t('records')}
          value={records.length}
          trend={stats.recentRecords > 0 ? 'up' : undefined}
          meta={`${stats.recentRecords} added in the last 30 days`}
        />
        <StatCard
          tone="violet"
          icon={<TeamOutlined />}
          label={t('users')}
          value={users.length}
          meta={`${stats.admins} administrator${stats.admins === 1 ? '' : 's'}`}
        />
        <StatCard
          tone="cyan"
          icon={<CameraOutlined />}
          label={t('cameras')}
          value={cameras.length}
          meta={`${stats.cameraStatus.online} online · ${stats.cameraStatus.offline} offline`}
        />
        <StatCard
          tone={apiOnline ? 'green' : 'red'}
          icon={<SafetyCertificateOutlined />}
          label={t('system')}
          value={apiOnline ? t('healthy') : t('unreachable')}
          meta={`Memory ${systemStatus.memory || 'N/A'} · updated ${systemStatus.lastUpdated || '—'}`}
        />
      </div>

      <div className="vision-overview-split">
        <section className="vision-panel vision-panel-tight">
          <div className="vision-panel-head">
            <h3 className="vision-section-title">{t('recordsAdded')}</h3>
            <span className="vision-cell-muted">{t('lastSixMonths')}</span>
          </div>
          {records.length === 0
            ? <Empty description={t('noRecordsYet')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
            : <MonthlyRecordsChart data={overviewChartData} />}
        </section>

        <section className="vision-panel vision-panel-tight">
          <div className="vision-panel-head">
            <h3 className="vision-section-title">{t('recordsByCategory')}</h3>
            <button type="button" className="vision-link-btn" onClick={() => onNavigate?.('categories')}>
              {t('manage')}
              <ArrowRightOutlined />
            </button>
          </div>
          <CategoryBars rows={topCategories} total={records.length} />
        </section>
      </div>

      <div className="vision-overview-split">
        <section className="vision-panel vision-panel-tight">
          <div className="vision-panel-head">
            <h3 className="vision-section-title">{t('recentRecords')}</h3>
            <button type="button" className="vision-link-btn" onClick={() => onNavigate?.('records')}>
              {t('viewAll')}
              <ArrowRightOutlined />
            </button>
          </div>

          {recentRecords.length === 0 ? (
            <Empty description="No records yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <div className="vision-table-scroll">
              <table className="vision-data-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Category</th>
                    <th>Attachments</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRecords.map((record) => (
                    <tr key={record.id}>
                      <td>
                        <div className="vision-file-cell">
                          <span className="vision-file-icon"><FileTextOutlined /></span>
                          <span className="vision-file-name" title={record.title}>{record.title}</span>
                        </div>
                      </td>
                      <td><span className="vision-badge is-grey">{record.category}</span></td>
                      <td className="vision-cell-muted">
                        {(record.attachments?.length || (record.attachment ? 1 : 0)) || '—'}
                      </td>
                      <td className="vision-cell-muted">{formatDate(record.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="vision-panel vision-panel-tight">
          <div className="vision-panel-head">
            <h3 className="vision-section-title">Next {SCHEDULE_WINDOW_DAYS} days</h3>
            {canSeeSchedule && (
              <button type="button" className="vision-link-btn" onClick={() => onNavigate?.('schedule')}>
                Open Schedule
                <ArrowRightOutlined />
              </button>
            )}
          </div>

          {!canSeeSchedule ? (
            <Empty description="No access to Schedule" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : schedule.length === 0 ? (
            <Empty description="Nothing scheduled" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <ul className="vision-upcoming-list">
              {schedule.slice(0, RECENT_LIMIT).map((item) => (
                <li key={`${item.scheduleId}:${item.date}`}>
                  <span className="vision-upcoming-date">
                    {formatDate(item.date)}
                    <small>{item.time}</small>
                  </span>
                  <span className="vision-upcoming-title" title={item.title}>{item.title}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="vision-panel">
        <div className="vision-panel-head">
          <div className="vision-panel-head-title">
            <span className="vision-panel-icon"><ToolOutlined /></span>
            <h3 className="vision-section-title">Project components</h3>
          </div>
          <span className="vision-cell-muted">{components.length} modules available to you</span>
        </div>

        <div className="vision-basic-grid">
          {components.map((component) => (
            <button
              type="button"
              key={component.key}
              className={`vision-basic-card tone-${component.tone} is-clickable`}
              onClick={() => onNavigate?.(component.key)}
            >
              <span className="vision-basic-icon">{component.icon}</span>
              <h4 className="vision-basic-title">{component.title}</h4>
              <p className="vision-basic-desc">{component.detail}</p>
              <StatusBadge tone={component.status === 'ready' ? 'green' : 'amber'}>
                {component.status === 'ready' ? 'Ready' : 'Planned'}
              </StatusBadge>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
