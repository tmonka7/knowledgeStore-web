import { useEffect, useRef, useState } from 'react';
import { Button, Empty, Input } from 'antd';
import { SendOutlined } from '@ant-design/icons';

const formatTime = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

/** The side conversation. Kept with the meeting, so it is still there afterwards. */
export default function MeetingChat({ messages, selfUserId, onSend }) {
  const [draft, setDraft] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    // Only the last element is scrolled to, so a long history does not drag the
    // whole panel about every time somebody types.
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    onSend(body);
    setDraft('');
  };

  return (
    <aside className="meeting-chat">
      <h4 className="meeting-chat-title">In-call messages</h4>

      <div className="meeting-chat-scroll">
        {!messages.length ? (
          <Empty description="Nothing said yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <ul className="meeting-chat-list">
            {messages.map((message) => (
              <li
                key={message.id}
                className={message.senderId === selfUserId ? 'is-mine' : undefined}
              >
                <div className="meeting-chat-head">
                  <strong>{message.senderName || 'Someone'}</strong>
                  <span className="vision-cell-muted">{formatTime(message.createdAt)}</span>
                </div>
                <p>{message.body}</p>
              </li>
            ))}
          </ul>
        )}
        <div ref={endRef} />
      </div>

      <div className="meeting-chat-composer">
        <Input.TextArea
          rows={2}
          value={draft}
          maxLength={2000}
          onChange={(event) => setDraft(event.target.value)}
          onPressEnter={(event) => {
            // Enter sends, Shift+Enter writes a new line — the convention every
            // other chat box in this app follows.
            if (event.shiftKey) return;
            event.preventDefault();
            submit();
          }}
          placeholder="Message everyone in the call"
        />
        <Button
          type="primary"
          className="vision-btn-primary"
          icon={<SendOutlined />}
          onClick={submit}
        >
          Send
        </Button>
      </div>
    </aside>
  );
}
