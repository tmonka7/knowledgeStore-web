import { Drawer, Layout, Menu } from 'antd';
import { SafetyCertificateFilled } from '@ant-design/icons';
import NetworkArt from './ui/NetworkArt';

const { Sider } = Layout;

function SidebarBody({ items, selectedKey, onSelect, collapsed }) {
  return (
    <>
      <div className="vision-brand">
        <span className="vision-brand-mark"><SafetyCertificateFilled /></span>
        {!collapsed && (
          <span className="vision-brand-text">
            <span className="vision-brand-name">VisionAI</span>
            <span className="vision-brand-sub">AI Security Platform</span>
          </span>
        )}
      </div>

      <Menu
        mode="inline"
        className="vision-nav"
        items={items}
        selectedKeys={[selectedKey]}
        onClick={(event) => onSelect(event.key)}
      />

      <div className="vision-sider-footer">
        <NetworkArt />
        {!collapsed && (
          <div className="vision-tagline">
            Smarter Security
            <br />
            Safer Tomorrow
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Fixed rail on desktop, slide-in drawer below 1024px. Both render the same
 * navigation so a permission change is reflected in one place.
 */
export default function Sidebar({
  items,
  selectedKey,
  onSelect,
  collapsed,
  onCollapse,
  drawerOpen,
  onDrawerClose,
}) {
  const select = (key) => {
    onSelect(key);
    onDrawerClose();
  };

  return (
    <>
      <Sider
        width={240}
        collapsedWidth={80}
        collapsible
        collapsed={collapsed}
        onCollapse={onCollapse}
        breakpoint="lg"
        className="vision-sider vision-sider-desktop"
      >
        <SidebarBody items={items} selectedKey={selectedKey} onSelect={select} collapsed={collapsed} />
      </Sider>

      <Drawer
        placement="left"
        width={260}
        open={drawerOpen}
        onClose={onDrawerClose}
        closable={false}
        rootClassName="vision-sider-drawer"
        styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}
      >
        <SidebarBody items={items} selectedKey={selectedKey} onSelect={select} collapsed={false} />
      </Drawer>
    </>
  );
}
