import { useEffect, useState } from 'react';
import { Button, Tag, Tooltip, message } from 'antd';
import { LoadingOutlined, VideoCameraAddOutlined, StopOutlined } from '@ant-design/icons';
import api from '../../api';
import { can } from '../../permissions';
import { useLanguage } from '../../i18n';

const POLL_MS = 3000;

/**
 * "REC" tag for a camera being recorded: red while ffmpeg is writing, amber
 * while it is (re)connecting, with the recorder's last error on hover.
 */
export function RecordingTag({ camera }) {
  const { t } = useLanguage();
  const recording = camera.recording;
  if (!recording?.enabled) return null;
  if (recording.active) {
    return <Tag color="red" className="camera-rec-tag">● {t('recRecording')}</Tag>;
  }
  return (
    <Tooltip title={recording.error || t('recConnecting')}>
      <Tag color={recording.error ? 'orange' : 'gold'} icon={<LoadingOutlined />}>{t('recConnecting')}</Tag>
    </Tooltip>
  );
}

/**
 * Start / stop recording one camera (cameras:edit). The recorder takes a few
 * seconds to reach the stream, so while it is switched on but not yet
 * writing, the camera is re-read until it is — or says why it is not.
 */
export default function RecordButton({ camera, user, onCameraChange, size }) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const recording = camera.recording || {};
  const waiting = recording.enabled && !recording.active;

  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(async () => {
      try {
        const { data } = await api.get('/cameras');
        const fresh = (data.cameras || []).find((item) => item.id === camera.id);
        if (fresh) onCameraChange?.(fresh);
      } catch {
        // The next tick tries again.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, camera.id, onCameraChange]);

  if (!can(user, 'cameras', 'edit')) return <RecordingTag camera={camera} />;

  const toggle = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/cameras/${camera.id}/recording/${recording.enabled ? 'stop' : 'start'}`);
      onCameraChange?.(data.camera);
      message.success(recording.enabled ? t('recStopped') : t('recStarted'));
    } catch (error) {
      message.error(error.response?.data?.message || t('recFailed'));
    } finally {
      setBusy(false);
    }
  };

  const recordable = /^(rtsps?|https?):\/\//i.test(camera.address || '');
  return (
    <>
      <Tooltip title={recordable ? '' : t('recNeedsStream')}>
        <Button
          size={size}
          danger={recording.enabled}
          className={recording.enabled ? '' : 'vision-btn-ghost'}
          icon={recording.enabled ? <StopOutlined /> : <VideoCameraAddOutlined />}
          loading={busy}
          disabled={!recordable && !recording.enabled}
          onClick={toggle}
        >
          {recording.enabled ? t('recStop') : t('recStart')}
        </Button>
      </Tooltip>
      <RecordingTag camera={camera} />
    </>
  );
}
