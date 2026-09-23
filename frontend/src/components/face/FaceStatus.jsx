import {
  CheckCircleFilled, ExclamationCircleFilled, InfoCircleFilled, LoadingOutlined,
} from '@ant-design/icons';
import { useLanguage } from '../../i18n';

const STATES = {
  empty: { tone: 'idle', icon: <ExclamationCircleFilled />, key: 'faceNotRegistered' },
  // Distinct from `empty` on purpose. Where a face is optional, a warning
  // triangle over "not registered" reads as something left undone, and people
  // go looking for the step they missed.
  optional: { tone: 'idle', icon: <InfoCircleFilled />, key: 'faceOptional' },
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
