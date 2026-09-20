import { useEffect, useMemo, useState } from 'react';
import { Alert, Avatar, Badge, Button, Input, message } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  InboxOutlined,
  PaperClipOutlined,
  RollbackOutlined,
  SendOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/ui/PageHeader';
import api from '../api';

const formatAttachmentUrl = (attachment) => {
  if (!attachment) return '';
  if (/^https?:\/\//i.test(attachment)) return attachment;

  const apiOrigin = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000/api').replace(/\/api$/, '');
  return `${apiOrigin}${attachment.startsWith('/') ? '' : '/'}${attachment}`;
};

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
    <div className="vision-page">
      <PageHeader
        title="Mail"
        subtitle="Read, reply to and send platform messages."
      />

      <div className="vision-mail-layout">
        <aside className="vision-panel vision-panel-tight vision-mail-sidebar">
          <div className="vision-panel-head">
            <h3 className="vision-section-title">Inbox</h3>
            <Button type="primary" className="vision-btn-primary" icon={<EditOutlined />}>
              Compose
            </Button>
          </div>

          <Input.Search placeholder="Search mail" allowClear className="vision-mail-search" />

          <div className="vision-mail-list">
            {loading && mails.length === 0 ? (
              <div className="vision-empty">Loading inbox...</div>
            ) : mails.length === 0 ? (
              <div className="vision-empty">
                <InboxOutlined />
                No mail found.
              </div>
            ) : (
              mails.map((mail) => (
                <button
                  key={mail.id}
                  type="button"
                  className={`vision-mail-item${selectedMailId === mail.id ? ' is-active' : ''}`}
                  onClick={() => setSelectedMailId(mail.id)}
                >
                  <div className="vision-mail-item-head">
                    <span className="vision-mail-item-sender">{mail.from}</span>
                    {mail.unread && <Badge status="processing" />}
                  </div>
                  <div className="vision-mail-item-subject">{mail.subject}</div>
                  <div className="vision-mail-item-preview">{mail.preview}</div>
                  <div className="vision-mail-item-meta">
                    <span className="vision-badge is-grey">{mail.category}</span>
                    <span>{mail.timeLabel}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <main className="vision-mail-main">
          {error && !selectedMail ? (
            <div className="vision-panel vision-panel-tight">
              <Alert type="error" message={error} showIcon />
            </div>
          ) : selectedMail ? (
            <section className="vision-panel vision-panel-tight">
              <div className="vision-mail-detail-head">
                <div className="vision-mail-detail-heading">
                  <span className="vision-badge is-blue">{selectedMail.category || 'Inbox'}</span>
                  <h3 className="vision-mail-detail-title">{selectedMail.subject || 'Untitled message'}</h3>
                </div>
                <div className="vision-mail-detail-actions">
                  <Button className="vision-btn-ghost" icon={<RollbackOutlined />}>Reply</Button>
                  <Button
                    danger
                    className="vision-btn-ghost"
                    icon={<DeleteOutlined />}
                    onClick={() => handleDeleteMail(selectedMail.id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>

              <div className="vision-mail-detail-meta">
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
                      <Avatar size={36} className="vision-chat-avatar">{avatarText}</Avatar>
                      <div>
                        <div className="vision-mail-detail-name">{senderName}</div>
                        <div className="vision-cell-muted">To: {selectedMail.to || 'Unknown recipient'}</div>
                      </div>
                    </>
                  );
                })()}
                <span className="vision-mail-detail-time">{selectedMail.timeLabel || 'Just now'}</span>
              </div>

              <div className="vision-mail-body" dangerouslySetInnerHTML={{ __html: selectedMail.body || '<p>No content.</p>' }} />
              {selectedMail.attachment && (
                <div className="vision-mail-attachment">
                  <PaperClipOutlined />
                  <span>Attachment:</span>
                  <a href={formatAttachmentUrl(selectedMail.attachment)} target="_blank" rel="noreferrer">
                    {selectedMail.attachmentName || 'Open attachment'}
                  </a>
                </div>
              )}
            </section>
          ) : null}

          <section className="vision-panel vision-panel-tight">
            <h3 className="vision-section-title">New message</h3>
            <div className="vision-mail-compose">
              <Input
                placeholder="To"
                value={composeTo}
                onChange={(event) => setComposeTo(event.target.value)}
              />
              <Input
                placeholder="Subject"
                value={composeSubject}
                onChange={(event) => setComposeSubject(event.target.value)}
              />
              <Input.TextArea
                rows={5}
                placeholder="Write your message..."
                value={composeBody}
                onChange={(event) => setComposeBody(event.target.value)}
              />
              <div className="vision-mail-file-row">
                <label className="vision-file-picker" htmlFor="mail-attachment-upload">
                  <PaperClipOutlined />
                  <span>{attachmentFile ? 'Change file' : 'Attach file'}</span>
                </label>
                <input
                  id="mail-attachment-upload"
                  type="file"
                  className="vision-file-input"
                  onChange={(event) => setAttachmentFile(event.target.files?.[0] || null)}
                />
                {attachmentFile && <span className="vision-cell-muted">{attachmentFile.name}</span>}
              </div>
              <div className="vision-mail-compose-actions">
                <Button className="vision-btn-ghost">Discard</Button>
                <Button
                  type="primary"
                  className="vision-btn-primary"
                  icon={<SendOutlined />}
                  loading={isSending}
                  onClick={handleSend}
                >
                  Send
                </Button>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
