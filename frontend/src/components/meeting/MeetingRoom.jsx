import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Modal, Spin, Tooltip } from 'antd';
import {
  AudioMutedOutlined,
  AudioOutlined,
  DesktopOutlined,
  HighlightOutlined,
  LogoutOutlined,
  MessageOutlined,
  StopOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import useMeetingRoom from './useMeetingRoom';
import useRecorder from './useRecorder';
import VideoTile from './VideoTile';
import MeetingChat from './MeetingChat';
import MeetingWhiteboard from './MeetingWhiteboard';
import { useLanguage } from '../../i18n';

const formatDuration = (ms) => {
  const total = Math.floor(ms / 1000);
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
};

/**
 * Being in a meeting.
 *
 * Everything on this screen is driven by two hooks: useMeetingRoom holds the
 * connections and the roster, useRecorder turns what is on screen into a file.
 * This component is the layout and the buttons.
 */
export default function MeetingRoom({ user, meeting, onLeave, onMeetingChanged }) {
  const { t } = useLanguage();
  const room = useMeetingRoom({ meetingId: meeting.id, active: true });
  const [chatOpen, setChatOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [seenChat, setSeenChat] = useState(0);
  // Who is on the big tile. Held as a key rather than as the tile itself, so a
  // participant who leaves takes the spotlight with them instead of freezing a
  // stale copy of their last frame on the stage.
  const [spotlitKey, setSpotlitKey] = useState(null);

  const tiles = useMemo(() => [
    {
      key: 'self',
      // Sharing replaces what everyone sees of you, so your own tile shows the
      // screen too — otherwise you cannot tell what you are presenting.
      stream: room.screenStream || room.localStream,
      audioStream: room.localStream,
      label: user?.fullName || user?.username || 'You',
      isSelf: true,
      sharing: room.sharing,
      state: { muted: !room.micOn, cameraOff: !room.camOn },
    },
    ...room.peers.map((peer) => ({
      key: peer.id,
      stream: room.streams[peer.id],
      label: peer.name || 'Participant',
      state: peer.state || {},
      sharing: Boolean(peer.state?.sharing),
      recording: Boolean(peer.state?.recording),
      connecting: !room.streams[peer.id]?.getTracks().length,
    })),
  ], [room.screenStream, room.localStream, room.sharing, room.micOn, room.camOn, room.peers, room.streams, user]);

  const recorder = useRecorder({
    meetingId: meeting.id,
    tiles,
    onSaved: onMeetingChanged,
  });

  // Everyone in the room is told, and it is the room that tells them — this is
  // the same flag the other participants' tiles are lit from.
  useEffect(() => {
    room.setRecording(recorder.recording);
  }, [recorder.recording, room.setRecording]);

  useEffect(() => {
    if (chatOpen) setSeenChat(room.chat.length);
  }, [chatOpen, room.chat.length]);

  const unreadChat = Math.max(0, room.chat.length - seenChat);
  const someoneElseRecording = room.peers.some((peer) => peer.state?.recording);

  /*
   * The spotlight, resolved fresh each render.
   *
   * Looked up in `tiles` rather than trusted from state: the person on the big
   * tile can leave the call, and a key that no longer matches anybody simply
   * finds nothing and drops the room back to the grid on its own.
   *
   * While the whiteboard is up the stage belongs to the board and the faces are
   * a strip along the bottom, so the layout is not applied — but the choice is
   * remembered, the tile still shows as picked, and it takes effect the moment
   * the board is closed.
   */
  const spotlit = boardOpen ? null : tiles.find((tile) => tile.key === spotlitKey) || null;
  const others = spotlit ? tiles.filter((tile) => tile.key !== spotlit.key) : tiles;

  const toggleSpotlight = (key) => {
    setSpotlitKey((current) => (current === key ? null : key));
  };

  const renderTile = (tile) => (
    <VideoTile
      key={tile.key}
      stream={tile.stream}
      label={tile.label}
      isSelf={tile.isSelf}
      state={tile.state}
      sharing={tile.sharing}
      recording={tile.recording}
      connecting={tile.connecting}
      spotlit={tile.key === spotlitKey}
      onToggleSpotlight={() => toggleSpotlight(tile.key)}
    />
  );

  const leave = () => {
    if (recorder.recording) recorder.stop();
    room.leave();
    onLeave();
  };

  const confirmLeave = () => {
    if (!recorder.recording) {
      leave();
      return;
    }
    Modal.confirm({
      title: 'Stop recording and leave?',
      content: 'The recording will be saved to this meeting before you go.',
      okText: 'Leave',
      onOk: leave,
    });
  };

  if (room.phase === 'ended' || room.phase === 'error') {
    return (
      <div className="vision-page vision-stack">
        <section className="vision-panel meeting-exit">
          <h2>{room.phase === 'ended' ? 'This meeting has ended' : 'Could not join'}</h2>
          <p className="vision-cell-muted">{room.notice || room.error}</p>
          <Button type="primary" className="vision-btn-primary" onClick={onLeave}>
            Back to meetings
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div className="meeting-room">
      <header className="meeting-room-head">
        <div>
          <h2 className="meeting-room-title">{meeting.title}</h2>
          <span className="vision-cell-muted">
            {tiles.length} in the call
            {room.phase === 'reconnecting' && ' · reconnecting…'}
          </span>
        </div>

        <div className="meeting-room-head-actions">
          {recorder.recording && (
            <span className="meeting-rec-pill">
              <span className="meeting-rec-dot" />
              Recording {formatDuration(recorder.elapsedMs)}
            </span>
          )}
          {recorder.saving && <span className="vision-cell-muted"><Spin size="small" /> Saving…</span>}
        </div>
      </header>

      {/* A recording is not something to discover afterwards, so it is said
          plainly at the top of the room for as long as one is running. */}
      {someoneElseRecording && (
        <Alert
          type="warning"
          showIcon
          message="This meeting is being recorded by someone in the call."
        />
      )}

      {room.notice && <Alert type="info" showIcon message={room.notice} />}
      {room.error && <Alert type="error" showIcon message={room.error} />}
      {recorder.error && (
        <Alert type="error" showIcon closable message={recorder.error} onClose={recorder.clearError} />
      )}

      <div className={`meeting-body${chatOpen ? ' with-chat' : ''}${boardOpen ? ' with-board' : ''}`}>
        {/* The board takes the stage when it is open and the faces become a
            rail beside it: a whiteboard squeezed in next to a video grid is too
            small to write on, which is the only thing it is for. */}
        <div className="meeting-stage">
          {boardOpen && (
            <MeetingWhiteboard whiteboard={room.whiteboard} onClose={() => setBoardOpen(false)} />
          )}

          {spotlit ? (
            <div className="meeting-spotlight-layout">
              <div className="meeting-spotlight">{renderTile(spotlit)}</div>
              {others.length > 0 && <div className="meeting-rail">{others.map(renderTile)}</div>}
            </div>
          ) : (
            <div className={`meeting-grid count-${Math.min(tiles.length, 9)}`}>
              {room.phase === 'connecting' && !tiles.length && <Spin />}
              {tiles.map(renderTile)}
            </div>
          )}
        </div>

        {chatOpen && (
          <MeetingChat
            messages={room.chat}
            selfUserId={user?.id}
            onSend={room.sendChat}
          />
        )}
      </div>

      <footer className="meeting-controls">
        <Tooltip title={room.micOn ? 'Mute' : 'Unmute'}>
          <Button
            shape="circle"
            size="large"
            aria-label={room.micOn ? 'Mute microphone' : 'Unmute microphone'}
            className={room.micOn ? 'meeting-control' : 'meeting-control is-off'}
            icon={room.micOn ? <AudioOutlined /> : <AudioMutedOutlined />}
            onClick={room.toggleMic}
          />
        </Tooltip>

        <Tooltip title={room.camOn ? 'Turn camera off' : 'Turn camera on'}>
          <Button
            shape="circle"
            size="large"
            aria-label={room.camOn ? 'Turn camera off' : 'Turn camera on'}
            className={room.camOn ? 'meeting-control' : 'meeting-control is-off'}
            icon={<VideoCameraOutlined />}
            onClick={room.toggleCamera}
          />
        </Tooltip>

        <Tooltip title={room.sharing ? 'Stop sharing' : 'Share your screen'}>
          <Button
            shape="circle"
            size="large"
            aria-label={room.sharing ? 'Stop sharing your screen' : 'Share your screen'}
            className={room.sharing ? 'meeting-control is-active' : 'meeting-control'}
            icon={<DesktopOutlined />}
            onClick={room.toggleShare}
          />
        </Tooltip>

        <Tooltip title={recorder.recording ? 'Stop recording' : 'Record this meeting'}>
          <Button
            shape="circle"
            size="large"
            aria-label={recorder.recording ? 'Stop recording' : 'Record this meeting'}
            className={recorder.recording ? 'meeting-control is-recording' : 'meeting-control'}
            loading={recorder.saving}
            icon={recorder.recording ? <StopOutlined /> : <span className="meeting-rec-dot" />}
            onClick={recorder.recording ? recorder.stop : recorder.start}
          />
        </Tooltip>

        <Tooltip title={boardOpen ? t('closeWhiteboard') : t('openWhiteboard')}>
          {/* A dot rather than a count: the board has no unread strokes, only
              the fact that somebody has been drawing on it while it was shut. */}
          <Badge dot={!boardOpen && room.whiteboard.strokes.length > 0}>
            <Button
              shape="circle"
              size="large"
              aria-label={boardOpen ? t('closeWhiteboard') : t('openWhiteboard')}
              className={boardOpen ? 'meeting-control is-active' : 'meeting-control'}
              icon={<HighlightOutlined />}
              onClick={() => setBoardOpen((open) => !open)}
            />
          </Badge>
        </Tooltip>

        <Tooltip title="In-call messages">
          <Badge count={chatOpen ? 0 : unreadChat} size="small">
            <Button
              shape="circle"
              size="large"
              aria-label="In-call messages"
              className={chatOpen ? 'meeting-control is-active' : 'meeting-control'}
              icon={<MessageOutlined />}
              onClick={() => setChatOpen((open) => !open)}
            />
          </Badge>
        </Tooltip>

        <Tooltip title="Leave">
          <Button
            shape="circle"
            size="large"
            danger
            type="primary"
            aria-label="Leave the meeting"
            icon={<LogoutOutlined />}
            onClick={confirmLeave}
          />
        </Tooltip>
      </footer>
    </div>
  );
}
