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
}) {
  const { language, setLanguage, t } = useLanguage();
  const [clock, setClock] = useState(() => formatClock(new Date()));

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
        aria-label="Open navigation"
      />

      <Input
        className="vision-search"
        prefix={<SearchOutlined />}
        placeholder="Search..."
        value={searchValue}
        allowClear
        onChange={(event) => onSearchChange?.(event.target.value)}
        onPressEnter={(event) => onSearchSubmit?.(event.target.value)}
        aria-label="Global search"
      />

      <div className="vision-header-actions">
        <span className="vision-status-chip">
          <span className="vision-live-dot" />
          System Online
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

        <Badge dot={notificationCount > 0} offset={[-4, 4]}>
          <Button
            type="text"
            className="vision-icon-btn"
            icon={<BellOutlined />}
            aria-label={`Notifications${notificationCount ? ` (${notificationCount})` : ''}`}
          />
        </Badge>

        <Dropdown menu={{ items: userMenuItems }} trigger={['click']} placement="bottomRight">
          <button type="button" className="vision-user-pill" aria-label="Open user menu">
            <Avatar size={28} className="vision-user-avatar" icon={<UserOutlined />} />
            <span className="vision-user-name">{user?.fullName || 'Administrator'}</span>
            <DownOutlined className="vision-user-caret" />
          </button>
        </Dropdown>
      </div>
    </Header>
  );
}
