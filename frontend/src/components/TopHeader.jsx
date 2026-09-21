import { Avatar, Badge, Button, Dropdown, Input, Layout, Select } from 'antd';
import {
  BellOutlined,
  DownOutlined,
  MenuOutlined,
  SearchOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { languageOptions, useLanguage } from '../i18n';

const { Header } = Layout;

const formatClock = (date) => `${date.toLocaleDateString('sv-SE')} ${date.toLocaleTimeString('en-GB')}`;

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
}) {
  const { language, setLanguage, t } = useLanguage();
  const [clock, setClock] = useState(() => formatClock(new Date()));

  // Reminders for tomorrow; selecting any of them jumps to the Schedule page.
  const bellMenuItems = notificationItems.length
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
    : [{ key: 'empty', disabled: true, label: t('nothingDueTomorrow') }];

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

        <Dropdown
          menu={{ items: bellMenuItems, onClick: ({ key }) => key !== 'empty' && onNotificationSelect?.() }}
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
