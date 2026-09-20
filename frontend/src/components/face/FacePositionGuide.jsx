import { CheckCircleFilled, InfoCircleFilled, WarningFilled } from '@ant-design/icons';

const ICONS = {
  success: <CheckCircleFilled />,
  warning: <WarningFilled />,
  idle: <InfoCircleFilled />,
};

/** Live guidance under the camera stage; mirrors the current DIAGNOSIS. */
export default function FacePositionGuide({ diagnosis, busy }) {
  const tone = busy ? 'idle' : diagnosis.tone;

  return (
    <div className={`face-guide is-${tone}`} role="status" aria-live="polite">
      <span className="face-guide-icon">{ICONS[tone]}</span>
      <span className="face-guide-text">
        <strong>{busy ? 'Checking...' : diagnosis.title}</strong>
        <small>{busy ? 'Looking for a face in the frame.' : diagnosis.hint}</small>
      </span>
    </div>
  );
}
