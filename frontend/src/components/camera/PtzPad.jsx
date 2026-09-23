import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Slider, Tooltip, message } from 'antd';
import {
  AimOutlined,
  ArrowDownOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ArrowUpOutlined,
  MinusOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import api from '../../api';
import { useLanguage } from '../../i18n';

/*
 * Manual pan / tilt / zoom.
 *
 * Direction buttons use ONVIF's continuous move: the camera starts travelling
 * when the button goes down and keeps going until it is told to stop. That is
 * the right model for a control pad — how far you want to turn is a question
 * of how long you hold the button — but it has one dangerous property: if the
 * stop never arrives, the camera keeps turning for ever. So the stop is sent
 * from pointerup, pointerleave, pointercancel and unmount, and there is a
 * hard timer as a backstop. A camera left spinning because a browser tab was
 * closed is not a bug anyone finds quickly.
 */

// Longest a single press will move the camera, whatever happens to the events.
const MAX_TRAVEL_MS = 4000;

export default function PtzPad({ camera, onMoved }) {
  const { t } = useLanguage();
  const [speed, setSpeed] = useState(0.5);
  const [busy, setBusy] = useState(false);
  const timerRef = useRef(null);
  const movingRef = useRef(false);

  const halt = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!movingRef.current) return;
    movingRef.current = false;
    try {
      await api.post(`/cameras/${camera.id}/ptz/move`, { mode: 'stop' });
      onMoved?.();
    } catch {
      // Nothing useful to say: the camera either stopped or it did not, and
      // the next command will report the real state.
    }
  }, [camera.id, onMoved]);

  // The camera must not outlive the component that is driving it.
  useEffect(() => () => { halt(); }, [halt]);

  const travel = async (pan, tilt, zoom) => {
    if (movingRef.current) return;
    movingRef.current = true;
    setBusy(true);
    try {
      await api.post(`/cameras/${camera.id}/ptz/move`, {
        mode: 'continuous',
        pan: pan * speed,
        tilt: tilt * speed,
        zoom: zoom * speed,
      });
      timerRef.current = setTimeout(halt, MAX_TRAVEL_MS);
    } catch (error) {
      movingRef.current = false;
      message.error(error.response?.data?.message || t('ptzMoveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const goHome = async () => {
    setBusy(true);
    try {
      // The configured centre of the sweep arc, which is where the camera is
      // meant to be pointing when it is not doing anything else.
      await api.post(`/cameras/${camera.id}/ptz/move`, { mode: 'absolute', pan: 0, tilt: camera.ptz?.tilt || 0, zoom: 0 });
      onMoved?.();
    } catch (error) {
      message.error(error.response?.data?.message || t('ptzMoveFailed'));
    } finally {
      setBusy(false);
    }
  };

  // One set of handlers for every direction button, so a button can never be
  // wired up to start a movement without also being wired up to stop it.
  const hold = (pan, tilt, zoom) => ({
    onPointerDown: () => travel(pan, tilt, zoom),
    onPointerUp: halt,
    onPointerLeave: halt,
    onPointerCancel: halt,
  });

  return (
    <div className="ptz-pad">
      <div className="ptz-grid">
        <Button shape="circle" icon={<ArrowUpOutlined />} className="ptz-up" {...hold(0, 1, 0)} />
        <Button shape="circle" icon={<ArrowLeftOutlined />} className="ptz-left" {...hold(-1, 0, 0)} />
        <Tooltip title={t('ptzHome')}>
          <Button shape="circle" icon={<AimOutlined />} className="ptz-home" loading={busy} onClick={goHome} />
        </Tooltip>
        <Button shape="circle" icon={<ArrowRightOutlined />} className="ptz-right" {...hold(1, 0, 0)} />
        <Button shape="circle" icon={<ArrowDownOutlined />} className="ptz-down" {...hold(0, -1, 0)} />
      </div>

      <div className="ptz-zoom">
        <Button shape="circle" icon={<MinusOutlined />} {...hold(0, 0, -1)} />
        <span>{t('zoom')}</span>
        <Button shape="circle" icon={<PlusOutlined />} {...hold(0, 0, 1)} />
      </div>

      <label className="ptz-speed">
        <span>{t('ptzSpeed')}</span>
        <Slider min={0.1} max={1} step={0.1} value={speed} onChange={setSpeed} tooltip={{ open: false }} />
      </label>
    </div>
  );
}
