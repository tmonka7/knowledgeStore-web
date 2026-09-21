import { useRef, useState } from 'react';
import { Button, Empty, Tooltip, message } from 'antd';
import {
  DeleteOutlined,
  DownloadOutlined,
  FileImageOutlined,
  FileOutlined,
  FilePdfOutlined,
  FileZipOutlined,
  PaperClipOutlined,
} from '@ant-design/icons';
import api from '../../api';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 10;

const formatBytes = (bytes) => {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;

  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 ? Math.round(size) : Math.round(size * 10) / 10} ${units[index]}`;
};

const iconFor = (attachment) => {
  const type = attachment.mimeType || '';
  if (type.startsWith('image/')) return <FileImageOutlined />;
  if (type === 'application/pdf') return <FilePdfOutlined />;
  if (/zip|compressed|tar|rar|7z/.test(type)) return <FileZipOutlined />;
  return <FileOutlined />;
};

// The API and the static files share an origin; the uploads path is not under
// /api, so the suffix is trimmed the same way the record detail does it.
const uploadUrl = (path) => {
  const origin = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000/api').replace(/\/api$/, '');
  return `${origin}${path.startsWith('/') ? '' : '/'}${path}`;
};

/**
 * Files on a task.
 *
 * Uploads happen against a task that already exists rather than travelling
 * with the form, so the same component serves the edit dialog and the drawer.
 * A task being created has nowhere to put them yet, and says so.
 */
export default function TaskAttachments({
  projectId,
  task,
  canUpload,
  canDelete,
  onChange,
  compact = false,
}) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState('');

  if (!task?.id) {
    return (
      <p className="vision-cell-muted">Files can be attached once the task has been created.</p>
    );
  }

  const attachments = task.attachments || [];

  const upload = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    if (files.length > MAX_FILES) {
      message.error(`Up to ${MAX_FILES} files at a time.`);
      return;
    }
    const tooBig = files.find((file) => file.size > MAX_FILE_BYTES);
    if (tooBig) {
      message.error(`${tooBig.name} is larger than ${formatBytes(MAX_FILE_BYTES)}.`);
      return;
    }

    setBusy('upload');
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append('attachments', file));

      const { data } = await api.post(
        `/projects/${projectId}/tasks/${task.id}/attachments`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      onChange?.(data.task);
      message.success(files.length === 1 ? 'File attached.' : `${files.length} files attached.`);
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to attach that file.');
    } finally {
      setBusy('');
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async (attachment) => {
    setBusy(attachment.id);
    try {
      const { data } = await api.delete(
        `/projects/${projectId}/tasks/${task.id}/attachments/${attachment.id}`,
      );
      onChange?.(data.task);
      message.success('Attachment removed.');
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to remove that attachment.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="task-attachments">
      {canUpload && (
        <div className="task-attachment-controls">
          <Button
            icon={<PaperClipOutlined />}
            loading={busy === 'upload'}
            onClick={() => inputRef.current?.click()}
          >
            Attach files
          </Button>
          <span className="vision-cell-muted">Up to {MAX_FILES} files, {formatBytes(MAX_FILE_BYTES)} each</span>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="mail-file-input"
            onChange={(event) => upload(event.target.files)}
          />
        </div>
      )}

      {!attachments.length ? (
        compact
          ? <p className="vision-cell-muted">No files attached yet.</p>
          : <Empty description="No files attached" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <ul className="task-attachment-list">
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <span className="task-attachment-icon">{iconFor(attachment)}</span>
              <span className="task-attachment-body">
                <a
                  className="task-attachment-name"
                  href={uploadUrl(attachment.path)}
                  target="_blank"
                  rel="noreferrer"
                  title={attachment.name}
                >
                  {attachment.name}
                </a>
                <small className="vision-cell-muted">
                  {formatBytes(attachment.size)}
                  {attachment.uploadedByName ? ` · ${attachment.uploadedByName}` : ''}
                </small>
              </span>
              <span className="task-attachment-actions">
                <Tooltip title="Open or download">
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    href={uploadUrl(attachment.path)}
                    target="_blank"
                    rel="noreferrer"
                  />
                </Tooltip>
                {canDelete && (
                  <Tooltip title="Remove">
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      loading={busy === attachment.id}
                      onClick={() => remove(attachment)}
                    />
                  </Tooltip>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
