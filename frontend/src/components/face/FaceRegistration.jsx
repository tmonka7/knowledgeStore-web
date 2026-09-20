import { useEffect, useState } from 'react';
import { Typography } from 'antd';
import { CameraOutlined, ReloadOutlined } from '@ant-design/icons';
import CameraRegistrationModal from './CameraRegistrationModal';
import FacePreview from './FacePreview';
import FaceStatus from './FaceStatus';
import FaceUpload from './FaceUpload';
import { imageFromFile } from '../../lib/faceCrop';

const { Text } = Typography;

/**
 * Face Photo section of the registration form.
 *
 * Owns the captured face for the form and opens the capture dialog in either
 * camera or upload mode. `onChange` receives { descriptor, faceImage } or null.
 */
export default function FaceRegistration({ onChange, error }) {
  const [face, setFace] = useState(null);
  const [modal, setModal] = useState(null); // { mode, imageSrc }
  const [uploadError, setUploadError] = useState('');
  const [preparing, setPreparing] = useState(false);

  // Object URLs for an uploaded still must not outlive the dialog.
  useEffect(() => () => {
    if (modal?.imageSrc) URL.revokeObjectURL(modal.imageSrc);
  }, [modal]);

  const closeModal = () => {
    setModal((current) => {
      if (current?.imageSrc) URL.revokeObjectURL(current.imageSrc);
      return null;
    });
  };

  const openCamera = () => {
    setUploadError('');
    setModal({ mode: 'camera', imageSrc: '' });
  };

  const openUpload = async (file) => {
    setPreparing(true);
    try {
      // Decode first so the dialog never opens on an unreadable file.
      await imageFromFile(file);
      setModal({ mode: 'image', imageSrc: URL.createObjectURL(file) });
    } catch (caught) {
      setUploadError(caught.message || 'That image could not be opened.');
    } finally {
      setPreparing(false);
    }
  };

  const complete = ({ descriptor, faceImage }) => {
    setFace({ descriptor, faceImage });
    onChange({ descriptor, faceImage });
    closeModal();
  };

  const registered = Boolean(face);
  const problem = uploadError || error;

  return (
    <section className={`face-section${problem ? ' has-error' : ''}`} aria-labelledby="face-section-title">
      <h3 className="face-section-title" id="face-section-title">Face Photo</h3>

      <FacePreview
        image={face?.faceImage}
        registered={registered}
        busy={preparing}
        onOpenCamera={openCamera}
      />

      <FaceStatus state={preparing ? 'working' : registered ? 'registered' : 'empty'} />

      <div className="face-section-actions">
        <button type="button" className="face-action-btn" onClick={openCamera} disabled={preparing}>
          {registered ? <ReloadOutlined /> : <CameraOutlined />}
          {registered ? 'Change Face' : 'Register Face'}
        </button>
        <FaceUpload onFile={openUpload} onError={setUploadError} disabled={preparing} />
      </div>

      {problem && <Text type="danger" className="face-section-error">{problem}</Text>}

      <CameraRegistrationModal
        open={Boolean(modal)}
        mode={modal?.mode || 'camera'}
        imageSrc={modal?.imageSrc}
        onCancel={closeModal}
        onComplete={complete}
      />
    </section>
  );
}
