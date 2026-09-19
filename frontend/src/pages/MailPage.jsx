import { useEffect, useMemo, useState } from 'react';
import { Alert, Avatar, Badge, Button, Input, Typography, message } from 'antd';
import { PaperClipOutlined } from '@ant-design/icons';
import api from '../api';

const formatAttachmentUrl = (attachment) => {
  if (!attachment) return '';
  if (/^https?:\/\//i.test(attachment)) return attachment;

  const apiOrigin = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000/api').replace(/\/api$/, '');
  return `${apiOrigin}${attachment.startsWith('/') ? '' : '/'}${attachment}`;
};

const { Title, Text } = Typography;

export default function MailPage() {
  const [mails, setMails] = useState([]);
  const [selectedMailId, setSelectedMailId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [isSending, setIsSending] = useState(false);

  const fetchInbox = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/mail/inbox');
      const nextMails = data.mails || [];
      setMails(nextMails);
      if (!selectedMailId && nextMails.length) {
        setSelectedMailId(nextMails[0].id);
      }
    } catch (fetchError) {
      setError(fetchError.response?.data?.message || 'Unable to load inbox.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInbox();
  }, []);

  const selectedMail = useMemo(
    () => mails.find((mail) => mail.id === selectedMailId) || mails[0] || null,
    [mails, selectedMailId],
  );

  useEffect(() => {
    if (!selectedMailId || !selectedMail) {
      return;
    }

    const markRead = async () => {
      try {
        const { data } = await api.get(`/mail/${selectedMail.id}`);
        const nextMail = data.mail;
        setMails((current) => current.map((item) => item.id === nextMail.id ? nextMail : item));
      } catch (readError) {
        console.error(readError);
      }
    };

    markRead();
  }, [selectedMailId, selectedMail]);

  const handleDeleteMail = async (mailId) => {
    try {
      await api.delete(`/mail/${mailId}`);
      setMails((current) => current.filter((mail) => mail.id !== mailId));
      if (selectedMailId === mailId) {
        const nextMail = mails.find((mail) => mail.id !== mailId) || null;
        setSelectedMailId(nextMail ? nextMail.id : '');
      }
      message.success('Mail deleted.');
    } catch (deleteError) {
      message.error(deleteError.response?.data?.message || 'Unable to delete mail.');
    }
  };

  const handleSend = async () => {
    if (!composeTo.trim() || !composeSubject.trim() || !composeBody.trim()) {
      message.error('Please complete the recipient, subject, and message.');
      return;
    }

    setIsSending(true);
    try {
      const formData = new FormData();
      formData.append('from', 'admin@knowledge.store');
      formData.append('to', composeTo.trim());
      formData.append('subject', composeSubject.trim());
      formData.append('body', composeBody.trim());
      if (attachmentFile) {
        formData.append('attachment', attachmentFile);
      }

      const { data } = await api.post('/mail', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setMails((current) => [data.mail, ...current]);
      setSelectedMailId(data.mail.id);
      setComposeTo('');
      setComposeSubject('');
      setComposeBody('');
      setAttachmentFile(null);
      message.success('Message sent');
    } catch (sendError) {
      message.error(sendError.response?.data?.message || 'Unable to send the message.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="mail-page">
      <div className="mail-layout">
        <aside className="mail-sidebar">
          <div className="mail-sidebar-header">
            <Title level={4} className="mail-title">Inbox</Title>
            <Button type="primary" className="mail-compose-btn">Compose</Button>
          </div>

          <div className="mail-search-wrap">
            <Input.Search placeholder="Search mail" allowClear className="mail-search" />
          </div>

          <div className="mail-list">
            {loading && mails.length === 0 ? (
              <div className="mail-empty-state">Loading inbox...</div>
            ) : mails.length === 0 ? (
              <div className="mail-empty-state">No mail found.</div>
            ) : (
              mails.map((mail) => (
                <button
                  key={mail.id}
                  type="button"
                  className={`mail-item ${selectedMailId === mail.id ? 'mail-item-active' : ''}`}
                  onClick={() => setSelectedMailId(mail.id)}
                >
                  <div className="mail-item-head">
                    <div className="mail-item-sender">{mail.from}</div>
                    {mail.unread && <Badge status="processing" />}
                  </div>
                  <div className="mail-item-subject">{mail.subject}</div>
                  <div className="mail-item-preview">{mail.preview}</div>
                  <div className="mail-item-meta">
                    <span>{mail.category}</span>
                    <span>{mail.timeLabel}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <main className="mail-content">
          {error && !selectedMail ? (
            <div className="mail-error-shell">
              <Alert type="error" message={error} showIcon />
            </div>
          ) : selectedMail ? (
            <>
              <div className="mail-detail-header">
                <div>
                  <div className="mail-detail-category">{selectedMail.category || 'Inbox'}</div>
                  <Title level={3} className="mail-detail-title">{selectedMail.subject || 'Untitled message'}</Title>
                </div>
                <div className="mail-detail-actions">
                  <Button type="default">Reply</Button>
                  <Button danger onClick={() => handleDeleteMail(selectedMail.id)}>Delete</Button>
                </div>
              </div>

              <div className="mail-detail-meta">
                {(() => {
                  const senderName = String(selectedMail.from || 'Unknown sender').trim();
                  const avatarText = senderName
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((part) => part[0] || '')
                    .join('')
                    .toUpperCase() || 'NA';

                  return (
                    <>
                      <Avatar size={36} style={{ background: '#4f8ef7' }}>{avatarText}</Avatar>
                      <div>
                        <div className="mail-detail-name">{senderName}</div>
                        <div className="mail-detail-address">To: {selectedMail.to || 'Unknown recipient'}</div>
                      </div>
                    </>
                  );
                })()}
                <span className="mail-detail-time">{selectedMail.timeLabel || 'Just now'}</span>
              </div>

              <div className="mail-detail-body" dangerouslySetInnerHTML={{ __html: selectedMail.body || '<p>No content.</p>' }} />
              {selectedMail.attachment && (
                <div className="mail-attachment-row">
                  <span>Attachment:</span>
                  <a href={formatAttachmentUrl(selectedMail.attachment)} target="_blank" rel="noreferrer">
                    {selectedMail.attachmentName || 'Open attachment'}
                  </a>
                </div>
              )}
            </>
          ) : null}

          <div className="mail-compose-panel">
            <div className="mail-compose-title">New message</div>
            <Input
              placeholder="To"
              value={composeTo}
              onChange={(event) => setComposeTo(event.target.value)}
              className="mail-compose-input"
            />
            <Input
              placeholder="Subject"
              value={composeSubject}
              onChange={(event) => setComposeSubject(event.target.value)}
              className="mail-compose-input"
            />
            <Input.TextArea
              rows={5}
              placeholder="Write your message..."
              value={composeBody}
              onChange={(event) => setComposeBody(event.target.value)}
              className="mail-compose-textarea"
            />
            <div className="mail-attachment-controls">
              <label className="mail-file-picker" htmlFor="mail-attachment-upload">
                <PaperClipOutlined />
                <span>{attachmentFile ? 'Change file' : 'Attach file'}</span>
              </label>
              <input
                id="mail-attachment-upload"
                type="file"
                className="mail-file-input"
                onChange={(event) => setAttachmentFile(event.target.files?.[0] || null)}
              />
              {attachmentFile && <span className="mail-file-name">{attachmentFile.name}</span>}
            </div>
            <div className="mail-compose-actions">
              <Button type="default">Discard</Button>
              <Button type="primary" loading={isSending} onClick={handleSend}>Send</Button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
