import { useEffect } from 'react';
import { DatePicker, Form, Input, Modal, Select } from 'antd';
import dayjs from 'dayjs';
import { PRIORITIES, TASK_TYPES } from './workflow';

/**
 * One form for every kind of card. The reproduction fields only appear for a
 * bug: they are what a fixer needs and noise on a feature.
 */
export default function TaskFormModal({ open, task, members = [], saving, onCancel, onSubmit }) {
  const [form] = Form.useForm();
  const type = Form.useWatch('type', form) || 'bug';

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(task
      ? { ...task, dueDate: task.dueDate ? dayjs(task.dueDate) : null }
      : {
        title: '',
        description: '',
        type: 'bug',
        priority: 'normal',
        assigneeId: undefined,
        dueDate: null,
        tags: [],
        stepsToReproduce: '',
        expectedResult: '',
        actualResult: '',
        environment: '',
      });
  }, [open, task, form]);

  return (
    <Modal
      open={open}
      title={task ? `Edit ${task.key}` : 'Report a bug or add a task'}
      okText={task ? 'Save changes' : 'Create'}
      confirmLoading={saving}
      onCancel={onCancel}
      width={680}
      onOk={async () => {
        const values = await form.validateFields().catch(() => null);
        if (!values) return;
        onSubmit({
          ...values,
          assigneeId: values.assigneeId || '',
          dueDate: values.dueDate ? values.dueDate.format('YYYY-MM-DD') : '',
        });
      }}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="title" label="Title" rules={[{ required: true, message: 'Give it a one-line summary.' }]}>
          <Input placeholder="Login fails with a valid password" />
        </Form.Item>

        <div className="vision-form-grid">
          <Form.Item name="type" label="Type">
            <Select options={TASK_TYPES} />
          </Form.Item>
          <Form.Item name="priority" label="Priority">
            <Select options={PRIORITIES.map((item) => ({ value: item.value, label: item.label }))} />
          </Form.Item>
          <Form.Item name="assigneeId" label="Assignee">
            <Select
              allowClear
              placeholder="Unassigned"
              optionFilterProp="label"
              options={members.map((member) => ({ value: member.id, label: member.fullName }))}
            />
          </Form.Item>
          <Form.Item name="dueDate" label="Due date">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </div>

        <Form.Item name="description" label="Description">
          <Input.TextArea rows={3} placeholder="What is happening, and why does it matter?" />
        </Form.Item>

        {type === 'bug' && (
          <>
            <Form.Item name="stepsToReproduce" label="Steps to reproduce">
              <Input.TextArea rows={3} placeholder={'1. Open the login page\n2. Enter a valid password\n3. Submit'} />
            </Form.Item>
            <div className="vision-form-grid">
              <Form.Item name="expectedResult" label="Expected result">
                <Input.TextArea rows={2} placeholder="Signed in" />
              </Form.Item>
              <Form.Item name="actualResult" label="Actual result">
                <Input.TextArea rows={2} placeholder="Invalid credentials" />
              </Form.Item>
            </div>
            <Form.Item name="environment" label="Environment">
              <Input placeholder="Chrome 141, Windows 11, build 8123031" />
            </Form.Item>
          </>
        )}

        <Form.Item name="tags" label="Tags">
          <Select mode="tags" placeholder="auth, regression" tokenSeparators={[',']} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
