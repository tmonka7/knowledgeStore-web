import { useState } from 'react';
import { Alert, Button, Checkbox, Form, Input, Modal, Space, message } from 'antd';
import { SafetyCertificateOutlined, ThunderboltOutlined } from '@ant-design/icons';
import api from '../../api';
import StatusBadge from '../ui/StatusBadge';
import { formatNumber } from './formatters';

/**
 * Initialization has two shapes, and they are deliberately separate buttons:
 * "safe" only adds what is missing, while "reset" drops every collection and
 * therefore demands the typed confirmation the API also insists on.
 */
export default function DatabaseInitPanel({ status, canManage, onDone, onSessionInvalidated }) {
  const [form] = Form.useForm();
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState([]);

  const collections = status?.collections || [];
  const documentCount = collections.reduce((total, collection) => total + (collection.documents || 0), 0);

  const initialize = async (mode, values) => {
    setRunning(true);
    try {
      const { data } = await api.post('/database/initialize', {
        mode,
        confirm: mode === 'reset' ? 'RESET' : undefined,
        seedCategories: values.seedCategories !== false,
        superuser: values.username
          ? {
            username: values.username,
            email: values.email,
            fullName: values.fullName,
            password: values.password,
          }
          : undefined,
      });

      setSteps(data.steps || []);
      message.success(mode === 'reset' ? 'Database reset and initialized.' : 'Database initialized.');
      form.setFieldsValue({ password: '' });
      await onDone?.();

      if (data.signOutRequired) {
        // The account behind the current token was just dropped, so staying on
        // the page would only produce 401s on the next request.
        Modal.info({
          title: 'Sign in again',
          content: 'Every collection was replaced, including users. Sign in with the superuser you just created.',
          okText: 'Sign out',
          onOk: onSessionInvalidated,
        });
      }
    } catch (error) {
      message.error(error.response?.data?.message || 'Initialization failed.');
    } finally {
      setRunning(false);
    }
  };

  const runSafe = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    initialize('safe', values);
  };

  const runReset = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    if (!values.username || !values.password) {
      message.error('A superuser is required for a reset — otherwise nobody can sign back in.');
      return;
    }

    Modal.confirm({
      title: 'Drop every collection?',
      okText: 'Reset database',
      okButtonProps: { danger: true },
      content: (
        <div>
          <p>
            All {formatNumber(documentCount)} documents across {collections.length} collections are deleted,
            then the database is re-seeded and the superuser is created.
          </p>
          <p>A backup is written to the Restoration tab first, so this stays recoverable.</p>
        </div>
      ),
      onOk: () => initialize('reset', values),
    });
  };

  return (
    <div className="vision-stack">
      <section className="vision-panel vision-panel-tight">
        <div className="vision-panel-head">
          <div className="vision-panel-head-title">
            <span className="vision-panel-icon"><SafetyCertificateOutlined /></span>
            <h3 className="vision-section-title">Initialize database</h3>
          </div>
          <StatusBadge tone="blue">{collections.length} collections</StatusBadge>
        </div>

        <p className="vision-monitor-note">
          Creates the indexes the models declare, seeds the root categories and creates a superuser.
          Leave the superuser fields empty to only refresh indexes and seeds.
        </p>

        <Form
          form={form}
          layout="vertical"
          className="vision-form-grid"
          initialValues={{ seedCategories: true, fullName: 'System Administrator' }}
        >
          <Form.Item
            name="username"
            label="Superuser username"
            rules={[{ pattern: /^[a-zA-Z0-9._-]{3,32}$/, message: '3-32 letters, digits, dot, dash or underscore.' }]}
          >
            <Input placeholder="admin" autoComplete="off" />
          </Form.Item>
          <Form.Item name="email" label="Superuser email" rules={[{ type: 'email', message: 'Enter a valid email address.' }]}>
            <Input placeholder="admin@knowledge.store" autoComplete="off" />
          </Form.Item>
          <Form.Item name="fullName" label="Full name">
            <Input placeholder="System Administrator" />
          </Form.Item>
          <Form.Item
            name="password"
            label="Superuser password"
            rules={[{ min: 8, message: 'At least 8 characters.' }]}
          >
            <Input.Password placeholder="At least 8 characters" autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="seedCategories" valuePropName="checked" className="vision-form-span">
            <Checkbox>Seed the default root categories when none exist</Checkbox>
          </Form.Item>
        </Form>

        <Alert
          type="info"
          showIcon
          message="An existing account with the same username or email is promoted to administrator and given the password above."
        />

        <Space className="vision-form-actions">
          <Button
            type="primary"
            className="vision-btn-primary"
            loading={running}
            disabled={!canManage}
            onClick={runSafe}
            icon={<ThunderboltOutlined />}
          >
            Initialize
          </Button>
          <Button danger loading={running} disabled={!canManage} onClick={runReset}>
            Reset and initialize
          </Button>
        </Space>
      </section>

      {steps.length > 0 && (
        <section className="vision-panel vision-panel-tight">
          <div className="vision-panel-head">
            <h3 className="vision-section-title">Last run</h3>
          </div>
          <ul className="vision-facts">
            {steps.map((step) => (
              <li key={step.step}><span>{step.step}</span><strong>{step.detail}</strong></li>
            ))}
          </ul>
        </section>
      )}

      <section className="vision-panel vision-panel-tight">
        <div className="vision-panel-head">
          <h3 className="vision-section-title">Collections</h3>
          <span className="vision-cell-muted">{formatNumber(documentCount)} documents</span>
        </div>
        <div className="vision-table-scroll">
          <table className="vision-data-table">
            <thead>
              <tr><th>Collection</th><th>Documents</th></tr>
            </thead>
            <tbody>
              {collections.map((collection) => (
                <tr key={collection.name}>
                  <td>{collection.name}</td>
                  <td className="vision-cell-muted">{formatNumber(collection.documents)}</td>
                </tr>
              ))}
              {!collections.length && (
                <tr><td colSpan={2} className="vision-cell-muted">No collections yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
