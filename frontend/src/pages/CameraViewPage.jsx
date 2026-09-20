import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Button, Switch, Tooltip } from 'antd';
import {
  ArrowLeftOutlined,
  EnvironmentOutlined,
  ExportOutlined,
  FullscreenOutlined,
  LinkOutlined,
  ScanOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/ui/PageHeader';
import StatusBadge, { cameraTone } from '../components/ui/StatusBadge';
import { canPreviewInBrowser, streamProtocol } from '../components/CameraCard';
import DetectionOverlay from '../components/camera/DetectionOverlay';
import StreamSurface from '../components/camera/StreamSurface';
import useObjectDetection from '../components/camera/useObjectDetection';
import {
  DETECTION_STATUS,
  SECURITY_CLASSES,
  classIdsFor,
  colorForClass,
  streamMediaKind,
} from '../lib/objectDetector';

const SECURITY_CLASS_IDS = classIdsFor(SECURITY_CLASSES);

export default function CameraViewPage({ camera, onBack }) {
  const stageRef = useRef(null);
  const sourceRef = useRef(null);

  const [detecting, setDetecting] = useState(false);
  const [securityOnly, setSecurityOnly] = useState(true);
  const [sourceReady, setSourceReady] = useState(false);
  const [sourceFailed, setSourceFailed] = useState(false);

  const preview = canPreviewInBrowser(camera);
  const tone = cameraTone(camera.status);
  const openable = /^https?:\/\//i.test(camera.address || '');
  const mediaKind = useMemo(() => streamMediaKind(camera.address), [camera.address]);

  const { status, detections, summary } = useObjectDetection({
    enabled: detecting && preview,
    sourceRef,
    ready: sourceReady,
    sourceFailed,
    mediaKind,
    classFilter: securityOnly ? SECURITY_CLASS_IDS : null,
  });

  const toggleDetection = (next) => {
    // The element is swapped out underneath us, so nothing is decoded yet.
    setSourceReady(false);
    setSourceFailed(false);
    setDetecting(next);
  };

  const handleSourceReady = useCallback(() => {
    setSourceReady(true);
    setSourceFailed(false);
  }, []);

  // Only reached once StreamSurface has also exhausted its non-CORS retry.
  const handleSourceError = useCallback(() => {
    setSourceReady(false);
    setSourceFailed(true);
  }, []);

  const goFullscreen = () => {
    const element = stageRef.current;
    const open = element?.requestFullscreen || element?.webkitRequestFullscreen || element?.msRequestFullscreen;
    open?.call(element);
  };

  const detectionProblem = detecting && status.tone === 'warning' ? status : null;

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
            <Tooltip
              title={preview
                ? 'Outline people and vehicles in this view'
                : 'Detection needs an online camera with an HTTP or HTTPS stream URL.'}
            >
              {/* A disabled Button swallows pointer events, so the tooltip needs its own target. */}
              <span>
                <Button
                  className={`vision-btn-ghost${detecting ? ' is-active' : ''}`}
                  icon={<ScanOutlined />}
                  disabled={!preview}
                  onClick={() => toggleDetection(!detecting)}
                >
                  {detecting ? 'Stop Detection' : 'Detect Objects'}
                </Button>
              </span>
            </Tooltip>
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
          <StreamSurface
            camera={camera}
            mediaKind={mediaKind}
            detecting={detecting}
            sourceRef={sourceRef}
            onReady={handleSourceReady}
            onError={handleSourceError}
          />
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

        {detecting && preview && (
          <DetectionOverlay detections={detections} sourceRef={sourceRef} />
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
              {detecting && status.code === 'RUNNING' && (
                summary.length ? summary.map(({ label, classId, count }) => (
                  <span
                    key={label}
                    className="vision-spec-chip is-detection"
                    style={{ '--detect-color': colorForClass(classId) }}
                  >
                    {label} × {count}
                  </span>
                )) : <span className="vision-spec-chip is-detection">Nothing detected</span>
              )}
              {detecting && status.code === 'LOADING' && (
                <span className="vision-spec-chip is-detection">{DETECTION_STATUS.LOADING.title}</span>
              )}
            </div>
          </div>

          {detecting && (
            <label className="vision-detect-filter">
              <Switch size="small" checked={securityOnly} onChange={setSecurityOnly} />
              People &amp; vehicles only
            </label>
          )}
        </div>
      </div>

      {detectionProblem && (
        <Alert
          type="warning"
          showIcon
          className="vision-detect-alert"
          message={detectionProblem.title}
          description={detectionProblem.hint}
        />
      )}

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
