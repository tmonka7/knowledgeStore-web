import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Avatar, Button, Empty, Form, Input, Modal, Select, message } from 'antd';
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  InboxOutlined,
  PaperClipOutlined,
  ReloadOutlined,
  RollbackOutlined,
  SendOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/ui/PageHeader';
import HtmlEditor from '../components/HtmlEditor';
import api from '../api';
import { can } from '../permissions';
import { useLanguage } from '../i18n';

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const attachmentUrl = (attachment) => {
  if (!attachment) return '';
  if (/^https?:\/\//i.test(attachment)) return attachment;
  const origin = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000/api').replace(/\/api$/, '');
  return `${origin}${attachment.startsWith('/') ? '' : '/'}${attachment}`;
};

const formatBytes = (bytes) => {
  const value = Number(bytes) || 0;
  if (!value) return '';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 ? Math.round(size) : Math.round(size * 10) / 10} ${units[index]}`;
};

const formatMoment = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const initials = (name = '') => name
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0].toUpperCase())
  .join('') || '?';

/**
 * Who has opened a sent message, and when.
 *
 * The sender's copy and the recipients' copy are one document, so this is the
 * same `readAt` the recipient's mailbox wrote — not a separate receipt that
 * could disagree with it.
 */
function OpenStatus({ mail }) {
  if (!mail.recipients?.length) return null;

  return (
    <ul className="mail-receipts">
      {mail.recipients.map((person) => (
        <li key={person.userId}>
          <span className="mail-receipt-name">{person.name || 'Unknown'}</span>
          {person.readAt ? (
            <span className="mail-receipt-open">
              <CheckCircleFilled /> Opened {formatMoment(person.readAt)}
            </span>
          ) : (
            <span className="mail-receipt-unopened">
              <ClockCircleOutlined /> Not opened yet
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Internal mail.
 *
 * Messages are addressed to accounts on this installation, not to typed
 * addresses, and are delivered: Inbox is what was sent to you, Sent is what
 * you sent, and a sent message carries the open status of every recipient.
 */
export default function MailPage({ user, directory = [], initialMailId = '', onMailOpened }) {
  const { t } = useLanguage();
  const [folder, setFolder] = useState('inbox');
  const [mails, setMails] = useState([]);
  const [unread, setUnread] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [selectedMail, setSelectedMail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const [composeOpen, setComposeOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [form] = Form.useForm();

  const canSend = can(user, 'mail', 'create');
  const canDelete = can(user, 'mail', 'delete');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/mail', { params: { folder } });
      setMails(data.mails || []);
      setUnread(data.unread || 0);
    } catch (loadError) {
      setError(loadError.response?.data?.message || t('unableToLoadInbox'));
    } finally {
      setLoading(false);
    }
  }, [folder, t]);

  useEffect(() => { load(); }, [load]);
  // Switching mailbox clears the reading pane rather than showing a message
  // from the folder you just left.
  useEffect(() => { setSelectedId(''); setSelectedMail(null); }, [folder]);

  /**
   * Opening a message is what marks it read, so the list is refreshed from
   * what the server says rather than assumed.
   */
  const openMail = useCallback(async (mail) => {
    setSelectedId(mail.id);
    try {
      const { data } = await api.get(`/mail/${mail.id}`);
      setSelectedMail(data.mail);
      setMails((current) => current.map((item) => (item.id === data.mail.id ? data.mail : item)));
      if (mail.unread) setUnread((current) => Math.max(0, current - 1));
    } catch (openError) {
      message.error(openError.response?.data?.message || 'Unable to open that message.');
    }
  }, []);

  /*
   * A message picked from the header's mail menu.
   *
   * Those are always inbox messages, so the folder is switched first if the
   * Sent tab happened to be open; the effect runs again once that folder has
   * loaded and the message is there to open.
   */
  useEffect(() => {
    if (!initialMailId) return;
    if (folder !== 'inbox') { setFolder('inbox'); return; }
    const wanted = mails.find((item) => item.id === initialMailId);
    if (!wanted) return;
    if (selectedId !== wanted.id) openMail(wanted);
    onMailOpened?.();
  }, [initialMailId, folder, mails, selectedId, openMail, onMailOpened]);

  const removeMail = (mail) => {
    Modal.confirm({
      title: 'Delete this message?',
      content: folder === 'sent'
        ? 'It is removed from your Sent folder. The people you sent it to keep their copy.'
        : 'It is removed from your inbox. The sender keeps their copy.',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.delete(`/mail/${mail.id}`);
          setMails((current) => current.filter((item) => item.id !== mail.id));
          if (selectedId === mail.id) { setSelectedId(''); setSelectedMail(null); }
          message.success(t('mailDeleted'));
        } catch (deleteError) {
          message.error(deleteError.response?.data?.message || t('unableToDeleteMail'));
        }
      },
    });
  };

  const openCompose = (prefill = null) => {
    form.setFieldsValue(prefill || { to: [], subject: '', body: '', replyToId: '' });
    setAttachmentFile(null);
    setComposeOpen(true);
  };

  /** Reply goes back to the sender, with the original quoted underneath. */
  const replyTo = (mail) => openCompose({
    to: [mail.senderId],
    subject: mail.subject?.startsWith('Re:') ? mail.subject : `Re: ${mail.subject || ''}`,
    body: `<p></p><blockquote><p>${mail.senderName} wrote on ${formatMoment(mail.sentAt)}:</p>${mail.body || ''}</blockquote>`,
    replyToId: mail.id,
  });

  const send = async (values) => {
    if (attachmentFile && attachmentFile.size > MAX_ATTACHMENT_BYTES) {
      message.error(`${attachmentFile.name} is larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}.`);
      return;
    }

    setSending(true);
    try {
      const formData = new FormData();
      // Recipients are account ids, and the request is multipart, so the list
      // travels as JSON.
      formData.append('to', JSON.stringify(values.to || []));
      formData.append('subject', values.subject || '');
      formData.append('body', values.body || '');
      if (values.replyToId) formData.append('replyToId', values.replyToId);
      if (attachmentFile) formData.append('attachment', attachmentFile);

      await api.post('/mail', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      message.success(t('messageSent'));
      setComposeOpen(false);
      form.resetFields();
      setAttachmentFile(null);
      if (folder === 'sent') await load();
    } catch (sendError) {
      message.error(sendError.response?.data?.message || t('unableToSendMessage'));
    } finally {
      setSending(false);
    }
  };

  const visibleMails = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return mails;
    return mails.filter((mail) => [mail.subject, mail.preview, mail.senderName, ...(mail.recipientNames || [])]
      .some((field) => String(field || '').toLowerCase().includes(needle)));
  }, [mails, search]);

  const recipientOptions = directory
    .filter((person) => person.id !== user?.id)
    .map((person) => ({
      value: person.id,
      label: person.username ? `${person.fullName} (${person.username})` : person.fullName,
    }));

  return (
    <div className="vision-page">
      <PageHeader
        title={t('mail')}
        subtitle="Messages between accounts on this installation."
        actions={(
          <>
            <Button className="vision-btn-ghost" icon={<ReloadOutlined />} loading={loading} onClick={load}>
              Refresh
            </Button>
            {canSend && (
              <Button
                type="primary"
                className="vision-btn-primary"
                icon={<EditOutlined />}
                onClick={() => openCompose()}
              >
                {t('compose')}
              </Button>
            )}
          </>
        )}
      />

      <div className="vision-mail-layout">
        <aside className="vision-panel vision-panel-tight vision-mail-sidebar">
          <div className="mail-folders">
            <button
              type="button"
              className={`mail-folder${folder === 'inbox' ? ' is-active' : ''}`}
              onClick={() => setFolder('inbox')}
            >
              <InboxOutlined /> {t('inbox')}
              {unread > 0 && <span className="vision-badge is-blue">{unread}</span>}
            </button>
            <button
              type="button"
              className={`mail-folder${folder === 'sent' ? ' is-active' : ''}`}
              onClick={() => setFolder('sent')}
            >
              <SendOutlined /> Sent
            </button>
          </div>

          <Input.Search
            placeholder={t('searchMail')}
            allowClear
            className="vision-mail-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <div className="vision-mail-list">
            {loading && !mails.length ? (
              <div className="vision-empty">{t('loadingInbox')}</div>
            ) : !visibleMails.length ? (
              <div className="vision-empty">
                <InboxOutlined />
                {mails.length ? 'No message matches that' : t('noMailFound')}
              </div>
            ) : (
              visibleMails.map((mail) => (
                <button
                  key={mail.id}
                  type="button"
                  className={`vision-mail-item${selectedId === mail.id ? ' is-active' : ''}${mail.unread ? ' is-unread' : ''}`}
                  onClick={() => openMail(mail)}
                >
                  <div className="vision-mail-item-head">
                    <span className="vision-mail-item-sender">
                      {folder === 'sent'
                        ? `To: ${(mail.recipientNames || []).join(', ') || '—'}`
                        : mail.senderName || 'Unknown'}
                    </span>
                    {mail.unread && <span className="mail-unread-dot" aria-label="Unread" />}
                  </div>
                  <div className="vision-mail-item-subject">{mail.subject || t('untitledMessage')}</div>
                  <div className="vision-mail-item-preview">{mail.preview}</div>
                  <div className="vision-mail-item-meta">
                    {mail.attachment && <PaperClipOutlined />}
                    {folder === 'sent' && (
                      <span className="vision-badge is-grey">
                        Opened {mail.openedCount}/{mail.recipients?.length || 0}
                      </span>
                    )}
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
          ) : !selectedMail ? (
            <section className="vision-panel vision-panel-tight">
              <Empty
                description={mails.length ? 'Pick a message to read it' : 'Nothing here yet'}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            </section>
          ) : (
            <section className="vision-panel vision-panel-tight">
              <div className="vision-mail-detail-head">
                <div className="vision-mail-detail-heading">
                  <span className="vision-badge is-blue">{selectedMail.folder === 'sent' ? 'Sent' : t('inbox')}</span>
                  <h3 className="vision-mail-detail-title">{selectedMail.subject || t('untitledMessage')}</h3>
                </div>
                <div className="vision-mail-detail-actions">
                  {canSend && selectedMail.folder === 'inbox' && (
                    <Button className="vision-btn-ghost" icon={<RollbackOutlined />} onClick={() => replyTo(selectedMail)}>
                      {t('reply')}
                    </Button>
                  )}
                  {canDelete && (
                    <Button danger className="vision-btn-ghost" icon={<DeleteOutlined />} onClick={() => removeMail(selectedMail)}>
                      {t('delete')}
                    </Button>
                  )}
                </div>
              </div>

              <div className="vision-mail-detail-meta">
                <Avatar size={36} className="vision-chat-avatar">{initials(selectedMail.senderName)}</Avatar>
                <div>
                  <div className="vision-mail-detail-name">{selectedMail.senderName || 'Unknown sender'}</div>
                  <div className="vision-cell-muted">
                    {t('toRecipient', { recipient: (selectedMail.recipientNames || []).join(', ') || t('unknownRecipient') })}
                  </div>
                </div>
                <span className="vision-mail-detail-time">{formatMoment(selectedMail.sentAt)}</span>
              </div>

              <div className="vision-mail-body" dangerouslySetInnerHTML={{ __html: selectedMail.body || '<p>No content.</p>' }} />

              {selectedMail.attachment && (
                <div className="vision-mail-attachment">
                  <PaperClipOutlined />
                  <a href={attachmentUrl(selectedMail.attachment)} target="_blank" rel="noreferrer" download={selectedMail.attachmentName}>
                    {selectedMail.attachmentName || 'Attachment'}
                  </a>
                  <span className="vision-cell-muted">{formatBytes(selectedMail.attachmentSize)}</span>
                </div>
              )}

              {/* Open tracking. The sender sees who has read it; a recipient
                  sees when they opened it themselves. */}
              {selectedMail.folder === 'sent' ? (
                <div className="mail-receipt-panel">
                  <h4 className="vision-section-title">
                    Opened by {selectedMail.openedCount} of {selectedMail.recipients?.length || 0}
                  </h4>
                  <OpenStatus mail={selectedMail} />
                </div>
              ) : (
                <p className="vision-cell-muted mail-receipt-note">
                  {selectedMail.readAt ? `You opened this ${formatMoment(selectedMail.readAt)}.` : 'Opening this marks it read for the sender.'}
                </p>
              )}
            </section>
          )}
        </main>
      </div>

      {/* forceRender: the Form must exist before the first open, because a
          reply prefills it with setFieldsValue. */}
      <Modal
        open={composeOpen}
        title={t('newMessage')}
        okText={t('send')}
        confirmLoading={sending}
        onCancel={() => { setComposeOpen(false); form.resetFields(); setAttachmentFile(null); }}
        onOk={async () => {
          const values = await form.validateFields().catch(() => null);
          if (values) send(values);
        }}
        width={760}
        forceRender
      >
        <Form form={form} layout="vertical">
          <Form.Item name="replyToId" hidden><Input /></Form.Item>
          <Form.Item
            name="to"
            label={t('recipient')}
            rules={[{ required: true, message: 'Choose at least one recipient.' }]}
          >
            {/* Accounts, not typed addresses: this mail never leaves the
                installation, so an address would have nowhere to go. */}
            <Select
              mode="multiple"
              allowClear
              options={recipientOptions}
              placeholder="Choose people on this installation"
              optionFilterProp="label"
              maxTagCount="responsive"
            />
          </Form.Item>
          <Form.Item name="subject" label={t('subject')} rules={[{ required: true, message: 'A message needs a subject.' }]}>
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="body" label={t('writeMessage')}>
            <HtmlEditor />
          </Form.Item>
          <Form.Item label={t('attachment')}>
            <div className="vision-mail-file-row">
              <label className="vision-file-picker" htmlFor="mail-attachment-upload">
                <PaperClipOutlined />
                <span>{attachmentFile ? t('changeFiles') : t('uploadFiles')}</span>
              </label>
              <input
                id="mail-attachment-upload"
                type="file"
                className="vision-file-input"
                onChange={(event) => setAttachmentFile(event.target.files?.[0] || null)}
              />
              {attachmentFile && (
                <span className="vision-cell-muted">
                  {attachmentFile.name} · {formatBytes(attachmentFile.size)}
                </span>
              )}
            </div>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
