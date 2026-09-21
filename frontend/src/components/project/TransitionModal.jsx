import { useEffect } from 'react';
import { Form, Input, Modal, Select, Typography } from 'antd';
import {
  RESOLUTIONS,
  STATUS_LABEL,
  TRANSITION_LABEL,
  transitionNeeds,
} from './workflow';

const { Text } = Typography;

/**
 * Collects what a move requires before it is sent.
 *
 * Resolving asks for a resolution and reopening asks for a reason, because the
 * API refuses both without one — this is the same rule, asked for up front
 * rather than as an error afterwards.
 */
export default function TransitionModal({ open, task, to, saving, onCancel, onSubmit }) {
  const [form] = Form.useForm();
  const needs = transitionNeeds(to);

  useEffect(() => {
    if (open) form.setFieldsValue({ resolution: 'fixed', note: '' });
  }, [open, form]);

  if (!task || !to) return null;

  return (
    <Modal
      open={open}
      title={`${TRANSITION_LABEL[to] || to} ${task.key}`}
      okText={TRANSITION_LABEL[to] || 'Apply'}
      okButtonProps={{ danger: to === 'reopened' }}
      confirmLoading={saving}
      onCancel={onCancel}
      onOk={async () => {
        const values = await form.validateFields().catch(() => null);
        if (!values) return;
        onSubmit({ status: to, resolution: values.resolution, note: values.note });
      }}
    >
      <Text type="secondary">
        {STATUS_LABEL[task.status]} → {STATUS_LABEL[to]}
      </Text>

      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        {needs === 'resolution' && (
          <Form.Item name="resolution" label="Resolution" rules={[{ required: true }]}>
            <Select options={RESOLUTIONS} />
          </Form.Item>
        )}
        <Form.Item
          name="note"
          label={needs === 'note' ? 'Why did verification fail?' : 'Comment (optional)'}
          rules={needs === 'note' ? [{ required: true, message: 'A reason is required to reopen.' }] : []}
        >
          <Input.TextArea
            rows={3}
            placeholder={needs === 'note'
              ? 'Still reproducible on the login page after the fix…'
              : 'Anything the next person should know'}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
