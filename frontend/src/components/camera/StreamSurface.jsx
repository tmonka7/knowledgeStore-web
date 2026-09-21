import { useEffect, useState } from 'react';
import { VideoCameraOutlined } from '@ant-design/icons';
import { useLanguage } from '../../i18n';

/**
 * The stream itself, in whichever element can actually show it.
 *
 * With detection off this stays on the original <iframe>, which copes with
 * camera viewer pages. With detection on it switches to a <video> or <img>,
 * because a cross-origin iframe exposes no pixels to read.
 *
 * The crossOrigin dance is the awkward part. A clean (readable) canvas needs
 * crossOrigin="anonymous", but that turns the request into a CORS request, so
 * a camera that sends no Access-Control-Allow-Origin fails to load entirely
 * instead of merely being unreadable. Losing the picture is worse than losing
 * the boxes, so a failed CORS load is retried without the attribute: the
 * stream comes back, the canvas is tainted, and the detection loop reports
 * BLOCKED_BY_CORS.
 */
export default function StreamSurface({
  camera,
  mediaKind,
  detecting,
  sourceRef,
  onReady,
  onError,
}) {
  const { t } = useLanguage();
  // 'cors' -> try readable; 'plain' -> picture only; 'failed' -> neither worked.
  const [mode, setMode] = useState('cors');

  // A new address (or leaving detection) deserves a fresh attempt at a
  // readable stream; otherwise one bad camera would poison the next.
  useEffect(() => {
    setMode('cors');
  }, [camera.address, detecting]);

  if (!detecting) {
    return <iframe src={camera.address} title={`${camera.name} live view`} allow="autoplay; fullscreen" />;
  }

  if (mediaKind === 'none' || mode === 'failed') {
    return (
      <div className="vision-live-unavailable">
        <VideoCameraOutlined />
        <span>
          {mediaKind === 'none'
            ? t('detectionNeedsHttpStream')
            : t('unplayableStream')}
        </span>
      </div>
    );
  }

  const handleError = () => {
    if (mode === 'cors') {
      // Most likely a missing ACAO header. Fall back to a picture-only stream.
      setMode('plain');
      return;
    }
    setMode('failed');
    onError?.();
  };

  const shared = {
    // React omits the attribute entirely for undefined, which is what 'plain' needs.
    crossOrigin: mode === 'cors' ? 'anonymous' : undefined,
    className: 'vision-live-media is-detecting',
    onError: handleError,
  };

  // `key` forces a fresh element on the CORS retry — reusing the node would
  // keep the old crossOrigin state on the already-failed request.
  return mediaKind === 'image' ? (
    <img
      {...shared}
      key={`img-${mode}`}
      ref={sourceRef}
      src={camera.address}
      alt={`${camera.name} live view`}
      onLoad={onReady}
    />
  ) : (
    <video
      {...shared}
      key={`video-${mode}`}
      ref={sourceRef}
      src={camera.address}
      autoPlay
      muted
      playsInline
      aria-label={`${camera.name} live view`}
      onLoadedData={onReady}
    />
  );
}
