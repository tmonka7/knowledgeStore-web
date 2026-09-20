import { useRef } from 'react';
import { UploadOutlined } from '@ant-design/icons';
import { ACCEPTED_IMAGE_TYPES, validateImageFile } from '../../lib/faceCrop';

/**
 * Secondary path: pick an existing photo, which then goes through the same
 * crop and confirm flow as the camera.
 */
export default function FaceUpload({ onFile, onError, disabled, label = 'Upload photo instead' }) {
  const inputRef = useRef(null);

  const handleChange = (event) => {
    const file = event.target.files?.[0];
    // Reset so picking the same file twice still fires onChange.
    event.target.value = '';
    if (!file) return;

    const problem = validateImageFile(file);
    if (problem) {
      onError(problem);
      return;
    }
    onError('');
    onFile(file);
  };

  return (
    <>
      <button
        type="button"
        className="face-upload-link"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
      >
        <UploadOutlined /> {label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(',')}
        hidden
        onChange={handleChange}
        aria-label="Choose a face photo to upload"
      />
    </>
  );
}
