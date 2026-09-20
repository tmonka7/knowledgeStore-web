import { Button } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  EnvironmentOutlined,
  PlayCircleOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import StatusBadge, { cameraTone } from './ui/StatusBadge';

/** A browser can only preview an http(s) source; rtsp:// needs a player. */
export const canPreviewInBrowser = (camera) => camera?.status === 'online'
  && /^https?:\/\//i.test(camera.address || '');

/** Protocol chip text, e.g. rtsp://... -> RTSP. */
export const streamProtocol = (address = '') => {
  const match = /^([a-z][a-z0-9+.-]*):\/\//i.exec(address);
  return match ? match[1].toUpperCase() : 'IP';
};

const formatAdded = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
};

export default function CameraCard({ camera, onView, onEdit, onDelete }) {
  const preview = canPreviewInBrowser(camera);
  const added = formatAdded(camera.createdAt);

  return (
    <article className="vision-camera-card">
      <div className="vision-camera-media">
        {preview ? (
          <iframe src={camera.address} title={`${camera.name} live view`} allow="autoplay; fullscreen" />
        ) : (
          <div className="vision-camera-placeholder">
            <VideoCameraOutlined />
            <span>{camera.status === 'online' ? 'Preview unavailable' : 'Stream unavailable'}</span>
          </div>
        )}
        <StatusBadge
          tone={cameraTone(camera.status)}
          dot={camera.status === 'online'}
          className={`vision-camera-status is-${cameraTone(camera.status)}`}
        >
          {camera.status === 'online' ? 'Online' : camera.status === 'maintenance' ? 'Maintenance' : 'Offline'}
        </StatusBadge>
      </div>

      <div className="vision-camera-body">
        <div className="vision-camera-name">{camera.name}</div>
        <div className="vision-camera-meta">
          <EnvironmentOutlined />
          {camera.location}
        </div>
        <div className="vision-camera-url" title={camera.address}>{camera.address}</div>

        <div className="vision-camera-specs">
          <span className="vision-spec-chip">{streamProtocol(camera.address)}</span>
          {added && <span className="vision-spec-chip">Added {added}</span>}
          {camera.notes && <span className="vision-spec-chip" title={camera.notes}>Has notes</span>}
        </div>
      </div>

      <div className="vision-camera-footer">
        <div className="vision-row-actions">
          <Button type="text" icon={<EditOutlined />} onClick={onEdit} aria-label={`Edit ${camera.name}`} />
          <Button type="text" danger icon={<DeleteOutlined />} onClick={onDelete} aria-label={`Delete ${camera.name}`} />
        </div>
        <Button className="vision-btn-ghost" icon={<PlayCircleOutlined />} onClick={onView}>
          View
        </Button>
      </div>
    </article>
  );
}
