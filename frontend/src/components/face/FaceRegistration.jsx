import { useState } from 'react';
import { Typography } from 'antd';
import { CameraOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import CameraRegistrationModal from './CameraRegistrationModal';
import FacePreview from './FacePreview';
import FaceStatus from './FaceStatus';
import { useLanguage } from '../../i18n';

const { Text } = Typography;

/**
 * Face Photo section of the registration form.
 *
 * Owns the captured face for the form and opens the capture dialog. A face is
 * taken from the camera only — a photo file could be anyone's photograph, so
 * none is accepted. `onChange` receives { descriptor, faceImage } or null.
 */
export default function FaceRegistration({ onChange, error, optional = false }) {
  const { t } = useLanguage();
  const [face, setFace] = useState(null);
  const [open, setOpen] = useState(false);

  const complete = ({ descriptor, faceImage }) => {
    setFace({ descriptor, faceImage });
    onChange({ descriptor, faceImage });
    setOpen(false);
  };

  const clear = () => {
    setFace(null);
    onChange(null);
  };

  const registered = Boolean(face);

  return (
    <section className={`face-section${error ? ' has-error' : ''}`} aria-labelledby="face-section-title">
      <h3 className="face-section-title" id="face-section-title">{t('facePhoto')}</h3>
      {optional && (
        <Text type="secondary" className="face-section-hint">{t('faceOptionalHelp')}</Text>
      )}

      <FacePreview
        image={face?.faceImage}
        registered={registered}
        busy={false}
        onOpenCamera={() => setOpen(true)}
      />

      <FaceStatus state={registered ? 'registered' : optional ? 'optional' : 'empty'} />

      <div className="face-section-actions">
        <button type="button" className="face-action-btn" onClick={() => setOpen(true)}>
          {registered ? <ReloadOutlined /> : <CameraOutlined />}
          {registered ? t('changeFace') : t('registerFace')}
        </button>
        {/* Offered only once there is something to remove, and only where the
            face is optional — elsewhere removing it would leave the form in a
            state it will not submit from. */}
        {optional && registered && (
          <button type="button" className="face-action-btn" onClick={clear}>
            <DeleteOutlined />
            {t('removeFace')}
          </button>
        )}
      </div>

      {error && <Text type="danger" className="face-section-error">{error}</Text>}

      <CameraRegistrationModal
        open={open}
        mode="camera"
        onCancel={() => setOpen(false)}
        onComplete={complete}
      />
    </section>
  );
}
