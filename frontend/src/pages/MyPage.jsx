import { Avatar, Tabs } from 'antd';
import {
  ContactsOutlined,
  IdcardOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/ui/PageHeader';
import StatusBadge from '../components/ui/StatusBadge';
import PasswordCard from '../components/account/PasswordCard';
import ProfileCard, { GENDER_LABEL } from '../components/account/ProfileCard';
import ContactsPanel from '../components/account/ContactsPanel';
import WalletPage from './WalletPage';
import { can } from '../permissions';

const formatDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' });
};

/**
 * My Page — everything that belongs to the signed-in account rather than to
 * the organisation: their details, their password, their wallet and their
 * contacts. It is reached from the user menu, not the sidebar, and needs no
 * page permission: it is always your own account. The tabs inside still
 * respect the wallet and contacts permissions, which the API enforces anyway.
 */
export default function MyPage({ user, onUpdatePassword, onUpdateProfile }) {
  const showWallet = can(user, 'wallet');
  const showContacts = can(user, 'contacts');

  const tabs = [
    {
      key: 'account',
      label: <span><IdcardOutlined /> Account</span>,
      children: (
        <div className="vision-stack">
          <section className="vision-panel vision-panel-tight">
            <div className="vision-panel-head">
              <h3 className="vision-section-title">Profile</h3>
              <StatusBadge tone={user?.role === 'admin' ? 'blue' : 'green'}>{user?.role}</StatusBadge>
            </div>

            <div className="account-profile">
              {user?.faceImage
                ? <img className="account-profile-photo" src={user.faceImage} alt={`${user.fullName} face`} />
                : <Avatar size={72} icon={<UserOutlined />} className="vision-cell-avatar" />}

              <ul className="vision-facts account-profile-facts">
                <li><span>Name</span><strong>{user?.fullName || '—'}</strong></li>
                <li><span>Username</span><strong>{user?.username || '—'}</strong></li>
                <li><span>Email</span><strong>{user?.email || '—'}</strong></li>
                <li><span>Gender</span><strong>{GENDER_LABEL[user?.gender] || '—'}</strong></li>
                <li><span>Birthday</span><strong>{user?.birthday || '—'}</strong></li>
                <li><span>Phone</span><strong>{user?.phone || '—'}</strong></li>
                <li><span>Job</span><strong>{user?.job || '—'}</strong></li>
                <li><span>Address</span><strong>{user?.address || '—'}</strong></li>
                <li><span>Member since</span><strong>{formatDate(user?.createdAt)}</strong></li>
              </ul>
            </div>

            <p className="vision-monitor-note">
              Name, email and face photo are changed by an administrator on the Users page.
            </p>
          </section>

          <ProfileCard user={user} onSubmit={onUpdateProfile} />

          <PasswordCard onSubmit={onUpdatePassword} />
        </div>
      ),
    },
  ];

  if (showWallet) {
    tabs.push({
      key: 'wallet',
      label: <span><WalletOutlined /> Wallet</span>,
      // embedded: this page already has a header, so the wallet drops its own.
      children: <WalletPage user={user} embedded />,
    });
  }

  if (showContacts) {
    tabs.push({
      key: 'contacts',
      label: <span><ContactsOutlined /> Contacts</span>,
      children: <ContactsPanel user={user} />,
    });
  }

  return (
    <div className="vision-page vision-stack">
      <PageHeader
        title="My Page"
        subtitle={user?.fullName ? `Your account, wallet and contacts, ${user.fullName}.` : 'Your account, wallet and contacts.'}
      />
      <Tabs defaultActiveKey="account" items={tabs} />
    </div>
  );
}
