import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Avatar, Button, Empty, Input, Spin, message } from 'antd';
import { MessageOutlined, SendOutlined, UserOutlined } from '@ant-design/icons';
import PageHeader from '../components/ui/PageHeader';
import api from '../api';
import { useLanguage } from '../i18n';

const THREAD_POLL_MS = 6000;
const MESSAGE_POLL_MS = 4000;
const SEARCH_DEBOUNCE_MS = 250;

const initials = (name = '') => name
  .split(' ')
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0].toUpperCase())
  .join('') || '?';

const clockTime = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const listTime = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';

  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? clockTime(date)
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

const dayLabel = (value) => {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' });
};

function PersonAvatar({ person, size = 42 }) {
  if (person?.faceImage) {
    return <img className="chat-avatar-img" src={person.faceImage} alt={person.fullName} style={{ width: size, height: size }} />;
  }
  return (
    <Avatar size={size} className="vision-chat-avatar">
      {person ? initials(person.fullName) : <UserOutlined />}
    </Avatar>
  );
}

/**
 * Direct messages.
 *
 * One search box does both jobs, the way a messenger's does: it filters the
 * conversations you already have and, at the same time, looks up people you
 * have not written to yet. Picking a person opens (or creates) the thread.
 *
 * There is no socket in this stack, so the open thread polls for anything
 * newer than its last message and the list polls for previews and unread
 * counts. Both are cheap: a quiet chat returns an empty array.
 */
export default function ChatPage({ user }) {
  const { t } = useLanguage();

  const [threads, setThreads] = useState([]);
  const [people, setPeople] = useState([]);
  const [messages, setMessages] = useState([]);
  const [activeThread, setActiveThread] = useState(null);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const bottomRef = useRef(null);
  // Polling reads the newest timestamp from a ref so the interval never has to
  // be torn down and rebuilt as messages arrive.
  const lastMessageAtRef = useRef(null);
  const activeThreadIdRef = useRef('');

  const loadThreads = useCallback(async () => {
    try {
      const { data } = await api.get('/chat/threads');
      setThreads(data.threads || []);
      setError('');
    } catch (loadError) {
      setError(loadError.response?.data?.message || 'Unable to load conversations.');
    }
  }, []);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  useEffect(() => {
    const timer = setInterval(loadThreads, THREAD_POLL_MS);
    return () => clearInterval(timer);
  }, [loadThreads]);

  // People search, debounced so a fast typist does not fire a request per key.
  useEffect(() => {
    const query = search.trim();
    if (query.length < 2) {
      setPeople([]);
      return undefined;
    }

    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get('/chat/users', { params: { q: query } });
        if (!cancelled) setPeople(data.users || []);
      } catch (searchError) {
        if (!cancelled) setPeople([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [search]);

  const openThread = useCallback(async (thread) => {
    setActiveThread(thread);
    activeThreadIdRef.current = thread.id;
    lastMessageAtRef.current = null;
    setMessages([]);
    setLoadingThread(true);

    try {
      const { data } = await api.get(`/chat/threads/${thread.id}/messages`);
      const list = data.messages || [];
      setMessages(list);
      lastMessageAtRef.current = list.length ? list[list.length - 1].createdAt : null;
      // Opening clears its badge here as well as on the server.
      setThreads((current) => current.map((item) => (item.id === thread.id ? { ...item, unread: 0 } : item)));
    } catch (openError) {
      message.error(openError.response?.data?.message || 'Unable to open that conversation.');
    } finally {
      setLoadingThread(false);
    }
  }, []);

  const startChatWith = async (person) => {
    try {
      const { data } = await api.post('/chat/threads', { userId: person.id });
      setSearch('');
      setPeople([]);
      await loadThreads();
      await openThread(data.thread);
    } catch (startError) {
      message.error(startError.response?.data?.message || 'Unable to start that conversation.');
    }
  };

  // Poll the open thread for anything newer than the last message it holds.
  useEffect(() => {
    if (!activeThread) return undefined;

    const timer = setInterval(async () => {
      const threadId = activeThreadIdRef.current;
      if (!threadId) return;

      try {
        const { data } = await api.get(`/chat/threads/${threadId}/messages`, {
          params: lastMessageAtRef.current ? { after: lastMessageAtRef.current } : {},
        });
        const incoming = data.messages || [];
        if (!incoming.length || activeThreadIdRef.current !== threadId) return;

        lastMessageAtRef.current = incoming[incoming.length - 1].createdAt;
        setMessages((current) => {
          const known = new Set(current.map((item) => item.id));
          return [...current, ...incoming.filter((item) => !known.has(item.id))];
        });
      } catch (pollError) {
        /* A dropped poll is not worth a toast; the next one will catch up. */
      }
    }, MESSAGE_POLL_MS);

    return () => clearInterval(timer);
  }, [activeThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !activeThread) return;

    setSending(true);
    try {
      const { data } = await api.post(`/chat/threads/${activeThread.id}/messages`, { body });
      setMessages((current) => [...current, data.message]);
      lastMessageAtRef.current = data.message.createdAt;
      setDraft('');
      loadThreads();
    } catch (sendError) {
      message.error(sendError.response?.data?.message || 'Unable to send that message.');
    } finally {
      setSending(false);
    }
  };

  const visibleThreads = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return threads;
    return threads.filter((thread) => String(thread.user?.fullName || '').toLowerCase().includes(needle)
      || String(thread.user?.username || '').toLowerCase().includes(needle));
  }, [threads, search]);

  // Someone already in the list does not need to appear twice.
  const newPeople = useMemo(() => {
    const known = new Set(threads.map((thread) => thread.user?.id));
    return people.filter((person) => !known.has(person.id));
  }, [people, threads]);

  const grouped = useMemo(() => {
    const days = [];
    messages.forEach((item) => {
      const label = dayLabel(item.createdAt);
      const last = days[days.length - 1];
      if (last && last.label === label) last.items.push(item);
      else days.push({ label, items: [item] });
    });
    return days;
  }, [messages]);

  return (
    <div className="vision-page">
      <PageHeader title={t('chat')} subtitle="Direct messages between accounts on this app." />

      <div className="vision-chat-layout">
        <aside className="vision-panel vision-panel-tight vision-chat-sidebar">
          <div className="vision-panel-head">
            <h3 className="vision-section-title">{t('messages')}</h3>
            {threads.length > 0 && <span className="vision-cell-muted">{threads.length}</span>}
          </div>

          <Input.Search
            placeholder="Search people or conversations"
            allowClear
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="vision-chat-search"
          />

          <div className="vision-chat-list">
            {error && <Alert type="error" message={error} showIcon />}

            {visibleThreads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className={`vision-chat-item${activeThread?.id === thread.id ? ' is-active' : ''}`}
                onClick={() => openThread(thread)}
              >
                <PersonAvatar person={thread.user} />
                <div className="vision-chat-item-body">
                  <div className="vision-chat-item-row">
                    <span className="vision-chat-item-name">{thread.user?.fullName}</span>
                    <span className="vision-chat-item-time">{listTime(thread.lastMessageAt)}</span>
                  </div>
                  <div className="vision-chat-item-row">
                    <span className="vision-chat-item-preview">
                      {thread.lastMessageSenderId === user?.id && thread.lastMessagePreview ? 'You: ' : ''}
                      {thread.lastMessagePreview || 'No messages yet'}
                    </span>
                    {thread.unread > 0 && <span className="vision-badge is-blue">{thread.unread}</span>}
                  </div>
                </div>
              </button>
            ))}

            {search.trim().length >= 2 && (
              <>
                <div className="chat-list-heading">
                  People
                  {searching && <Spin size="small" />}
                </div>

                {!newPeople.length && !searching && (
                  <p className="vision-cell-muted chat-list-note">No other account matches that.</p>
                )}

                {newPeople.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    className="vision-chat-item"
                    onClick={() => startChatWith(person)}
                  >
                    <PersonAvatar person={person} />
                    <div className="vision-chat-item-body">
                      <div className="vision-chat-item-row">
                        <span className="vision-chat-item-name">{person.fullName}</span>
                      </div>
                      <span className="vision-chat-item-preview">@{person.username}</span>
                    </div>
                  </button>
                ))}
              </>
            )}

            {!visibleThreads.length && search.trim().length < 2 && (
              <p className="vision-cell-muted chat-list-note">
                No conversations yet. Search for someone above to start one.
              </p>
            )}
          </div>
        </aside>

        <section className="vision-panel vision-panel-tight vision-chat-thread">
          {!activeThread ? (
            <div className="vision-empty">
              <MessageOutlined />
              <div className="vision-chat-empty-title">No conversation open</div>
              <div>Pick someone from the list, or search for them by name.</div>
            </div>
          ) : (
            <>
              <div className="vision-chat-thread-head">
                <div className="vision-chat-thread-user">
                  <PersonAvatar person={activeThread.user} />
                  <div>
                    <div className="vision-chat-thread-name">{activeThread.user?.fullName}</div>
                    <div className="vision-chat-thread-status">
                      @{activeThread.user?.username}
                      {activeThread.user?.email ? ` · ${activeThread.user.email}` : ''}
                    </div>
                  </div>
                </div>
              </div>

              <div className="vision-chat-messages">
                {loadingThread ? (
                  <div className="vision-empty"><Spin /></div>
                ) : !messages.length ? (
                  <Empty
                    description={`Say hello to ${activeThread.user?.fullName || 'them'}`}
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                ) : (
                  grouped.map((day) => (
                    <div key={day.label}>
                      <div className="chat-day-divider"><span>{day.label}</span></div>
                      {day.items.map((item) => (
                        <div key={item.id} className={`vision-chat-row${item.mine ? ' is-me' : ''}`}>
                          <div className={`vision-chat-bubble${item.mine ? ' is-me' : ''}`}>
                            <div className="vision-chat-bubble-text">{item.body}</div>
                            <div className="vision-chat-bubble-time">
                              {clockTime(item.createdAt)}
                              {item.mine && <span className="chat-receipt">{item.readAt ? ' ✓✓' : ' ✓'}</span>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))
                )}
                <div ref={bottomRef} />
              </div>

              <div className="vision-chat-composer">
                <Input.TextArea
                  rows={1}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={t('typeMessage')}
                  autoSize={{ minRows: 1, maxRows: 4 }}
                  className="vision-chat-composer-input"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      send();
                    }
                  }}
                />
                <Button
                  type="primary"
                  className="vision-btn-primary"
                  icon={<SendOutlined />}
                  loading={sending}
                  disabled={!draft.trim()}
                  onClick={send}
                >
                  {t('send')}
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
