import { useRef, useState } from 'react';
import { Button } from 'antd';
import {
  ArrowLeftOutlined,
  BorderOutlined,
  EnvironmentOutlined,
  ExportOutlined,
  FullscreenOutlined,
  PlayCircleFilled,
  VideoCameraOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import StatusBadge, { cameraTone } from '../components/ui/StatusBadge';
import { canPreviewInBrowser, streamProtocol } from '../components/CameraCard';
import { useLanguage } from '../i18n';

const LAYOUTS = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 4, label: '4' },
];

const requestFullscreen = (element) => {
  if (!element) return;
  const open = element.requestFullscreen || element.webkitRequestFullscreen || element.msRequestFullscreen;
  open?.call(element);
};

function LiveTile({ camera }) {
  const { t } = useLanguage();
  const tileRef = useRef(null);
  const preview = canPreviewInBrowser(camera);
  const tone = cameraTone(camera.status);

  return (
    <div className="vision-live-tile" ref={tileRef}>
      {preview ? (
        <iframe src={camera.address} title={`${camera.name} live view`} allow="autoplay; fullscreen" />
      ) : (
        <div className="vision-live-unavailable">
          <VideoCameraOutlined />
          <span>{t('streamUnavailable')}</span>
        </div>
      )}

      <StatusBadge tone={tone} dot={camera.status === 'online'} className={`vision-live-badge is-${tone}`}>
        {camera.status === 'online' ? t('online') : camera.status === 'maintenance' ? t('maintenance') : t('offline')}
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
            <span className="vision-spec-chip">{camera.status === 'online' ? t('streaming') : t('noSignal')}</span>
          </div>
        </div>

        <div className="vision-live-controls">
          <button
            type="button"
            className="vision-live-btn"
            onClick={() => requestFullscreen(tileRef.current)}
            aria-label={t('fullscreenCamera', { name: camera.name })}
          >
            <FullscreenOutlined />
          </button>
          <button
            type="button"
            className="vision-live-btn is-live"
            disabled={!/^https?:\/\//i.test(camera.address || '')}
            onClick={() => window.open(camera.address, '_blank', 'noopener')}
            aria-label={t('openCameraNewTab', { name: camera.name })}
          >
            <PlayCircleFilled />
            {t('live')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CameraWallPage({ cameras, onBack }) {
  const { t } = useLanguage();
  const [columns, setColumns] = useState(2);
  const gridRef = useRef(null);

  const online = cameras.filter((camera) => camera.status === 'online').length;
  const offline = cameras.length - online;

  return (
    <div className="vision-page">
      <PageHeader
        title={t('liveCameraView')}
        subtitle={t('monitorCamerasRealtime')}
        actions={(
          <>
            <Button className="vision-btn-ghost" icon={<ArrowLeftOutlined />} onClick={onBack}>
              {t('backToCameras')}
            </Button>
            <div className="vision-layout-toggle" role="group" aria-label={t('gridLayout')}>
              <BorderOutlined style={{ alignSelf: 'center', margin: '0 6px', color: '#8aa0ba' }} />
              {LAYOUTS.map((layout) => (
                <button
                  key={layout.value}
                  type="button"
                  className={columns === layout.value ? 'is-active' : ''}
                  onClick={() => setColumns(layout.value)}
                  aria-pressed={columns === layout.value}
                >
                  {layout.label}
                </button>
              ))}
            </div>
            <Button
              className="vision-btn-ghost"
              icon={<ExportOutlined />}
              onClick={() => requestFullscreen(gridRef.current)}
            >
              {t('fullscreen')}
            </Button>
          </>
        )}
      />

      <div className="vision-stat-grid cols-3">
        <StatCard tone="blue" icon={<VideoCameraOutlined />} label={t('totalCameras')} value={cameras.length} meta={t('registeredDevices')} />
        <StatCard tone="green" icon={<PlayCircleFilled />} label={t('online')} value={online} meta={t('streamingNow')} trend={online > 0 ? 'up' : undefined} />
        <StatCard tone="red" icon={<VideoCameraOutlined />} label={t('offline')} value={offline} meta={t('notReachable')} />
      </div>

      {cameras.length ? (
        <div className={`vision-live-grid cols-${columns}`} ref={gridRef}>
          {cameras.map((camera) => <LiveTile key={camera.id} camera={camera} />)}
        </div>
      ) : (
        <div className="vision-table-panel">
          <div className="vision-empty">
            <VideoCameraOutlined />
            <span>{t('noRegisteredCameras')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
