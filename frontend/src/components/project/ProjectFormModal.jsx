import { useEffect } from 'react';
import { DatePicker, Form, Input, InputNumber, Modal, Select, Switch } from 'antd';
import dayjs from 'dayjs';
import { PROJECT_STATUSES } from './workflow';

const COLORS = ['#1677ff', '#6c5ce7', '#19c8ff', '#22c55e', '#f59e0b', '#ff4d5f'];

export default function ProjectFormModal({ open, project, members = [], saving, onCancel, onSubmit }) {
  const [form] = Form.useForm();
  const manualProgress = Form.useWatch('manualProgress', form);

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(project
      ? {
        ...project,
        startDate: project.startDate ? dayjs(project.startDate) : null,
        dueDate: project.dueDate ? dayjs(project.dueDate) : null,
        manualProgress: project.isProgressManual,
        progressOverride: project.progressOverride ?? 0,
      }
      : {
        name: '',
        key: '',
        description: '',
        status: 'planning',
        color: COLORS[0],
        startDate: null,
        dueDate: null,
        memberIds: [],
        manualProgress: false,
        progressOverride: 0,
      });
  }, [open, project, form]);

  return (
    <Modal
      open={open}
      title={project ? `Edit ${project.key}` : 'New project'}
      okText={project ? 'Save changes' : 'Create project'}
      confirmLoading={saving}
      onCancel={onCancel}
      width={620}
      onOk={async () => {
        const values = await form.validateFields().catch(() => null);
        if (!values) return;
        onSubmit({
          ...values,
          startDate: values.startDate ? values.startDate.format('YYYY-MM-DD') : '',
          dueDate: values.dueDate ? values.dueDate.format('YYYY-MM-DD') : '',
          // null tells the API to go back to counting progress from the board.
          progressOverride: values.manualProgress ? values.progressOverride : null,
        });
      }}
    >
      <Form form={form} layout="vertical">
        <div className="vision-form-grid">
          <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Name the project.' }]}>
            <Input placeholder="Knowledge Store" />
          </Form.Item>
          <Form.Item
            name="key"
            label="Key"
            tooltip="Prefix for task ids, like KS-14. Fixed once the project has tasks."
            rules={[{ required: true, pattern: /^[A-Za-z][A-Za-z0-9]{1,9}$/, message: '2-10 characters, starting with a letter.' }]}
          >
            <Input
              placeholder="KS"
              disabled={Boolean(project?.taskCounter)}
              onChange={(event) => form.setFieldValue('key', event.target.value.toUpperCase())}
            />
          </Form.Item>
        </div>

        <Form.Item name="description" label="Description">
          <Input.TextArea rows={3} placeholder="What is this project for?" />
        </Form.Item>

        <div className="vision-form-grid">
          <Form.Item name="status" label="Status">
            <Select options={PROJECT_STATUSES.map((item) => ({ value: item.value, label: item.label }))} />
          </Form.Item>
          <Form.Item name="color" label="Colour">
            <Select
              options={COLORS.map((color) => ({
                value: color,
                label: (
                  <span className="vision-colour-option">
                    <span className="vision-colour-swatch" style={{ background: color }} />
                    {color}
                  </span>
                ),
              }))}
            />
          </Form.Item>
          <Form.Item name="startDate" label="Start date">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="dueDate" label="Due date">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </div>

        <Form.Item name="memberIds" label="Members" tooltip="Members see the project and its board.">
          <Select
            mode="multiple"
            allowClear
            placeholder="Add teammates"
            optionFilterProp="label"
            options={members.map((member) => ({ value: member.id, label: `${member.fullName} (${member.username})` }))}
          />
        </Form.Item>

        <div className="vision-form-grid">
          <Form.Item
            name="manualProgress"
            label="Track progress manually"
            valuePropName="checked"
            tooltip="Off: progress is counted from verified and closed tasks."
          >
            <Switch />
          </Form.Item>
          {manualProgress && (
            <Form.Item name="progressOverride" label="Progress %">
              <InputNumber min={0} max={100} style={{ width: '100%' }} />
            </Form.Item>
          )}
        </div>
      </Form>
    </Modal>
  );
}
