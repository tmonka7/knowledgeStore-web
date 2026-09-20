import { useRef } from 'react';
import { Button } from 'antd';
import {
  ArrowLeftOutlined,
  EnvironmentOutlined,
  ExportOutlined,
  FullscreenOutlined,
  LinkOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/ui/PageHeader';
import StatusBadge, { cameraTone } from '../components/ui/StatusBadge';
import { canPreviewInBrowser, streamProtocol } from '../components/CameraCard';

export default function CameraViewPage({ camera, onBack }) {
  const stageRef = useRef(null);
  const preview = canPreviewInBrowser(camera);
  const tone = cameraTone(camera.status);
  const openable = /^https?:\/\//i.test(camera.address || '');

  const goFullscreen = () => {
    const element = stageRef.current;
    const open = element?.requestFullscreen || element?.webkitRequestFullscreen || element?.msRequestFullscreen;
    open?.call(element);
  };

  return (
    <div className="vision-page">
      <PageHeader
        title={camera.name}
        subtitle={camera.location}
        actions={(
          <>
            <Button className="vision-btn-ghost" icon={<ArrowLeftOutlined />} onClick={onBack}>
              Back to Cameras
            </Button>
            <Button className="vision-btn-ghost" icon={<FullscreenOutlined />} onClick={goFullscreen}>
              Fullscreen
            </Button>
            {openable && (
              <Button
                type="primary"
                className="vision-btn-primary"
                icon={<ExportOutlined />}
                onClick={() => window.open(camera.address, '_blank', 'noopener')}
              >
                Open Stream
              </Button>
            )}
          </>
        )}
      />

      <div className="vision-live-tile vision-camera-stage" ref={stageRef}>
        {preview ? (
          <iframe src={camera.address} title={`${camera.name} live view`} allow="autoplay; fullscreen" />
        ) : (
          <div className="vision-live-unavailable">
            <VideoCameraOutlined />
            <span>
              {camera.status === 'online'
                ? 'Browser preview needs an HTTP or HTTPS stream URL.'
                : 'Stream unavailable — this camera is not online.'}
            </span>
          </div>
        )}

        <StatusBadge tone={tone} dot={camera.status === 'online'} className={`vision-live-badge is-${tone}`}>
          {camera.status === 'online' ? 'Online' : camera.status === 'maintenance' ? 'Maintenance' : 'Offline'}
        </StatusBadge>

        <div className="vision-live-overlay">
          <div>
            <div className="vision-live-title">{camera.name}</div>
            <div className="vision-live-sub">
              <EnvironmentOutlined />
              {camera.location}
            </div>
            <div className="vision-live-specs">
              <span className="vision-spec-chip">{streamProtocol(camera.address)}</span>
              <span className="vision-spec-chip">{camera.status === 'online' ? 'Streaming' : 'No signal'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="vision-panel">
        <h2 className="vision-section-title">Camera details</h2>
        <dl className="vision-detail-grid">
          <div>
            <dt>Location</dt>
            <dd>{camera.location}</dd>
          </div>
          <div>
            <dt>Stream URL</dt>
            <dd className="vision-camera-url" title={camera.address}>
              <LinkOutlined /> {camera.address}
            </dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <StatusBadge tone={tone} dot={camera.status === 'online'}>{camera.status}</StatusBadge>
            </dd>
          </div>
          <div>
            <dt>Notes</dt>
            <dd>{camera.notes || 'No notes added.'}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
