import { useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Form, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import {
  AppstoreFilled,
  CameraFilled,
  CameraOutlined,
  CheckCircleFilled,
  DatabaseFilled,
  DeleteOutlined,
  EditOutlined,
  ExclamationCircleFilled,
  EyeOutlined,
  FileTextOutlined,
  IdcardOutlined,
  LineChartOutlined,
  MailFilled,
  MailOutlined,
  MessageFilled,
  PictureOutlined,
  PlusSquareOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  TagFilled,
  TeamOutlined,
  UploadOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { FaceScanArt } from '../components/FaceArt';
import { descriptorFromFile, imageDataFromFile } from '../lib/faceRecognition';

const { Title, Text } = Typography;

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
  handleUpdatePassword,
  handleUpdateUser,
  permissionCatalog = [],
}) {
  const [form] = Form.useForm();
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

  const isAdmin = user?.role === 'admin';
  const editingSelf = editingUser?.id === user?.id;
  const adminHasEverything = draftRole === 'admin';
  const facePhoto = faceUpdate?.faceImage || editingUser?.faceImage || '';
  const hasRegisteredFace = Boolean(editingUser?.faceImage);
  const allPermissionCount = permissionCatalog.reduce((total, page) => total + page.actions.length, 0);

  const onSubmit = async (values) => {
    const ok = await handleUpdatePassword(values);
    if (ok) {
      form.resetFields();
    }
  };

  const openEditor = (record) => {
    setEditingUser(record);
    setActiveTab('basic');
    setDraftRole(record.role || 'user');
    setSelectedPermissions(record.permissions || []);
    setFaceUpdate(null);
    setFaceUpdateError('');
    setFaceFileName('');
    editForm.setFieldsValue({ fullName: record.fullName, email: record.email });
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
          ? <Tag color="gold">Full access</Tag>
          : <Text type="secondary">{(record.permissions || []).length} permissions</Text>),
      },
      {
        title: 'Actions',
        key: 'actions',
        width: 90,
        render: (_, record) => (
          <Button type="text" icon={<EditOutlined />} onClick={() => openEditor(record)} />
        ),
      },
    ]
    : userTableColumns;

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card title="Users">
        <Table dataSource={users} columns={columns} rowKey="id" />
      </Card>

      <Card>
        <Title level={4} style={{ marginTop: 0 }}>User Settings</Title>
        <Text type="secondary">Update your password below.</Text>
        <Form form={form} layout="vertical" onFinish={onSubmit} style={{ marginTop: 16, maxWidth: 460 }}>
          <Form.Item
            label="Current password"
            name="currentPassword"
            rules={[{ required: true, message: 'Please enter your current password.' }]}
          >
            <Input.Password placeholder="Current password" />
          </Form.Item>

          <Form.Item
            label="New password"
            name="newPassword"
            rules={[{ required: true, min: 6, message: 'New password must be at least 6 characters.' }]}
          >
            <Input.Password placeholder="New password" />
          </Form.Item>

          <Form.Item
            label="Confirm new password"
            name="confirmPassword"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: 'Please confirm your new password.' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('The two passwords do not match.'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="Confirm new password" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit">Update password</Button>
          </Form.Item>
        </Form>
      </Card>

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
                    aria-label="Change face photo"
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
                      <Input placeholder="Full name" />
                    </Form.Item>
                    <Form.Item
                      name="email"
                      label={<span className="user-editor-label"><MailOutlined /> Email</span>}
                      normalize={(value) => value?.trim()}
                      rules={[{ required: true, type: 'email', message: 'Enter a valid email address.' }]}
                    >
                      <Input placeholder="Email" />
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
    </Space>
  );
}
