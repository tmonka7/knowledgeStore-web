import { CheckCircleFilled, ExclamationCircleFilled, LoadingOutlined } from '@ant-design/icons';
import { useLanguage } from '../../i18n';

const STATES = {
  empty: { tone: 'idle', icon: <ExclamationCircleFilled />, key: 'faceNotRegistered' },
  working: { tone: 'idle', icon: <LoadingOutlined />, key: 'preparingFace' },
  ready: { tone: 'ready', icon: <CheckCircleFilled />, key: 'faceReady' },
  captured: { tone: 'ready', icon: <CheckCircleFilled />, key: 'faceCaptured' },
  registered: { tone: 'success', icon: <CheckCircleFilled />, key: 'faceRegistered' },
};

/** Status line under the circular preview. */
export default function FaceStatus({ state }) {
  const { t } = useLanguage();
  const current = STATES[state] || STATES.empty;

  return (
    <p className={`face-status-line is-${current.tone}`} role="status" aria-live="polite">
      <span className="face-status-icon">{current.icon}</span>
      {t(current.key)}
    </p>
  );
}
