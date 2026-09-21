import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Checkbox, DatePicker, Form, Input, Modal, Select, Table, Typography } from 'antd';
import dayjs from 'dayjs';
import {
  AppstoreFilled,
  CameraFilled,
  CalendarOutlined,
  CameraOutlined,
  CloudServerOutlined,
  ContactsOutlined,
  CheckCircleFilled,
  DatabaseFilled,
  DeleteOutlined,
  EditOutlined,
  ExclamationCircleFilled,
  EyeOutlined,
  FileTextOutlined,
  HomeOutlined,
  IdcardOutlined,
  LineChartOutlined,
  MailFilled,
  MailOutlined,
  MessageFilled,
  PhoneOutlined,
  PictureOutlined,
  PlusOutlined,
  ProjectOutlined,
  PlusSquareOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  ScanOutlined,
  SearchOutlined,
  SolutionOutlined,
  TagFilled,
  TeamOutlined,
  UploadOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { FaceScanArt } from '../components/FaceArt';
import FilterBar from '../components/ui/FilterBar';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import StatusBadge from '../components/ui/StatusBadge';
import { descriptorFromFile, imageDataFromFile } from '../lib/faceRecognition';
import { useLanguage } from '../i18n';

const { Text } = Typography;

const ACTION_COLUMNS = ['view', 'create', 'edit', 'delete'];

const ACTION_META = {
  view: { label: 'View', icon: <EyeOutlined /> },
  create: { label: 'Create', icon: <PlusSquareOutlined /> },
  edit: { label: 'Edit', icon: <EditOutlined /> },
  delete: { label: 'Delete', icon: <DeleteOutlined /> },
};

// Keyed by the page keys in backend/src/helpers/permissionCatalog.js.
const PAGE_META = {
  overview: { icon: <AppstoreFilled />, color: '#2f6bff', tint: '#e7efff' },
  records: { icon: <DatabaseFilled />, color: '#12a370', tint: '#e3f7ef' },
  categories: { icon: <TagFilled />, color: '#f08c1a', tint: '#fff2e0' },
  cameras: { icon: <CameraFilled />, color: '#7a5af8', tint: '#efeaff' },
  chat: { icon: <MessageFilled />, color: '#0ba5b7', tint: '#e0f7fa' },
  mail: { icon: <MailFilled />, color: '#e8417f', tint: '#ffe8f1' },
  schedule: { icon: <CalendarOutlined />, color: '#12a370', tint: '#e3f7ef' },
  projects: { icon: <ProjectOutlined />, color: '#7a5af8', tint: '#efeaff' },
  wallet: { icon: <WalletOutlined />, color: '#f08c1a', tint: '#fff2e0' },
  contacts: { icon: <ContactsOutlined />, color: '#0ba5b7', tint: '#e0f7fa' },
  database: { icon: <CloudServerOutlined />, color: '#2f6bff', tint: '#e7efff' },
  users: { icon: <TeamOutlined />, color: '#2f6bff', tint: '#e7efff' },
  'system-monitor': { icon: <LineChartOutlined />, color: '#0ea5e9', tint: '#e3f4fd' },
};

const EDITOR_TABS = [
  { key: 'basic', label: 'Basic Info', icon: <UserOutlined /> },
  { key: 'permissions', label: 'Permissions', icon: <SafetyCertificateOutlined /> },
  { key: 'logs', label: 'Logs', icon: <FileTextOutlined /> },
];

const formatDate = (value) => {
  if (!value) return 'Unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Unknown'
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

function UserEditIcon() {
  return (
    <span className="anticon" role="img" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="7" r="4" />
        <path d="M2 21c0-3.9 3.1-7 7-7h1.5" />
        <path d="M19.4 12.6a1.9 1.9 0 0 1 2.7 2.7L17 20.4l-3.4.7.7-3.4 5.1-5.1Z" />
      </svg>
    </span>
  );
}

export default function UsersPage({
  users,
  user,
  userTableColumns,
  handleUpdateUser,
  onRefreshUsers,
  permissionCatalog = [],
}) {
  const { t } = useLanguage();
  const [editForm] = Form.useForm();
  const faceInputRef = useRef(null);
  const [editingUser, setEditingUser] = useState(null);
  const [activeTab, setActiveTab] = useState('basic');
  const [selectedPermissions, setSelectedPermissions] = useState([]);
  const [draftRole, setDraftRole] = useState('user');
  const [saving, setSaving] = useState(false);
  const [faceUpdate, setFaceUpdate] = useState(null);
  const [faceUpdating, setFaceUpdating] = useState(false);
  const [faceUpdateError, setFaceUpdateError] = useState('');
  const [faceFileName, setFaceFileName] = useState('');
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [pageSize, setPageSize] = useState(10);

  // Draft values follow the inputs; applied values drive the table, so the
  // Search and Reset buttons behave the way an enterprise filter bar should.
  const [queryDraft, setQueryDraft] = useState('');
  const [roleDraft, setRoleDraft] = useState('all');
  const [faceDraft, setFaceDraft] = useState('all');
  const [filters, setFilters] = useState({ query: '', role: 'all', face: 'all' });

  /**
   * The list App loaded at sign-in can be minutes or hours old, and anyone who
   * registered since is missing from it — which is what made new accounts look
   * as though they were never created. Opening this page re-reads it, and the
   * Refresh button covers the case of sitting on the page while someone signs
   * up.
   */
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { onRefreshUsers?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = async () => {
    setRefreshing(true);
    await onRefreshUsers?.();
    setRefreshing(false);
  };

  const applyFilters = () => setFilters({ query: queryDraft.trim(), role: roleDraft, face: faceDraft });

  const resetFilters = () => {
    setQueryDraft('');
    setRoleDraft('all');
    setFaceDraft('all');
    setFilters({ query: '', role: 'all', face: 'all' });
  };

  const filteredUsers = useMemo(() => {
    const needle = filters.query.toLowerCase();
    return users.filter((record) => {
      if (filters.role !== 'all' && record.role !== filters.role) return false;
      if (filters.face === 'enrolled' && !record.faceImage) return false;
      if (filters.face === 'missing' && record.faceImage) return false;
      if (!needle) return true;
      return [record.fullName, record.username, record.email, record.role]
        .some((field) => String(field || '').toLowerCase().includes(needle));
    });
  }, [users, filters]);

  const adminCount = users.filter((record) => record.role === 'admin').length;
  const regularCount = users.length - adminCount;
  const faceEnrolled = users.filter((record) => record.faceImage).length;
  const newThisWeek = users.filter((record) => {
    const created = new Date(record.createdAt).getTime();
    return Number.isFinite(created) && Date.now() - created < 7 * 24 * 60 * 60 * 1000;
  }).length;
  const percentOf = (count) => (users.length ? `${Math.round((count / users.length) * 100)}% of total` : '0% of total');

  const isAdmin = user?.role === 'admin';
  const editingSelf = editingUser?.id === user?.id;
  const adminHasEverything = draftRole === 'admin';
  const facePhoto = faceUpdate?.faceImage || editingUser?.faceImage || '';
  const hasRegisteredFace = Boolean(editingUser?.faceImage);
  const allPermissionCount = permissionCatalog.reduce((total, page) => total + page.actions.length, 0);

  const openEditor = (record) => {
    setEditingUser(record);
    setActiveTab('basic');
    setDraftRole(record.role || 'user');
    setSelectedPermissions(record.permissions || []);
    setFaceUpdate(null);
    setFaceUpdateError('');
    setFaceFileName('');
    editForm.setFieldsValue({
      fullName: record.fullName,
      email: record.email,
      gender: record.gender || undefined,
      // The API stores a 'YYYY-MM-DD' string; the picker wants a dayjs.
      birthday: record.birthday ? dayjs(record.birthday) : null,
      phone: record.phone || '',
      address: record.address || '',
      job: record.job || '',
    });
  };

  const closeEditor = () => {
    setEditingUser(null);
    setFaceUpdate(null);
    setFaceUpdateError('');
    setFaceFileName('');
    editForm.resetFields();
  };

  const onFaceUpdate = async (event) => {
    const file = event.target.files?.[0];
    // Reset so picking the same file again still fires onChange.
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setFaceUpdateError('Please choose an image file.');
      return;
    }

    setFaceFileName(file.name);
    setFaceUpdating(true);
    setFaceUpdateError('');
    try {
      const [descriptor, faceImage] = await Promise.all([
        descriptorFromFile(file),
        imageDataFromFile(file),
      ]);
      setFaceUpdate({ descriptor, faceImage });
    } catch (error) {
      setFaceUpdate(null);
      setFaceFileName('');
      setFaceUpdateError(error.message || 'Unable to process that face image.');
    } finally {
      setFaceUpdating(false);
    }
  };

  const togglePermission = (pageKey, action, checked) => {
    setSelectedPermissions((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(`${pageKey}:${action}`);
        // A create/edit/delete right is meaningless without access to the page.
        next.add(`${pageKey}:view`);
      } else if (action === 'view') {
        ACTION_COLUMNS.forEach((item) => next.delete(`${pageKey}:${item}`));
      } else {
        next.delete(`${pageKey}:${action}`);
      }
      return [...next];
    });
  };

  const grantAll = () => setSelectedPermissions(
    permissionCatalog.flatMap((page) => page.actions.map((action) => `${page.key}:${action}`)),
  );

  const onSave = async () => {
    let values;
    try {
      values = await editForm.validateFields();
    } catch {
      // The invalid fields live on the Basic Info pane, so bring it forward.
      setActiveTab('basic');
      return;
    }

    setSaving(true);
    const ok = await handleUpdateUser(editingUser.id, {
      ...values,
      // Back to the calendar-day string the API stores; '' clears it.
      birthday: values.birthday ? values.birthday.format('YYYY-MM-DD') : '',
      gender: values.gender || '',
      role: draftRole,
      permissions: selectedPermissions,
      // The API expects `faceDescriptor`; `faceUpdate` stores it as `descriptor`.
      ...(faceUpdate ? { faceDescriptor: faceUpdate.descriptor, faceImage: faceUpdate.faceImage } : {}),
    });
    setSaving(false);
    if (ok) {
      closeEditor();
    }
  };

  const columns = isAdmin
    ? [
      ...userTableColumns,
      {
        title: 'Access',
        key: 'access',
        render: (_, record) => (record.role === 'admin'
          ? <StatusBadge tone="amber">Full access</StatusBadge>
          : <StatusBadge tone="grey">{(record.permissions || []).length} permissions</StatusBadge>),
      },
      {
        title: 'Actions',
        key: 'actions',
        width: 90,
        render: (_, record) => (
          <div className="vision-row-actions">
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => openEditor(record)}
              aria-label={`Edit ${record.fullName}`}
            />
          </div>
        ),
      },
    ]
    : userTableColumns;

  return (
    <div className="vision-page">
      <PageHeader
        title={t('usersManagement')}
        subtitle={t('usersManagementSubtitle')}
        actions={(
          <>
            <Button className="vision-btn-ghost" icon={<ReloadOutlined />} loading={refreshing} onClick={refresh}>
              Refresh
            </Button>
            {isAdmin && (
              <Button type="primary" className="vision-btn-primary" icon={<PlusOutlined />} onClick={() => setAddUserOpen(true)}>
                {t('addUser')}
              </Button>
            )}
          </>
        )}
      />

      <div className="vision-stat-grid">
        <StatCard
          tone="blue"
          icon={<TeamOutlined />}
          label={t('totalUsers')}
          value={users.length}
          meta={`${newThisWeek} new this week`}
          trend={newThisWeek > 0 ? 'up' : undefined}
        />
        <StatCard
          tone="violet"
          icon={<SafetyCertificateOutlined />}
          label={t('administrators')}
          value={adminCount}
          meta={percentOf(adminCount)}
        />
        <StatCard
          tone="cyan"
          icon={<UserOutlined />}
          label={t('regularUsers')}
          value={regularCount}
          meta={percentOf(regularCount)}
        />
        <StatCard
          tone="green"
          icon={<ScanOutlined />}
          label={t('faceIdEnrolled')}
          value={faceEnrolled}
          meta={percentOf(faceEnrolled)}
        />
      </div>

      <FilterBar
        actions={(
          <>
            <Button type="primary" className="vision-btn-primary" icon={<SearchOutlined />} onClick={applyFilters}>
              {t('search')}
            </Button>
            <Button className="vision-btn-ghost" icon={<ReloadOutlined />} onClick={resetFilters}>
              {t('reset')}
            </Button>
          </>
        )}
      >
        <Input
          allowClear
          className="vision-filter-search"
          prefix={<SearchOutlined />}
          placeholder={t('searchUsersPlaceholder')}
          value={queryDraft}
          onChange={(event) => setQueryDraft(event.target.value)}
          onPressEnter={applyFilters}
        />
        <Select
          className="vision-filter-select"
          value={roleDraft}
          onChange={setRoleDraft}
          options={[
            { value: 'all', label: t('allRoles') },
            { value: 'admin', label: t('admin') },
            { value: 'user', label: t('user') },
          ]}
        />
        <Select
          className="vision-filter-select"
          value={faceDraft}
          onChange={setFaceDraft}
          options={[
            { value: 'all', label: t('allFaceId') },
            { value: 'enrolled', label: t('faceIdEnrolled') },
            { value: 'missing', label: t('noFacePhoto') },
          ]}
        />
      </FilterBar>

      <div className="vision-toolbar">
        <span className="vision-toolbar-meta">
          Total {filteredUsers.length} {filteredUsers.length === 1 ? 'record' : 'records'}
          {filteredUsers.length !== users.length && ` (filtered from ${users.length})`}
        </span>
      </div>

      <div className="vision-table-panel">
        <Table
          className="vision-table"
          dataSource={filteredUsers}
          columns={columns}
          rowKey="id"
          scroll={{ x: 'max-content' }}
          pagination={{ pageSize, showSizeChanger: true, pageSizeOptions: [10, 20, 50], onShowSizeChange: (_, size) => setPageSize(size) }}
          locale={{ emptyText: 'No users match these filters.' }}
        />
      </div>


      <Modal
        open={Boolean(editingUser)}
        onCancel={closeEditor}
        width={1000}
        centered
        title={null}
        footer={null}
        className="user-editor-modal"
        styles={{ body: { padding: 0 } }}
      >
        {editingUser && (
          <div className="user-editor">
            <header className="user-editor-header">
              <span className="user-editor-header-icon"><UserEditIcon /></span>
              <div className="user-editor-header-text">
                <h2>Edit User</h2>
                <p>Update user information and permissions</p>
              </div>
            </header>

            <div className="user-editor-body">
              <aside className="user-editor-side">
                <div className="user-editor-avatar">
                  {facePhoto
                    ? <img src={facePhoto} alt={`${editingUser.fullName} face`} />
                    : <span className="user-editor-avatar-fallback"><UserOutlined /></span>}
                  <button
                    type="button"
                    className="user-editor-avatar-button"
                    onClick={() => faceInputRef.current?.click()}
                    disabled={faceUpdating}
                    aria-label={t('changeFacePhoto')}
                  >
                    <CameraOutlined />
                  </button>
                </div>
                <p className={`user-editor-face-state${hasRegisteredFace ? '' : ' is-missing'}`}>
                  {hasRegisteredFace ? <CheckCircleFilled /> : <ExclamationCircleFilled />}
                  {hasRegisteredFace ? 'Registered face' : 'No face registered'}
                </p>

                <nav className="user-editor-nav">
                  {EDITOR_TABS.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      className={`user-editor-nav-item${activeTab === tab.key ? ' is-active' : ''}`}
                      onClick={() => setActiveTab(tab.key)}
                    >
                      {tab.icon}
                      {tab.label}
                    </button>
                  ))}
                </nav>

                <div className="user-editor-scan">
                  <FaceScanArt mesh className="user-editor-scan-art" />
                  <span className="user-editor-scan-label">
                    {facePhoto ? 'Face Recognized' : 'Awaiting photo'}
                    {facePhoto && <CheckCircleFilled />}
                  </span>
                </div>
              </aside>

              <div className="user-editor-main">
                <section className={`user-editor-pane${activeTab === 'basic' ? '' : ' is-hidden'}`}>
                  <div className="user-editor-card user-editor-photo-card">
                    <span className="user-editor-card-icon"><PictureOutlined /></span>
                    <div className="user-editor-card-text">
                      <strong>Change face photo</strong>
                      <span>Upload a new photo or choose a file</span>
                    </div>
                    <div className="user-editor-file">
                      <Button
                        type="primary"
                        icon={<UploadOutlined />}
                        loading={faceUpdating}
                        onClick={() => faceInputRef.current?.click()}
                        className="user-editor-choose"
                      >
                        Choose File
                      </Button>
                      <span className="user-editor-file-name" title={faceFileName}>
                        {faceFileName || 'No file chosen'}
                      </span>
                    </div>
                  </div>

                  {faceUpdateError && (
                    <Alert type="error" showIcon className="user-editor-alert" message={faceUpdateError} />
                  )}
                  {faceUpdate && !faceUpdateError && (
                    <Alert type="success" showIcon className="user-editor-alert" message="New face photo ready. Save changes to apply it." />
                  )}

                  <Form
                    form={editForm}
                    className="user-editor-form"
                    colon={false}
                    labelAlign="left"
                    labelCol={{ flex: '170px' }}
                    wrapperCol={{ flex: 'auto' }}
                    requiredMark={(label, { required }) => (
                      <>{label}{required && <span className="user-editor-required">*</span>}</>
                    )}
                  >
                    <Form.Item
                      name="fullName"
                      label={<span className="user-editor-label"><UserOutlined /> Full name</span>}
                      rules={[{ required: true, whitespace: true, message: 'Full name is required.' }]}
                    >
                      <Input placeholder={t('fullName')} />
                    </Form.Item>
                    <Form.Item
                      name="email"
                      label={<span className="user-editor-label"><MailOutlined /> Email</span>}
                      normalize={(value) => value?.trim()}
                      rules={[{ required: true, type: 'email', message: 'Enter a valid email address.' }]}
                    >
                      <Input placeholder={t('email')} />
                    </Form.Item>
                    {/* Personal details. Every one of them is optional — an
                        account created before these fields existed simply has
                        them empty, and nothing in the app depends on them. */}
                    <Form.Item
                      name="gender"
                      label={<span className="user-editor-label"><UserOutlined /> Gender</span>}
                    >
                      <Select
                        allowClear
                        placeholder="Not specified"
                        options={[
                          { value: 'male', label: 'Male' },
                          { value: 'female', label: 'Female' },
                          { value: 'other', label: 'Other' },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item
                      name="birthday"
                      label={<span className="user-editor-label"><CalendarOutlined /> Birthday</span>}
                    >
                      <DatePicker
                        style={{ width: '100%' }}
                        format="YYYY-MM-DD"
                        placeholder="YYYY-MM-DD"
                        disabledDate={(current) => current && current > dayjs().endOf('day')}
                      />
                    </Form.Item>
                    <Form.Item
                      name="phone"
                      label={<span className="user-editor-label"><PhoneOutlined /> Phone number</span>}
                      rules={[{ max: 40, message: 'Phone number is too long.' }]}
                    >
                      <Input placeholder="+1 555 0100" />
                    </Form.Item>
                    <Form.Item
                      name="address"
                      label={<span className="user-editor-label"><HomeOutlined /> Address</span>}
                      rules={[{ max: 200, message: 'Address is too long.' }]}
                    >
                      <Input.TextArea rows={2} placeholder="Street, city, country" />
                    </Form.Item>
                    <Form.Item
                      name="job"
                      label={<span className="user-editor-label"><SolutionOutlined /> Job</span>}
                      rules={[{ max: 80, message: 'Job title is too long.' }]}
                    >
                      <Input placeholder="QA engineer" />
                    </Form.Item>
                    <Form.Item
                      label={<span className="user-editor-label"><IdcardOutlined /> Role</span>}
                      extra={editingSelf ? 'You cannot change your own role.' : undefined}
                    >
                      <Select
                        value={draftRole}
                        onChange={setDraftRole}
                        disabled={editingSelf}
                        options={[
                          { value: 'user', label: 'User' },
                          { value: 'admin', label: 'Admin' },
                        ]}
                      />
                    </Form.Item>
                  </Form>
                </section>

                <section className={`user-editor-pane${activeTab === 'permissions' ? '' : ' is-hidden'}`}>
                  <div className="user-editor-card">
                    <div className="user-editor-card-head">
                      <span className="user-editor-card-icon is-shield"><SafetyCertificateOutlined /></span>
                      <div className="user-editor-card-text">
                        <strong>Page permissions</strong>
                        <span>Select the pages you want to grant access to this user.</span>
                      </div>
                      {!adminHasEverything && (
                        <div className="user-editor-bulk">
                          <button type="button" className="user-editor-grant" onClick={grantAll}>Grant all</button>
                          <button type="button" className="user-editor-clear" onClick={() => setSelectedPermissions([])}>Clear all</button>
                        </div>
                      )}
                    </div>

                    {adminHasEverything && (
                      <Alert
                        type="info"
                        showIcon
                        className="user-editor-alert"
                        message="Admins bypass permissions and can reach every page."
                      />
                    )}

                    {permissionCatalog.length === 0 ? (
                      <Text type="secondary">Permission catalog unavailable.</Text>
                    ) : (
                      <table className="permission-matrix">
                        <thead>
                          <tr>
                            <th>Page</th>
                            {ACTION_COLUMNS.map((action) => (
                              <th key={action}>
                                <span className="permission-action">
                                  {ACTION_META[action].icon}
                                  {ACTION_META[action].label}
                                </span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {permissionCatalog.map((page) => {
                            const meta = PAGE_META[page.key] || {};
                            return (
                              <tr key={page.key}>
                                <td className="permission-page">
                                  <span className="permission-page-icon" style={{ color: meta.color, background: meta.tint }}>
                                    {meta.icon || <AppstoreFilled />}
                                  </span>
                                  {page.label}
                                </td>
                                {ACTION_COLUMNS.map((action) => (
                                  <td key={action}>
                                    {page.actions.includes(action) ? (
                                      <Checkbox
                                        checked={adminHasEverything || selectedPermissions.includes(`${page.key}:${action}`)}
                                        disabled={adminHasEverything}
                                        onChange={(event) => togglePermission(page.key, action, event.target.checked)}
                                      />
                                    ) : (
                                      <span className="permission-na">—</span>
                                    )}
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </section>

                <section className={`user-editor-pane${activeTab === 'logs' ? '' : ' is-hidden'}`}>
                  <div className="user-editor-card">
                    <div className="user-editor-card-head">
                      <span className="user-editor-card-icon is-logs"><FileTextOutlined /></span>
                      <div className="user-editor-card-text">
                        <strong>Account details</strong>
                        <span>What the system currently records for this account.</span>
                      </div>
                    </div>
                    <ul className="user-editor-facts">
                      <li><span>Username</span><strong>{editingUser.username}</strong></li>
                      <li><span>Account created</span><strong>{formatDate(editingUser.createdAt)}</strong></li>
                      <li><span>Role</span><strong>{editingUser.role === 'admin' ? 'Admin' : 'User'}</strong></li>
                      <li><span>Face photo</span><strong>{hasRegisteredFace ? 'Registered' : 'Not registered'}</strong></li>
                      <li>
                        <span>Permissions granted</span>
                        <strong>{adminHasEverything ? 'All pages (admin)' : `${selectedPermissions.length} of ${allPermissionCount}`}</strong>
                      </li>
                      <li><span>User ID</span><strong className="user-editor-mono">{editingUser.id}</strong></li>
                    </ul>
                    <p className="user-editor-empty">Sign-in and activity history is not recorded yet.</p>
                  </div>
                </section>
              </div>
            </div>

            <footer className="user-editor-footer">
              <Button className="user-editor-cancel" onClick={closeEditor}>Cancel</Button>
              <Button className="user-editor-save" type="primary" icon={<SaveOutlined />} loading={saving} onClick={onSave}>
                Save changes
              </Button>
            </footer>

            <input
              ref={faceInputRef}
              type="file"
              accept="image/*"
              hidden
              disabled={faceUpdating}
              onChange={onFaceUpdate}
            />
          </div>
        )}
      </Modal>

      <Modal
        open={addUserOpen}
        title={t('addUser')}
        onCancel={() => setAddUserOpen(false)}
        footer={[<Button key="ok" type="primary" onClick={() => setAddUserOpen(false)}>Got it</Button>]}
        width={460}
        centered
      >
        <p>
          Accounts are created through the sign-up screen, because every user must enrol a face
          photo before the account exists.
        </p>
        <p className="vision-cell-muted">
          Ask the person to open the login page, choose <strong>Register</strong>, and complete the
          face capture. Once they appear in this list you can set their role and page permissions
          here.
        </p>
      </Modal>
    </div>
  );
}
