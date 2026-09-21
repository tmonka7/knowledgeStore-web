import { useEffect, useMemo, useState } from 'react';
import { Alert, Avatar, Button, Input, message } from 'antd';
import { MessageOutlined, PlusOutlined, SendOutlined } from '@ant-design/icons';
import PageHeader from '../components/ui/PageHeader';
import api from '../api';
import { useLanguage } from '../i18n';

export default function ChatPage() {
  const { t } = useLanguage();
  const [conversations, setConversations] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState('');
  const [messageText, setMessageText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isCreatingChat, setIsCreatingChat] = useState(false);

  const fetchConversations = async () => {
    setLoading(true);
    setError('');

    try {
      const { data } = await api.get('/chat/conversations');
      const nextConversations = data.conversations || [];
      setConversations(nextConversations);
      if (!selectedConversationId && nextConversations.length) {
        setSelectedConversationId(nextConversations[0].id);
      }
    } catch (fetchError) {
      const messageText = fetchError.response?.data?.message || t('unableToLoadConversationHistory');
      setError(messageText);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConversations();
  }, []);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) || conversations[0] || null,
    [conversations, selectedConversationId],
  );

  const handleCreateConversation = async () => {
    setIsCreatingChat(true);
    try {
      const { data } = await api.post('/chat/conversations', {
        name: `New chat ${conversations.length + 1}`,
      });
      const nextConversation = data.conversation;
      setConversations((current) => [nextConversation, ...current]);
      setSelectedConversationId(nextConversation.id);
      setMessageText('');
      message.success(t('newChatCreated'));
    } catch (createError) {
      message.error(createError.response?.data?.message || t('unableToCreateChat'));
    } finally {
      setIsCreatingChat(false);
    }
  };

  const handleSendMessage = async () => {
    if (!selectedConversationId || !messageText.trim()) {
      return;
    }

    setIsSending(true);
    try {
      const { data } = await api.post(`/chat/conversations/${selectedConversationId}/messages`, {
        text: messageText.trim(),
      });

      const nextConversation = data.conversation;
      setConversations((current) => current.map((entry) => entry.id === nextConversation.id ? nextConversation : entry));
      setMessageText('');
      setSelectedConversationId(nextConversation.id);
      message.success(t('messageSent'));
    } catch (sendError) {
      message.error(sendError.response?.data?.message || t('unableToSendMessage'));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="vision-page">
      <PageHeader
        title={t('chat')}
        subtitle={t('chatSubtitle')}
      />

      <div className="vision-chat-layout">
        <aside className="vision-panel vision-panel-tight vision-chat-sidebar">
          <div className="vision-panel-head">
            <h3 className="vision-section-title">{t('messages')}</h3>
            <Button
              type="primary"
              className="vision-btn-primary"
              icon={<PlusOutlined />}
              loading={isCreatingChat}
              onClick={handleCreateConversation}
            >
              {t('newChat')}
            </Button>
          </div>

          <Input.Search placeholder={t('searchConversations')} allowClear className="vision-chat-search" />

          <div className="vision-chat-list">
            {loading && conversations.length === 0 ? (
              <div className="vision-empty">{t('loadingConversations')}</div>
            ) : (
              conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className={`vision-chat-item${selectedConversationId === conversation.id ? ' is-active' : ''}`}
                  onClick={() => setSelectedConversationId(conversation.id)}
                >
                  <Avatar
                    size={42}
                    className="vision-chat-avatar"
                    style={conversation.accent ? { background: conversation.accent } : undefined}
                  >
                    {conversation.avatar || 'AI'}
                  </Avatar>

                  <div className="vision-chat-item-body">
                    <div className="vision-chat-item-row">
                      <span className="vision-chat-item-name">{conversation.name}</span>
                      <span className="vision-chat-item-time">{conversation.lastSeen}</span>
                    </div>
                    <div className="vision-chat-item-row">
                      <span className="vision-chat-item-role">{conversation.role}</span>
                      {conversation.unread > 0 && (
                        <span className="vision-badge is-blue">{conversation.unread}</span>
                      )}
                    </div>
                    <span className="vision-chat-item-preview">{conversation.preview}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="vision-panel vision-panel-tight vision-chat-thread">
          {error && !selectedConversation ? (
            <Alert type="error" message={error} showIcon />
          ) : selectedConversation ? (
            <>
              <div className="vision-chat-thread-head">
                <div className="vision-chat-thread-user">
                  <Avatar
                    size={42}
                    className="vision-chat-avatar"
                    style={selectedConversation.accent ? { background: selectedConversation.accent } : undefined}
                  >
                    {selectedConversation.avatar || 'AI'}
                  </Avatar>
                  <div>
                    <div className="vision-chat-thread-name">{selectedConversation.name}</div>
                    <div className="vision-chat-thread-status">{selectedConversation.role}</div>
                  </div>
                </div>
                <Button className="vision-btn-ghost">{t('viewProfile')}</Button>
              </div>

              <div className="vision-chat-messages">
                {(selectedConversation.messages || []).length === 0 ? (
                  <div className="vision-empty">
                    <MessageOutlined />
                    <div className="vision-chat-empty-title">{t('startNewConversation')}</div>
                    <div>{t('writeFirstMessage')}</div>
                  </div>
                ) : (
                  (selectedConversation.messages || []).map((messageItem) => (
                    <div
                      key={messageItem.id}
                      className={`vision-chat-row${messageItem.sender === 'me' ? ' is-me' : ''}`}
                    >
                      <div className={`vision-chat-bubble${messageItem.sender === 'me' ? ' is-me' : ''}`}>
                        <div className="vision-chat-bubble-text">{messageItem.text}</div>
                        <div className="vision-chat-bubble-time">{messageItem.time}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="vision-chat-composer">
                <Input.TextArea
                  rows={1}
                  value={messageText}
                  onChange={(event) => setMessageText(event.target.value)}
                  placeholder={t('typeMessage')}
                  autoSize={{ minRows: 1, maxRows: 4 }}
                  className="vision-chat-composer-input"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      handleSendMessage();
                    }
                  }}
                />
                <Button
                  type="primary"
                  className="vision-btn-primary"
                  icon={<SendOutlined />}
                  loading={isSending}
                  onClick={handleSendMessage}
                >
                  {t('send')}
                </Button>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
