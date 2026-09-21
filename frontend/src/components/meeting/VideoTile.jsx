import { useEffect, useRef } from 'react';
import { AudioMutedOutlined, DesktopOutlined, VideoCameraOutlined } from '@ant-design/icons';

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
}) {
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

  return (
    <div className={`meeting-tile${isSelf ? ' is-self' : ''}${sharing ? ' is-sharing' : ''}`}>
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
        </span>
      </div>

      {recording && <span className="meeting-tile-recording">REC</span>}
    </div>
  );
}
