import { useEffect, useRef, useState } from 'react';
import { Button, Empty, Modal, Radio, Space, Tooltip, message } from 'antd';
import {
  CloudDownloadOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  DatabaseOutlined,
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import api from '../../api';
import StatusBadge from '../ui/StatusBadge';
import { formatBytes, formatDateTime, formatNumber } from './formatters';

/**
 * Backups are files on the API host, so the browser only ever names one. A
 * download goes through the API with the auth header attached and is turned
 * into a blob here rather than a bare link, which would be unauthenticated.
 */
export default function DatabaseBackupPanel({ canManage, onDone }) {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [mode, setMode] = useState('replace');
  const fileInputRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/database/backups');
      setBackups(data.backups || []);
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to list backups.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const createBackup = async () => {
    setBusy('create');
    try {
      const { data } = await api.post('/database/backups');
      message.success(`Backup ${data.backup.name} created.`);
      await load();
      await onDone?.();
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to create a backup.');
    } finally {
      setBusy('');
    }
  };

  const uploadBackup = async (file) => {
    if (!file) return;
    setBusy('upload');
    try {
      const formData = new FormData();
      formData.append('backup', file);
      await api.post('/database/backups/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      message.success('Backup uploaded.');
      await load();
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to upload that file.');
    } finally {
      setBusy('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const downloadBackup = async (backup) => {
    setBusy(`download:${backup.name}`);
    try {
      const response = await api.get(`/database/backups/${backup.name}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = backup.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      message.error('Unable to download that backup.');
    } finally {
      setBusy('');
    }
  };

  const restoreBackup = async (backup) => {
    let summary = null;
    try {
      const { data } = await api.get(`/database/backups/${backup.name}`);
      summary = data.backup;
    } catch (error) {
      message.error(error.response?.data?.message || 'That backup could not be read.');
      return;
    }

    const documents = (summary.collections || []).reduce((total, item) => total + item.documents, 0);

    Modal.confirm({
      title: `Restore ${backup.name}?`,
      okText: mode === 'replace' ? 'Replace data' : 'Merge data',
      okButtonProps: { danger: mode === 'replace' },
      width: 520,
      content: (
        <div>
          <p>
            {formatNumber(documents)} documents across {summary.collections?.length || 0} collections,
            taken {formatDateTime(summary.meta?.createdAt)} by {summary.meta?.createdBy || 'unknown'}.
          </p>
          <p>
            {mode === 'replace'
              ? 'Every listed collection is emptied first. A safety backup is written before anything is removed.'
              : 'Existing documents are kept; anything whose id already exists is skipped.'}
          </p>
        </div>
      ),
      onOk: async () => {
        try {
          const { data } = await api.post(`/database/backups/${backup.name}/restore`, { mode });
          const restored = data.collections.reduce((total, item) => total + item.inserted, 0);
          message.success(`Restored ${formatNumber(restored)} documents.`);
          await load();
          await onDone?.();

          if (data.signOutRequired) {
            Modal.info({
              title: 'Sign in again',
              content: 'The users collection was replaced by the backup, so this session no longer matches an account.',
            });
          }
        } catch (error) {
          message.error(error.response?.data?.message || 'Restore failed.');
        }
      },
    });
  };

  const removeBackup = (backup) => {
    Modal.confirm({
      title: `Delete ${backup.name}?`,
      content: 'The dump file is removed from the server. This cannot be undone.',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.delete(`/database/backups/${backup.name}`);
          message.success('Backup deleted.');
          await load();
          await onDone?.();
        } catch (error) {
          message.error(error.response?.data?.message || 'Unable to delete that backup.');
        }
      },
    });
  };

  return (
    <div className="vision-stack">
      <section className="vision-panel vision-panel-tight">
        <div className="vision-panel-head">
          <div className="vision-panel-head-title">
            <span className="vision-panel-icon"><DatabaseOutlined /></span>
            <h3 className="vision-section-title">Backup and restore</h3>
          </div>
          <StatusBadge tone="blue">{backups.length} backups</StatusBadge>
        </div>

        <p className="vision-monitor-note">
          A backup is one extended-JSON dump of every collection, written to <code>backend/backups</code>.
          Dates and object ids survive the round trip, so a restore reproduces the documents exactly.
        </p>

        <Space className="vision-form-actions" wrap>
          <Button
            type="primary"
            className="vision-btn-primary"
            icon={<SaveOutlined />}
            loading={busy === 'create'}
            disabled={!canManage}
            onClick={createBackup}
          >
            Create backup
          </Button>
          <Button
            className="vision-btn-ghost"
            icon={<CloudUploadOutlined />}
            loading={busy === 'upload'}
            disabled={!canManage}
            onClick={() => fileInputRef.current?.click()}
          >
            Upload backup file
          </Button>
          <Button className="vision-btn-ghost" icon={<ReloadOutlined />} loading={loading} onClick={load}>
            Refresh
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="mail-file-input"
            onChange={(event) => uploadBackup(event.target.files?.[0])}
          />
        </Space>

        <div className="vision-inline-field">
          <span className="vision-cell-muted">Restore mode</span>
          <Radio.Group value={mode} onChange={(event) => setMode(event.target.value)}>
            <Radio.Button value="replace">Replace</Radio.Button>
            <Radio.Button value="merge">Merge</Radio.Button>
          </Radio.Group>
        </div>
      </section>

      <section className="vision-panel vision-panel-tight">
        <div className="vision-panel-head">
          <h3 className="vision-section-title">Available backups</h3>
        </div>

        {!backups.length ? (
          <Empty description="No backups yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div className="vision-table-scroll">
            <table className="vision-data-table">
              <thead>
                <tr><th>File</th><th>Size</th><th>Created</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {backups.map((backup) => (
                  <tr key={backup.name}>
                    <td><span className="vision-file-name" title={backup.name}>{backup.name}</span></td>
                    <td className="vision-cell-muted">{formatBytes(backup.size)}</td>
                    <td className="vision-cell-muted">{formatDateTime(backup.createdAt)}</td>
                    <td>
                      <Space size="small">
                        <Tooltip title={`Restore (${mode})`}>
                          <Button size="small" disabled={!canManage} onClick={() => restoreBackup(backup)}>Restore</Button>
                        </Tooltip>
                        <Tooltip title="Download">
                          <Button
                            size="small"
                            icon={<CloudDownloadOutlined />}
                            loading={busy === `download:${backup.name}`}
                            onClick={() => downloadBackup(backup)}
                          />
                        </Tooltip>
                        <Tooltip title="Delete">
                          <Button size="small" danger disabled={!canManage} icon={<DeleteOutlined />} onClick={() => removeBackup(backup)} />
                        </Tooltip>
                      </Space>
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
