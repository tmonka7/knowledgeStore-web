import { CheckCircleFilled, ExclamationCircleFilled, LoadingOutlined } from '@ant-design/icons';

const STATES = {
  empty: { tone: 'idle', icon: <ExclamationCircleFilled />, label: 'Face not registered' },
  working: { tone: 'idle', icon: <LoadingOutlined />, label: 'Preparing face...' },
  ready: { tone: 'ready', icon: <CheckCircleFilled />, label: 'Face ready' },
  captured: { tone: 'ready', icon: <CheckCircleFilled />, label: 'Face captured' },
  registered: { tone: 'success', icon: <CheckCircleFilled />, label: 'Face registered' },
};

/** Status line under the circular preview. */
export default function FaceStatus({ state }) {
  const current = STATES[state] || STATES.empty;

  return (
    <p className={`face-status-line is-${current.tone}`} role="status" aria-live="polite">
      <span className="face-status-icon">{current.icon}</span>
      {current.label}
    </p>
  );
}
