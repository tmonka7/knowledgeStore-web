import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty } from 'antd';
import {
  AimOutlined,
  ArrowLeftOutlined,
  CloseOutlined,
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
import PtzPad from '../components/camera/PtzPad';
import RecordButton, { RecordingTag } from '../components/camera/RecordButton';
import { can } from '../permissions';
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

function LiveTile({ camera, selected, onSelect }) {
  const { t } = useLanguage();
  const tileRef = useRef(null);
  const preview = canPreviewInBrowser(camera);
  const tone = cameraTone(camera.status);

  return (
    <div className={`vision-live-tile${selected ? ' is-selected' : ''}`} ref={tileRef}>
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
      <span className="vision-live-rec"><RecordingTag camera={camera} /></span>

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
          {/* The picture is an iframe, which keeps its clicks to itself, so
              choosing a camera to control is a button of its own. */}
          <button
            type="button"
            className={`vision-live-btn${selected ? ' is-live' : ''}`}
            onClick={onSelect}
            aria-pressed={selected}
            aria-label={t('wallControlCamera', { name: camera.name })}
          >
            <AimOutlined />
            {t('wallControl')}
          </button>
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

/**
 * PTZ and recording for the one camera chosen on the wall. PTZ needs the
 * camera set up for it (ONVIF, with a profile) and cameras:edit, exactly as
 * on the single-camera page; otherwise the panel says which is missing.
 */
function ControlPanel({ camera, user, onCameraChange, onClose }) {
  const { t } = useLanguage();
  const ptzEnabled = Boolean(camera.ptz?.enabled && camera.ptz?.profileToken);
  const canDrive = can(user, 'cameras', 'edit');

  return (
    <aside className="vision-panel camera-wall-panel">
      <div className="camera-wall-panel-head">
        <div>
          <h2 className="vision-section-title">{camera.name}</h2>
          <div className="vision-cell-muted"><EnvironmentOutlined /> {camera.location}</div>
        </div>
        <Button type="text" icon={<CloseOutlined />} onClick={onClose} aria-label={t('close')} />
      </div>

      <div className="camera-wall-panel-record">
        <RecordButton camera={camera} user={user} onCameraChange={onCameraChange} />
      </div>

      <h3 className="vision-section-title">{t('ptzControl')}</h3>
      {!ptzEnabled ? (
        <Alert type="info" showIcon message={t('wallNoPtz')} description={t('wallNoPtzHint')} />
      ) : !canDrive ? (
        <Alert type="info" showIcon message={t('wallPtzNeedsEdit')} />
      ) : (
        <PtzPad key={camera.id} camera={camera} />
      )}
    </aside>
  );
}

export default function CameraWallPage({ user, cameras, onBack, onCameraChange }) {
  const { t } = useLanguage();
  const [columns, setColumns] = useState(2);
  const [selectedId, setSelectedId] = useState(null);
  const gridRef = useRef(null);

  // One camera on the wall is the one being controlled; a chosen camera that
  // has been deleted meanwhile is let go.
  useEffect(() => {
    if (cameras.length === 1) setSelectedId(cameras[0].id);
    else if (selectedId && !cameras.some((camera) => camera.id === selectedId)) setSelectedId(null);
  }, [cameras, selectedId]);
  const selected = cameras.find((camera) => camera.id === selectedId) || null;

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
        <div className={`camera-wall-layout${selected ? ' has-panel' : ''}`}>
          <div className={`vision-live-grid cols-${columns}`} ref={gridRef}>
            {cameras.map((camera) => (
              <LiveTile
                key={camera.id}
                camera={camera}
                selected={camera.id === selectedId}
                onSelect={() => setSelectedId((current) => (current === camera.id ? null : camera.id))}
              />
            ))}
          </div>
          {selected ? (
            <ControlPanel camera={selected} user={user} onCameraChange={onCameraChange} onClose={() => setSelectedId(null)} />
          ) : (
            <Empty className="camera-wall-hint" image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('wallPickCamera')} />
          )}
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
