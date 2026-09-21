import { useState } from 'react';
import { Layout } from 'antd';
import Sidebar from './Sidebar';
import TopHeader from './TopHeader';
import { useLanguage } from '../i18n';

const { Content, Footer } = Layout;

/**
 * Application chrome: navigation rail (drawer on small screens), sticky header
 * and the scrolling content column. Pages render as children.
 */
export default function AppLayout({
  user,
  menuItems,
  selectedKey,
  onSelect,
  userMenuItems,
  searchValue,
  onSearchChange,
  onSearchSubmit,
  notificationCount,
  notificationItems,
  onNotificationSelect,
  postItems,
  onPostSelect,
  showMessages,
  messageCount,
  messageItems,
  onMessageSelect,
  showMail,
  mailCount,
  mailItems,
  onMailSelect,
  children,
}) {
  const { t } = useLanguage();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <Layout className="vision-shell">
      <Sidebar
        items={menuItems}
        selectedKey={selectedKey}
        onSelect={onSelect}
        collapsed={collapsed}
        onCollapse={setCollapsed}
        drawerOpen={drawerOpen}
        onDrawerClose={() => setDrawerOpen(false)}
      />
      <Layout>
        <TopHeader
          user={user}
          searchValue={searchValue}
          onSearchChange={onSearchChange}
          onSearchSubmit={onSearchSubmit}
          userMenuItems={userMenuItems}
          onOpenDrawer={() => setDrawerOpen(true)}
          notificationCount={notificationCount}
          notificationItems={notificationItems}
          onNotificationSelect={onNotificationSelect}
          postItems={postItems}
          onPostSelect={onPostSelect}
          showMessages={showMessages}
          messageCount={messageCount}
          messageItems={messageItems}
          onMessageSelect={onMessageSelect}
          showMail={showMail}
          mailCount={mailCount}
          mailItems={mailItems}
          onMailSelect={onMailSelect}
        />
        <Content className="vision-content">{children}</Content>
        <Footer className="vision-footer">{t('footerBrand')}</Footer>
      </Layout>
    </Layout>
  );
}
