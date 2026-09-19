import { useEffect, useMemo, useState } from 'react';
import { Alert, Avatar, Button, Input, Typography, message } from 'antd';
import api from '../api';

const { Title, Text } = Typography;

export default function ChatPage() {
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
      const messageText = fetchError.response?.data?.message || 'Unable to load conversation history.';
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
      message.success('New chat created');
    } catch (createError) {
      message.error(createError.response?.data?.message || 'Unable to create a new chat.');
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
      message.success('Message sent');
    } catch (sendError) {
      message.error(sendError.response?.data?.message || 'Unable to send message.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="chat-page">
      <div className="chat-layout">
        <aside className="chat-sidebar">
          <div className="chat-sidebar-header">
            <Title level={4} className="chat-title">Messages</Title>
            <Button type="primary" className="chat-new-btn" loading={isCreatingChat} onClick={handleCreateConversation}>
              New chat
            </Button>
          </div>

          <div className="chat-search-wrap">
            <Input.Search placeholder="Search conversations" allowClear className="chat-search" />
          </div>

          <div className="chat-list">
            {loading && conversations.length === 0 ? (
              <div className="chat-empty-state">Loading conversations...</div>
            ) : (
              conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className={`chat-item ${selectedConversationId === conversation.id ? 'chat-item-active' : ''}`}
                  onClick={() => setSelectedConversationId(conversation.id)}
                >
                  <Avatar size={42} style={{ background: conversation.accent || '#4f8ef7' }}>
                    {conversation.avatar || 'AI'}
                  </Avatar>

                  <div className="chat-item-body">
                    <div className="chat-item-row">
                      <span className="chat-item-name">{conversation.name}</span>
                      <span className="chat-item-time">{conversation.lastSeen}</span>
                    </div>
                    <div className="chat-item-row muted-row">
                      <span className="chat-item-role">{conversation.role}</span>
                      {conversation.unread > 0 && <span className="chat-badge">{conversation.unread}</span>}
                    </div>
                    <Text type="secondary" className="chat-item-preview">{conversation.preview}</Text>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="chat-thread">
          {error && !selectedConversation ? (
            <div className="chat-error-shell">
              <Alert type="error" message={error} showIcon />
            </div>
          ) : selectedConversation ? (
            <>
              <div className="chat-thread-header">
                <div className="chat-thread-user">
                  <Avatar size={42} style={{ background: selectedConversation.accent || '#4f8ef7' }}>
                    {selectedConversation.avatar || 'AI'}
                  </Avatar>
                  <div>
                    <div className="chat-thread-name">{selectedConversation.name}</div>
                    <div className="chat-thread-status">{selectedConversation.role}</div>
                  </div>
                </div>
                <Button type="text" className="chat-header-button">View profile</Button>
              </div>

              <div className="chat-messages">
                {(selectedConversation.messages || []).length === 0 ? (
                  <div className="chat-empty-thread">
                    <div className="chat-empty-thread-icon">✦</div>
                    <div className="chat-empty-thread-title">Start a new conversation</div>
                    <div className="chat-empty-thread-subtitle">Write the first message to begin.</div>
                  </div>
                ) : (
                  (selectedConversation.messages || []).map((messageItem) => (
                    <div
                      key={messageItem.id}
                      className={`chat-message-row ${messageItem.sender === 'me' ? 'chat-message-row-me' : ''}`}
                    >
                      <div className={`chat-message ${messageItem.sender === 'me' ? 'chat-message-me' : 'chat-message-other'}`}>
                        <div className="chat-message-text">{messageItem.text}</div>
                        <div className="chat-message-time">{messageItem.time}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="chat-composer">
                <Input.TextArea
                  rows={1}
                  value={messageText}
                  onChange={(event) => setMessageText(event.target.value)}
                  placeholder="Type a message..."
                  autoSize={{ minRows: 1, maxRows: 4 }}
                  className="chat-composer-input"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      handleSendMessage();
                    }
                  }}
                />
                <Button type="primary" className="chat-send-btn" loading={isSending} onClick={handleSendMessage}>
                  Send
                </Button>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
