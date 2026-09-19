import { useState } from 'react';
import { Alert, Avatar, Button, Card, Checkbox, Form, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import { EditOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

const ACTION_COLUMNS = ['view', 'create', 'edit', 'delete'];

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
  const [editingUser, setEditingUser] = useState(null);
  const [selectedPermissions, setSelectedPermissions] = useState([]);
  const [draftRole, setDraftRole] = useState('user');
  const [saving, setSaving] = useState(false);

  const isAdmin = user?.role === 'admin';
  const editingSelf = editingUser?.id === user?.id;
  const adminHasEverything = draftRole === 'admin';

  const onSubmit = async (values) => {
    const ok = await handleUpdatePassword(values);
    if (ok) {
      form.resetFields();
    }
  };

  const openEditor = (record) => {
    setEditingUser(record);
    setDraftRole(record.role || 'user');
    setSelectedPermissions(record.permissions || []);
    editForm.setFieldsValue({ fullName: record.fullName, email: record.email });
  };

  const closeEditor = () => {
    setEditingUser(null);
    editForm.resetFields();
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
    const values = await editForm.validateFields();
    setSaving(true);
    const ok = await handleUpdateUser(editingUser.id, {
      ...values,
      role: draftRole,
      permissions: selectedPermissions,
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
        title={editingUser ? `Edit user: ${editingUser.username}` : 'Edit user'}
        onCancel={closeEditor}
        width={720}
        footer={[
          <Button key="cancel" onClick={closeEditor}>Cancel</Button>,
          <Button key="save" type="primary" loading={saving} onClick={onSave}>Save changes</Button>,
        ]}
      >
        <Form form={editForm} layout="vertical">
          {editingUser?.faceImage && (
            <div className="user-edit-photo">
              <img className="user-edit-face-image" src={editingUser.faceImage} alt={`${editingUser.fullName} face`} />
              <Text type="secondary">Registered face</Text>
            </div>
          )}
          <Form.Item name="fullName" label="Full name" rules={[{ required: true, message: 'Full name is required.' }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="email"
            label="Email"
            rules={[{ required: true, type: 'email', message: 'Enter a valid email address.' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item label="Role">
            <Select
              value={draftRole}
              onChange={setDraftRole}
              disabled={editingSelf}
              options={[
                { value: 'user', label: 'User' },
                { value: 'admin', label: 'Admin' },
              ]}
            />
            {editingSelf && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                You cannot change your own role.
              </Text>
            )}
          </Form.Item>
        </Form>

        <div className="permission-section">
          <div className="permission-header">
            <Text strong>Page permissions</Text>
            {!adminHasEverything && (
              <Space size="small">
                <Button size="small" onClick={grantAll}>Grant all</Button>
                <Button size="small" onClick={() => setSelectedPermissions([])}>Clear all</Button>
              </Space>
            )}
          </div>

          {adminHasEverything && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
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
                  {ACTION_COLUMNS.map((action) => <th key={action}>{action}</th>)}
                </tr>
              </thead>
              <tbody>
                {permissionCatalog.map((page) => (
                  <tr key={page.key}>
                    <td className="permission-page">{page.label}</td>
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
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Modal>
    </Space>
  );
}
