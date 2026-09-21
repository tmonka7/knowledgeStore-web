import { useEffect, useState } from 'react';
import { Button, Checkbox, Empty, InputNumber, Modal, Space, message } from 'antd';
import {
  ClearOutlined,
  FileExclamationOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import api from '../../api';
import StatCard from '../ui/StatCard';
import { formatBytes, formatDateTime, formatNumber } from './formatters';

const TASKS = [
  {
    key: 'orphan-uploads',
    label: 'Delete unlinked uploaded files',
    detail: 'Removes files under uploads/ that no record or mail points at any more.',
  },
  {
    key: 'clear-logs',
    label: 'Clear activity logs',
    detail: 'Deletes the stored maintenance log. Keep recent days with the field below.',
  },
  {
    key: 'compact',
    label: 'Compact collections',
    detail: 'Asks the server to release space deleted documents left behind. Unavailable on some deployments.',
  },
  {
    key: 'sync-indexes',
    label: 'Sync indexes',
    detail: 'Recreates the indexes the models declare and drops the ones they no longer do.',
  },
];

/** System maintenance: what would be removed, then what was. */
export default function DatabaseOptimizationPanel({ canManage, onDone }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState(['orphan-uploads']);
  const [keepDays, setKeepDays] = useState(7);
  const [results, setResults] = useState([]);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/database/optimization');
      setReport(data);
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to build the optimization report.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const run = () => {
    if (!selected.length) {
      message.error('Select at least one task.');
      return;
    }

    const deletesFiles = selected.includes('orphan-uploads');
    Modal.confirm({
      title: 'Run maintenance?',
      okText: 'Run',
      okButtonProps: { danger: deletesFiles },
      content: (
        <div>
          <ul className="vision-plain-list">
            {TASKS.filter((task) => selected.includes(task.key)).map((task) => (
              <li key={task.key}>{task.label}</li>
            ))}
          </ul>
          {deletesFiles && (
            <p>
              {formatNumber(report?.uploads?.orphanCount || 0)} unlinked file(s) found;
              files uploaded in the last hour are always kept.
            </p>
          )}
        </div>
      ),
      onOk: async () => {
        setRunning(true);
        try {
          const { data } = await api.post('/database/optimize', {
            tasks: selected,
            olderThanDays: keepDays,
          });
          setResults(data.results || []);
          message.success('Maintenance finished.');
          await load();
          await onDone?.();
        } catch (error) {
          message.error(error.response?.data?.message || 'Maintenance failed.');
        } finally {
          setRunning(false);
        }
      },
    });
  };

  const uploads = report?.uploads || {};
  const orphans = uploads.orphans || [];

  return (
    <div className="vision-stack">
      <div className="vision-stat-grid">
        <StatCard
          tone="amber"
          icon={<FileExclamationOutlined />}
          label="Unlinked files"
          value={formatNumber(uploads.orphanCount || 0)}
          meta={`${formatBytes(uploads.orphanBytes || 0)} recoverable`}
        />
        <StatCard
          tone="blue"
          icon={<ThunderboltOutlined />}
          label="Uploads"
          value={formatNumber(uploads.totalFiles || 0)}
          meta={`${formatNumber(uploads.referenced || 0)} still referenced`}
        />
        <StatCard
          tone="violet"
          icon={<ClearOutlined />}
          label="Log entries"
          value={formatNumber(report?.logs?.count || 0)}
          meta={report?.logs?.oldest ? `Oldest ${formatDateTime(report.logs.oldest)}` : 'Nothing logged yet'}
        />
        <StatCard
          tone="cyan"
          icon={<ReloadOutlined />}
          label="Storage"
          value={formatBytes(report?.storage?.storageSize || 0)}
          meta={`${formatBytes(report?.storage?.dataSize || 0)} data · ${formatBytes(report?.storage?.indexSize || 0)} indexes`}
        />
      </div>

      <section className="vision-panel vision-panel-tight">
        <div className="vision-panel-head">
          <h3 className="vision-section-title">Maintenance tasks</h3>
          <Button className="vision-btn-ghost" size="small" icon={<ReloadOutlined />} loading={loading} onClick={load}>
            Rescan
          </Button>
        </div>

        <Checkbox.Group value={selected} onChange={setSelected} className="vision-task-list">
          {TASKS.map((task) => (
            <Checkbox key={task.key} value={task.key} className="vision-task-item">
              <span>
                <strong>{task.label}</strong>
                <small>{task.detail}</small>
              </span>
            </Checkbox>
          ))}
        </Checkbox.Group>

        <div className="vision-inline-field">
          <span className="vision-cell-muted">Keep logs from the last</span>
          <InputNumber min={0} max={365} value={keepDays} onChange={(value) => setKeepDays(value ?? 0)} />
          <span className="vision-cell-muted">days (0 clears everything)</span>
        </div>

        <Space className="vision-form-actions">
          <Button
            type="primary"
            className="vision-btn-primary"
            loading={running}
            disabled={!canManage}
            onClick={run}
            icon={<ThunderboltOutlined />}
          >
            Run maintenance
          </Button>
        </Space>
      </section>

      {results.length > 0 && (
        <section className="vision-panel vision-panel-tight">
          <div className="vision-panel-head">
            <h3 className="vision-section-title">Last run</h3>
          </div>
          <ul className="vision-facts">
            {results.map((result) => (
              <li key={result.task}><span>{result.task}</span><strong>{result.detail}</strong></li>
            ))}
          </ul>
        </section>
      )}

      <section className="vision-panel vision-panel-tight">
        <div className="vision-panel-head">
          <h3 className="vision-section-title">Unlinked files</h3>
          <span className="vision-cell-muted">
            {orphans.length < (uploads.orphanCount || 0)
              ? `Showing ${orphans.length} of ${formatNumber(uploads.orphanCount)}`
              : `${orphans.length} file(s)`}
          </span>
        </div>

        {!orphans.length ? (
          <Empty description="Nothing to clean up" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div className="vision-table-scroll">
            <table className="vision-data-table">
              <thead>
                <tr><th>File</th><th>Size</th><th>Modified</th><th>Status</th></tr>
              </thead>
              <tbody>
                {orphans.map((file) => (
                  <tr key={file.path}>
                    <td><span className="vision-file-name" title={file.path}>{file.path}</span></td>
                    <td className="vision-cell-muted">{formatBytes(file.size)}</td>
                    <td className="vision-cell-muted">{formatDateTime(file.modifiedAt)}</td>
                    <td>
                      <span className={`vision-badge ${file.isRecent ? 'is-amber' : 'is-grey'}`}>
                        {file.isRecent ? 'Kept — uploaded recently' : 'Will be deleted'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
