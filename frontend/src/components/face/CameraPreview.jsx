import { forwardRef } from 'react';
import { Button } from 'antd';
import { CameraOutlined, LoadingOutlined, VideoCameraOutlined } from '@ant-design/icons';

/**
 * The dark 4:3 stage. Renders the live stream, a still image (upload flow),
 * the permission prompt or a camera error, and slots children (the crop frame)
 * on top of whichever is showing.
 */
const CameraPreview = forwardRef(function CameraPreview({
  mode,
  imageSrc,
  starting,
  cameraError,
  onAllowCamera,
  children,
}, videoRef) {
  if (cameraError) {
    return (
      <div className="face-stage is-message">
        <div className="face-stage-message">
          <span className="face-stage-icon"><VideoCameraOutlined /></span>
          <h4>{cameraError.title}</h4>
          <p>{cameraError.hint}</p>
          {cameraError.code === 'PERMISSION_DENIED' && (
            <Button type="primary" className="vision-btn-primary" icon={<CameraOutlined />} onClick={onAllowCamera}>
              Allow Camera
            </Button>
          )}
          {cameraError.code !== 'PERMISSION_DENIED' && (
            <Button className="vision-btn-ghost" onClick={onAllowCamera}>Try again</Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="face-stage">
      {mode === 'image' ? (
        <img src={imageSrc} alt="Uploaded face" className="face-stage-media" />
      ) : (
        <video
          ref={videoRef}
          className="face-stage-media is-mirrored"
          autoPlay
          muted
          playsInline
          aria-label="Live camera preview"
        />
      )}

      {starting && (
        <div className="face-stage-loading">
          <LoadingOutlined />
          <span>Starting camera...</span>
        </div>
      )}

      {children}
    </div>
  );
});

export default CameraPreview;
