import { useState } from 'react';
import { Alert, Button, Checkbox, Empty, Form, Input, Modal, Space, message } from 'antd';
import { ClusterOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import api from '../../api';
import StatusBadge from '../ui/StatusBadge';
import { formatDateTime } from './formatters';

const STATE_TONE = {
  PRIMARY: 'green',
  SECONDARY: 'blue',
  ARBITER: 'violet',
  RECOVERING: 'amber',
  STARTUP: 'amber',
  STARTUP2: 'amber',
};

const HOST_PATTERN = /^[^\s:]+:\d{2,5}$/;

/**
 * Replication is configured on the server, not by this app: all three actions
 * here are the driver equivalents of rs.initiate(), rs.add() and rs.remove().
 * A standalone mongod therefore gets an explanation instead of a form.
 */
export default function DatabaseReplicationPanel({ replication, canManage, onRefresh }) {
  const [initiateForm] = Form.useForm();
  const [memberForm] = Form.useForm();
  const [busy, setBusy] = useState('');

  const members = replication?.members || [];

  const initiate = async (values) => {
    const hosts = String(values.members || '')
      .split(/[\n,]/)
      .map((host) => host.trim())
      .filter(Boolean);

    if (!hosts.length || hosts.some((host) => !HOST_PATTERN.test(host))) {
      message.error('List each member as host:port, one per line.');
      return;
    }

    setBusy('initiate');
    try {
      await api.post('/database/replication/initiate', { setName: values.setName, members: hosts });
      message.success(`Replica set ${values.setName} initiated.`);
      initiateForm.resetFields();
      await onRefresh?.();
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to initiate the replica set.');
    } finally {
      setBusy('');
    }
  };

  const addMember = async (values) => {
    setBusy('add');
    try {
      await api.post('/database/replication/members', {
        host: values.host,
        priority: values.arbiter ? undefined : Number(values.priority || 1),
        arbiter: Boolean(values.arbiter),
      });
      message.success(`${values.host} added.`);
      memberForm.resetFields();
      await onRefresh?.();
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to add that member.');
    } finally {
      setBusy('');
    }
  };

  const removeMember = (member) => {
    Modal.confirm({
      title: `Remove ${member.name}?`,
      content: 'The replica set is reconfigured without this member. Its data is left untouched.',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.delete('/database/replication/members', { data: { host: member.name } });
          message.success(`${member.name} removed.`);
          await onRefresh?.();
        } catch (error) {
          message.error(error.response?.data?.message || 'Unable to remove that member.');
        }
      },
    });
  };

  return (
    <div className="vision-stack">
      <section className="vision-panel vision-panel-tight">
        <div className="vision-panel-head">
          <div className="vision-panel-head-title">
            <span className="vision-panel-icon"><ClusterOutlined /></span>
            <h3 className="vision-section-title">Replica set</h3>
          </div>
          <StatusBadge tone={replication?.initialized ? 'green' : 'amber'} dot>
            {replication?.initialized ? replication.setName : replication?.enabled ? 'Not initiated' : 'Standalone'}
          </StatusBadge>
        </div>

        {replication?.hint && <Alert type="info" showIcon message={replication.hint} />}

        <ul className="vision-facts">
          <li><span>Set name</span><strong>{replication?.setName || '—'}</strong></li>
          <li><span>This node</span><strong>{replication?.me || '—'}</strong></li>
          <li><span>Primary</span><strong>{replication?.primary || '—'}</strong></li>
          <li><span>Config version</span><strong>{replication?.configVersion ?? '—'}</strong></li>
          <li><span>Accepts writes</span><strong>{replication?.isWritablePrimary ? 'Yes' : 'No'}</strong></li>
        </ul>
      </section>

      <section className="vision-panel vision-panel-tight">
        <div className="vision-panel-head">
          <h3 className="vision-section-title">Members</h3>
          <span className="vision-cell-muted">{members.length} in the set</span>
        </div>

        {!members.length ? (
          <Empty
            description={replication?.enabled ? 'No members reported yet' : 'Replication is not enabled on this server'}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <div className="vision-table-scroll">
            <table className="vision-data-table">
              <thead>
                <tr><th>Host</th><th>State</th><th>Health</th><th>Last heartbeat</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.name}>
                    <td>
                      <span className="vision-file-name">{member.name}</span>
                      {member.self && <span className="vision-badge is-grey">this node</span>}
                    </td>
                    <td><span className={`vision-badge is-${STATE_TONE[member.state] || 'grey'}`}>{member.state}</span></td>
                    <td className="vision-cell-muted">{member.health === 1 ? 'Up' : 'Down'}</td>
                    <td className="vision-cell-muted">{member.self ? '—' : formatDateTime(member.lastHeartbeat)}</td>
                    <td>
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        disabled={!canManage || members.length < 2}
                        onClick={() => removeMember(member)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {replication?.initialized ? (
        <section className="vision-panel vision-panel-tight">
          <div className="vision-panel-head">
            <h3 className="vision-section-title">Add a member</h3>
          </div>
          <Form form={memberForm} layout="vertical" className="vision-form-grid" onFinish={addMember} initialValues={{ priority: 1 }}>
            <Form.Item
              name="host"
              label="Host"
              rules={[{ required: true, pattern: HOST_PATTERN, message: 'Use host:port, for example 127.0.0.1:27018.' }]}
            >
              <Input placeholder="127.0.0.1:27018" />
            </Form.Item>
            <Form.Item name="priority" label="Priority">
              <Input type="number" min={0} max={1000} />
            </Form.Item>
            <Form.Item name="arbiter" valuePropName="checked" className="vision-form-span">
              <Checkbox>Join as an arbiter (votes, holds no data)</Checkbox>
            </Form.Item>
            <Space className="vision-form-actions vision-form-span">
              <Button type="primary" className="vision-btn-primary" htmlType="submit" icon={<PlusOutlined />} loading={busy === 'add'} disabled={!canManage}>
                Add member
              </Button>
            </Space>
          </Form>
        </section>
      ) : (
        <section className="vision-panel vision-panel-tight">
          <div className="vision-panel-head">
            <h3 className="vision-section-title">Initiate a replica set</h3>
          </div>
          <p className="vision-monitor-note">
            The server must already be running with <code>--replSet</code>; this only performs the one-off
            initiation. Include this node in the member list.
          </p>
          <Form form={initiateForm} layout="vertical" onFinish={initiate} initialValues={{ setName: 'rs0' }}>
            <Form.Item
              name="setName"
              label="Replica set name"
              rules={[{ required: true, pattern: /^[A-Za-z0-9_-]{1,64}$/, message: 'Letters, digits, dash or underscore.' }]}
            >
              <Input placeholder="rs0" />
            </Form.Item>
            <Form.Item name="members" label="Members (one host:port per line)" rules={[{ required: true }]}>
              <Input.TextArea rows={3} placeholder={'127.0.0.1:27017\n127.0.0.1:27018'} />
            </Form.Item>
            <Space className="vision-form-actions">
              <Button
                type="primary"
                className="vision-btn-primary"
                htmlType="submit"
                loading={busy === 'initiate'}
                disabled={!canManage || !replication?.enabled}
              >
                Initiate
              </Button>
            </Space>
          </Form>
        </section>
      )}
    </div>
  );
}
