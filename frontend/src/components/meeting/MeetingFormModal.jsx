import { DatePicker, Form, Input, Modal, Select, Switch } from 'antd';
import dayjs from 'dayjs';

/**
 * Booking or changing a meeting.
 *
 * `forceRender` and a keyed Form: antd drops setFieldsValue on a Form that has
 * not been mounted yet, which is what makes an edit dialog open blank the first
 * time. Mounting it up front and rebuilding it per meeting avoids both halves
 * of that.
 */
export default function MeetingFormModal({
  open,
  meeting,
  directory = [],
  saving,
  onCancel,
  onSubmit,
}) {
  const [form] = Form.useForm();
  const openToAll = Form.useWatch('openToAll', form);

  const initialValues = {
    title: meeting?.title || '',
    description: meeting?.description || '',
    scheduledAt: meeting?.scheduledAt ? dayjs(meeting.scheduledAt) : null,
    openToAll: meeting?.openToAll ?? true,
    inviteeIds: meeting?.inviteeIds || [],
  };

  const submit = async () => {
    const values = await form.validateFields();
    onSubmit({
      title: values.title,
      description: values.description || '',
      // Sent as an absolute instant, not a local string: a meeting at 14:00
      // means 14:00 where the person who booked it is.
      scheduledAt: values.scheduledAt ? values.scheduledAt.toISOString() : null,
      openToAll: values.openToAll !== false,
      inviteeIds: values.openToAll === false ? (values.inviteeIds || []) : [],
    });
  };

  return (
    <Modal
      open={open}
      forceRender
      title={meeting ? 'Edit meeting' : 'New meeting'}
      okText={meeting ? 'Save' : 'Create'}
      confirmLoading={saving}
      onCancel={onCancel}
      onOk={submit}
      destroyOnClose={false}
    >
      <Form
        form={form}
        layout="vertical"
        key={meeting?.id || 'new'}
        initialValues={initialValues}
      >
        <Form.Item
          name="title"
          label="Title"
          rules={[{ required: true, message: 'Give the meeting a title.' }]}
        >
          <Input maxLength={160} placeholder="Weekly standup" />
        </Form.Item>

        <Form.Item name="description" label="What it is about">
          <Input.TextArea rows={3} maxLength={2000} placeholder="Optional" />
        </Form.Item>

        <Form.Item
          name="scheduledAt"
          label="Starts"
          extra="Leave empty for a room anyone can open whenever they need it."
        >
          <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item name="openToAll" label="Open to everyone" valuePropName="checked">
          <Switch />
        </Form.Item>

        {openToAll === false && (
          <Form.Item
            name="inviteeIds"
            label="Who may join"
            rules={[{ required: true, message: 'Choose at least one person.' }]}
            extra="You can always join your own meeting."
          >
            <Select
              mode="multiple"
              allowClear
              placeholder="Select people"
              optionFilterProp="label"
              options={directory.map((person) => ({
                value: person.id,
                label: person.fullName || person.username,
              }))}
            />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
