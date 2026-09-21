import { Avatar, Badge, Button, Dropdown, Input, Layout, Select } from 'antd';
import {
  BellOutlined,
  DownOutlined,
  MailOutlined,
  MenuOutlined,
  MessageOutlined,
  NotificationOutlined,
  SearchOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { languageOptions, useLanguage } from '../i18n';

const { Header } = Layout;

const formatClock = (date) => `${date.toLocaleDateString('sv-SE')} ${date.toLocaleTimeString('en-GB')}`;

/** Clock time for something sent today, a date for anything older. */
const shortTime = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

export default function TopHeader({
  user,
  searchValue,
  onSearchChange,
  onSearchSubmit,
  userMenuItems,
  onOpenDrawer,
  notificationCount = 0,
  notificationItems = [],
  onNotificationSelect,
  postItems = [],
  onPostSelect,
  showMessages = false,
  messageCount = 0,
  messageItems = [],
  onMessageSelect,
  showMail = false,
  mailCount = 0,
  mailItems = [],
  onMailSelect,
}) {
  const { language, setLanguage, t } = useLanguage();
  const [clock, setClock] = useState(() => formatClock(new Date()));

  /*
   * The bell carries two kinds of thing waiting to be looked at: posts nobody
   * has opened, and tomorrow's schedule. They are separate groups rather than
   * one merged list, because opening a post and opening the schedule are
   * different destinations, and a mixed list would not say which is which.
   *
   * Post keys are prefixed so a post id can never collide with a reminder key.
   */
  const postMenuItems = postItems.length
    ? [
      { key: 'posts-heading', type: 'group', label: t('newPosts', { count: postItems.length }) },
      ...postItems.slice(0, 5).map((item) => ({
        key: `post:${item.id}`,
        label: (
          <span className="vision-bell-item is-post">
            <NotificationOutlined />
            <span className="vision-bell-post-title">{item.title}</span>
            <span className="vision-bell-post-author">{item.authorName}</span>
          </span>
        ),
      })),
    ]
    : [];

  const reminderMenuItems = notificationItems.length
    ? [
      { key: 'heading', type: 'group', label: t('dueTomorrow', { count: notificationItems.length }) },
      ...notificationItems.slice(0, 8).map((item) => ({
        key: `${item.scheduleId}:${item.date}`,
        label: (
          <span className="vision-bell-item">
            <strong>{item.time}</strong>
            <span>{item.title}</span>
          </span>
        ),
      })),
    ]
    : [];

  const bellMenuItems = postMenuItems.length || reminderMenuItems.length
    ? [
      ...postMenuItems,
      ...(postMenuItems.length && reminderMenuItems.length ? [{ type: 'divider' }] : []),
      ...reminderMenuItems,
    ]
    : [{ key: 'empty', disabled: true, label: t('nothingDueTomorrow') }];

  const onBellClick = ({ key }) => {
    if (key === 'empty') return;
    if (String(key).startsWith('post:')) {
      onPostSelect?.(String(key).slice('post:'.length));
      return;
    }
    onNotificationSelect?.();
  };

  /*
   * The five newest messages addressed to you. Each row carries who wrote it,
   * what it said and when; choosing one opens that conversation rather than
   * only the Chat page, so the message you clicked is the one you land on.
   */
  const messageMenuItems = messageItems.length
    ? [
      { key: 'heading', type: 'group', label: t('recentMessages') },
      ...messageItems.slice(0, 5).map((item) => ({
        key: item.id,
        label: (
          <span className={`vision-message-item${item.unread ? ' is-unread' : ''}`}>
            <span className="vision-message-head">
              <strong>{item.senderName}</strong>
              <span className="vision-message-time">{shortTime(item.createdAt)}</span>
            </span>
            <span className="vision-message-preview">{item.preview || t('noPreview')}</span>
          </span>
        ),
      })),
      { type: 'divider' },
      { key: 'all', label: t('openChat') },
    ]
    : [{ key: 'empty', disabled: true, label: t('noMessagesYet') }];

  /*
   * The five newest messages in your inbox, built the same way as the chat
   * menu beside it: same rows, same unread marker, same "open the one you
   * clicked" behaviour — two inboxes that behave differently would be two
   * things to learn rather than one.
   */
  const mailMenuItems = mailItems.length
    ? [
      { key: 'mail-heading', type: 'group', label: t('recentMail') },
      ...mailItems.slice(0, 5).map((item) => ({
        key: `mail:${item.id}`,
        label: (
          <span className={`vision-message-item${item.unread ? ' is-unread' : ''}`}>
            <span className="vision-message-head">
              <strong>{item.senderName}</strong>
              <span className="vision-message-time">{shortTime(item.sentAt)}</span>
            </span>
            <span className="vision-message-preview">{item.subject || item.preview || t('noPreview')}</span>
          </span>
        ),
      })),
      { type: 'divider' },
      { key: 'mail-all', label: t('openMail') },
    ]
    : [{ key: 'mail-empty', disabled: true, label: t('noMailYet') }];

  const onMailMenuClick = ({ key }) => {
    if (key === 'mail-empty' || key === 'mail-heading') return;
    // 'mail-all' carries no message, so Mail opens on the inbox.
    const picked = mailItems.find((item) => `mail:${item.id}` === key);
    onMailSelect?.(picked?.id || '');
  };

  const onMessageMenuClick = ({ key }) => {
    if (key === 'empty' || key === 'heading') return;
    // 'all' carries no conversation, so Chat opens wherever it left off.
    const picked = messageItems.find((item) => item.id === key);
    onMessageSelect?.(picked?.threadId || '');
  };

  useEffect(() => {
    const timer = setInterval(() => setClock(formatClock(new Date())), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <Header className="vision-header">
      <Button
        type="text"
        className="vision-icon-btn vision-header-menu-btn"
        icon={<MenuOutlined />}
        onClick={onOpenDrawer}
        aria-label={t('openNavigation')}
      />

      <Input
        className="vision-search"
        prefix={<SearchOutlined />}
        placeholder={t('globalSearch')}
        value={searchValue}
        allowClear
        onChange={(event) => onSearchChange?.(event.target.value)}
        onPressEnter={(event) => onSearchSubmit?.(event.target.value)}
        aria-label={t('globalSearch')}
      />

      <div className="vision-header-actions">
        <span className="vision-status-chip">
          <span className="vision-live-dot" />
          {t('systemOnline')}
        </span>
        <span className="vision-clock">{clock}</span>

        <Select
          value={language}
          onChange={setLanguage}
          options={languageOptions}
          className="vision-lang-select"
          aria-label={t('language')}
          popupMatchSelectWidth={false}
        />

        {showMail && (
          <Dropdown
            menu={{ items: mailMenuItems, onClick: onMailMenuClick }}
            trigger={['click']}
            placement="bottomRight"
            overlayClassName="vision-message-menu"
          >
            <Badge count={mailCount} size="small" offset={[-4, 4]}>
              <Button
                type="text"
                className="vision-icon-btn"
                icon={<MailOutlined />}
                aria-label={`${t('mail')}${mailCount ? ` (${mailCount})` : ''}`}
              />
            </Badge>
          </Dropdown>
        )}

        {showMessages && (
          <Dropdown
            menu={{ items: messageMenuItems, onClick: onMessageMenuClick }}
            trigger={['click']}
            placement="bottomRight"
            overlayClassName="vision-message-menu"
          >
            <Badge count={messageCount} size="small" offset={[-4, 4]}>
              <Button
                type="text"
                className="vision-icon-btn"
                icon={<MessageOutlined />}
                aria-label={`${t('messages')}${messageCount ? ` (${messageCount})` : ''}`}
              />
            </Badge>
          </Dropdown>
        )}

        <Dropdown
          menu={{ items: bellMenuItems, onClick: onBellClick }}
          trigger={['click']}
          placement="bottomRight"
        >
          <Badge count={notificationCount} size="small" offset={[-4, 4]}>
            <Button
              type="text"
              className="vision-icon-btn"
              icon={<BellOutlined />}
              aria-label={`${t('notifications')}${notificationCount ? ` (${notificationCount})` : ''}`}
            />
          </Badge>
        </Dropdown>

        <Dropdown menu={{ items: userMenuItems }} trigger={['click']} placement="bottomRight">
          <button type="button" className="vision-user-pill" aria-label={t('openUserMenu')}>
            <Avatar size={28} className="vision-user-avatar" icon={<UserOutlined />} />
            <span className="vision-user-name">{user?.fullName || t('administrator')}</span>
            <DownOutlined className="vision-user-caret" />
          </button>
        </Dropdown>
      </div>
    </Header>
  );
}
