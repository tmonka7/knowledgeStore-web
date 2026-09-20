import { CameraOutlined, CheckCircleFilled, LoadingOutlined } from '@ant-design/icons';

/** Neutral face silhouette shown before anything is captured. */
function FaceSilhouette() {
  return (
    <svg className="face-silhouette" viewBox="0 0 120 130" fill="none" aria-hidden="true">
      <path
        d="M60 26c-19 0-27 14-26 33 1 19 11 38 26 41 15-3 25-22 26-41 1-19-7-33-26-33Z"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path d="M46 58q7-5 14 0M60 58q7-5 14 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M60 64v14l-5 5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M50 92q10 7 20 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path
        d="M22 116c4-15 18-23 38-23s34 8 38 23"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  );
}

/**
 * Circular face area with the camera button fixed to its lower-right edge.
 * `registered` swaps the silhouette for the captured image and adds the check.
 */
export default function FacePreview({ image, registered, busy, onOpenCamera }) {
  return (
    <div className={`face-circle-wrap${registered ? ' is-registered' : ''}`}>
      <div className="face-circle">
        <span className="face-circle-ring" aria-hidden="true" />
        {image ? (
          <img src={image} alt="Your registered face" className="face-circle-image" />
        ) : (
          <FaceSilhouette />
        )}
        {busy && (
          <span className="face-circle-busy" aria-hidden="true"><LoadingOutlined /></span>
        )}
        {registered && !busy && (
          <span className="face-circle-check" aria-hidden="true"><CheckCircleFilled /></span>
        )}
      </div>

      <button
        type="button"
        className="face-circle-camera"
        onClick={onOpenCamera}
        disabled={busy}
        aria-label="Register face"
      >
        <CameraOutlined />
      </button>
    </div>
  );
}
