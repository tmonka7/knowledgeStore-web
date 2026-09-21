import { useCallback, useEffect, useState } from 'react';
import { Button, Tabs, message } from 'antd';
import {
  ClusterOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  HddOutlined,
  ReloadOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import api from '../api';
import { can } from '../permissions';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import StatusBadge from '../components/ui/StatusBadge';
import DatabaseInitPanel from '../components/database/DatabaseInitPanel';
import DatabaseBackupPanel from '../components/database/DatabaseBackupPanel';
import DatabaseReplicationPanel from '../components/database/DatabaseReplicationPanel';
import DatabaseOptimizationPanel from '../components/database/DatabaseOptimizationPanel';
import { formatBytes, formatDateTime, formatNumber } from '../components/database/formatters';

/**
 * Database Management.
 *
 * The status header is loaded here and handed down, so every tab reports the
 * same figures and one refresh updates all of them.
 */
export default function DatabasePage({ user, onSessionInvalidated }) {
  // 'database:view' may read every panel; only 'database:manage' may change
  // anything, so the destructive controls are disabled rather than hidden.
  const canManage = can(user, 'database', 'manage');
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/database/status');
      setStatus(data);
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to read the database status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const database = status?.database || {};
  const replication = status?.replication || {};
  const uploads = status?.uploads || {};
  const backups = status?.backups || {};

  const replicationLabel = !replication.enabled
    ? 'Standalone'
    : replication.initialized
      ? replication.setName || 'Replica set'
      : 'Not initiated';

  return (
    <div className="vision-page vision-stack">
      <PageHeader
        title="Database Management"
        subtitle="Initialize, back up, replicate and clean up the MongoDB store behind the app."
        actions={(
          <>
            <StatusBadge tone={database.name ? 'green' : 'red'} dot>
              {database.name ? 'Connected' : 'Unavailable'}
            </StatusBadge>
            <Button className="vision-btn-ghost" icon={<ReloadOutlined />} loading={loading} onClick={loadStatus}>
              Refresh
            </Button>
          </>
        )}
      />

      <div className="vision-stat-grid">
        <StatCard
          tone="blue"
          icon={<DatabaseOutlined />}
          label="Database"
          value={database.name || '—'}
          meta={`MongoDB ${database.mongoVersion || '?'} · ${database.host || 'unknown host'}`}
        />
        <StatCard
          tone="violet"
          icon={<HddOutlined />}
          label="Storage"
          value={formatBytes(database.storageSize)}
          meta={`${formatNumber(database.objects)} documents · ${formatBytes(database.indexSize)} indexes`}
        />
        <StatCard
          tone={replication.initialized ? 'green' : 'amber'}
          icon={<ClusterOutlined />}
          label="Replication"
          value={replicationLabel}
          meta={replication.initialized ? `${replication.members?.length || 0} member(s)` : 'No replica set active'}
        />
        <StatCard
          tone={uploads.orphanCount ? 'amber' : 'cyan'}
          icon={<ThunderboltOutlined />}
          label="Unlinked files"
          value={formatNumber(uploads.orphanCount)}
          meta={`${formatBytes(uploads.orphanBytes)} of ${formatBytes(uploads.totalBytes)} uploads`}
        />
        <StatCard
          tone="green"
          icon={<SaveOutlined />}
          label="Backups"
          value={formatNumber(backups.count)}
          meta={backups.latest ? `Latest ${formatDateTime(backups.latest.createdAt)}` : 'None taken yet'}
        />
      </div>

      <Tabs
        defaultActiveKey="initialize"
        items={[
          {
            key: 'initialize',
            label: <span><DeploymentUnitOutlined /> Initialization</span>,
            children: (
              <DatabaseInitPanel
                status={status}
                onDone={loadStatus}
                canManage={canManage}
                onSessionInvalidated={onSessionInvalidated}
              />
            ),
          },
          {
            key: 'restore',
            label: <span><SaveOutlined /> Restoration</span>,
            children: <DatabaseBackupPanel canManage={canManage} onDone={loadStatus} />,
          },
          {
            key: 'replication',
            label: <span><ClusterOutlined /> Replication</span>,
            children: <DatabaseReplicationPanel replication={replication} canManage={canManage} onRefresh={loadStatus} />,
          },
          {
            key: 'optimize',
            label: <span><ThunderboltOutlined /> Optimization</span>,
            children: <DatabaseOptimizationPanel canManage={canManage} onDone={loadStatus} />,
          },
        ]}
      />
    </div>
  );
}
