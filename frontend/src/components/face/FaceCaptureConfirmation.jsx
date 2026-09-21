import { Button } from 'antd';
import { CheckCircleFilled, CloseCircleFilled, ReloadOutlined } from '@ant-design/icons';
import { useLanguage } from '../../i18n';

/** Confirmation step: the cropped face plus the checks it passed. */
export default function FaceCaptureConfirmation({ image, checks, saving, onRetake, onConfirm }) {
  const { t } = useLanguage();
  return (
    <div className="face-confirm">
      <div className="face-confirm-preview">
        <img src={image} alt={t('capturedFace')} />
      </div>

      <ul className="face-confirm-checks">
        {checks.map((check) => (
          <li key={check.label} className={check.passed ? 'is-passed' : 'is-failed'}>
            {check.passed ? <CheckCircleFilled /> : <CloseCircleFilled />}
            <span>{check.label}</span>
          </li>
        ))}
      </ul>

      <div className="face-modal-actions">
        <Button className="vision-btn-ghost" icon={<ReloadOutlined />} onClick={onRetake} disabled={saving}>
          {t('retake')}
        </Button>
        <Button type="primary" className="vision-btn-primary" onClick={onConfirm} loading={saving}>
          {t('useThisFace')}
        </Button>
      </div>
    </div>
  );
}
