import { useEffect, useRef } from 'react';
import {
  AudioMutedOutlined,
  CompressOutlined,
  DesktopOutlined,
  ExpandOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { useLanguage } from '../../i18n';

const initialsOf = (name) => String(name || '?')
  .trim()
  .split(/\s+/)
  .slice(0, 2)
  .map((part) => part[0])
  .join('')
  .toUpperCase();

/**
 * One participant.
 *
 * The stream is attached through a ref rather than a prop: srcObject holds a
 * live MediaStream, which React cannot set as an attribute, so binding it in
 * JSX silently does nothing at all.
 */
export default function VideoTile({
  stream,
  label,
  isSelf = false,
  state = {},
  sharing = false,
  recording = false,
  connecting = false,
  spotlit = false,
  onToggleSpotlight,
}) {
  const { t } = useLanguage();
  const videoRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // Reassigning the same stream restarts playback and makes the tile blink,
    // and this effect reruns whenever the parent does.
    if (video.srcObject !== (stream || null)) video.srcObject = stream || null;
  }, [stream]);

  const cameraOff = isSelf ? state.cameraOff : Boolean(state.cameraOff);
  const blank = !stream || (cameraOff && !sharing);

  const person = `${label}${isSelf ? ' (you)' : ''}`;
  const spotlightLabel = spotlit
    ? t('exitSpotlightNamed', { name: person })
    : t('spotlightNamed', { name: person });

  return (
    <div
      className={[
        'meeting-tile',
        isSelf ? 'is-self' : '',
        sharing ? 'is-sharing' : '',
        spotlit ? 'is-spotlit' : '',
      ].filter(Boolean).join(' ')}
      // Double-click is the gesture people already expect from every other
      // call app, but it is invisible and unreachable from a keyboard — hence
      // the button in the bar, which is the same action with a label on it.
      onDoubleClick={onToggleSpotlight}
    >
      <video
        ref={videoRef}
        className={blank ? 'meeting-tile-video is-hidden' : 'meeting-tile-video'}
        autoPlay
        playsInline
        /* Your own tile is always silent. Playing your own microphone back
           through the speakers is a feedback loop, not a monitor. */
        muted={isSelf}
      />

      {blank && (
        <div className="meeting-tile-blank">
          <span className="meeting-tile-initials">{initialsOf(label)}</span>
          {connecting && <span className="meeting-tile-connecting">Connecting…</span>}
        </div>
      )}

      <div className="meeting-tile-bar">
        <span className="meeting-tile-name">{label}{isSelf ? ' (you)' : ''}</span>
        <span className="meeting-tile-icons">
          {sharing && <DesktopOutlined title="Sharing their screen" />}
          {state.muted && <AudioMutedOutlined title="Microphone off" />}
          {cameraOff && !sharing && <VideoCameraOutlined className="is-off" title="Camera off" />}

          {onToggleSpotlight && (
            <button
              type="button"
              className="meeting-tile-spot"
              title={spotlightLabel}
              aria-label={spotlightLabel}
              aria-pressed={spotlit}
              onClick={onToggleSpotlight}
              // The tile below is listening for double-clicks, and two quick
              // presses of this button would otherwise be one of them —
              // spotlighting and then immediately undoing it.
              onDoubleClick={(event) => event.stopPropagation()}
            >
              {spotlit ? <CompressOutlined /> : <ExpandOutlined />}
            </button>
          )}
        </span>
      </div>

      {recording && <span className="meeting-tile-recording">REC</span>}
    </div>
  );
}
