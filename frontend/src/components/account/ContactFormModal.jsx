import { useEffect } from 'react';
import { AutoComplete, Form, Input, Modal, Select, Switch } from 'antd';

const DEFAULT_GROUPS = ['General', 'Team', 'Client', 'Vendor', 'Personal'];

export default function ContactFormModal({ open, contact, groups = [], saving, onCancel, onSubmit }) {
  const [form] = Form.useForm();

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(contact || {
      fullName: '',
      email: '',
      phone: '',
      company: '',
      jobTitle: '',
      group: 'General',
      tags: [],
      notes: '',
      favourite: false,
    });
  }, [open, contact, form]);

  const groupOptions = [...new Set([...DEFAULT_GROUPS, ...groups])].map((group) => ({ value: group }));

  return (
    <Modal
      open={open}
      title={contact ? `Edit ${contact.fullName}` : 'New contact'}
      okText={contact ? 'Save changes' : 'Add contact'}
      confirmLoading={saving}
      onCancel={onCancel}
      width={600}
      onOk={async () => {
        const values = await form.validateFields().catch(() => null);
        if (!values) return;
        onSubmit(values);
      }}
    >
      <Form form={form} layout="vertical">
        <div className="vision-form-grid">
          <Form.Item name="fullName" label="Name" rules={[{ required: true, message: 'A name is required.' }]}>
            <Input placeholder="Dana Whitfield" />
          </Form.Item>
          <Form.Item name="group" label="Group">
            <AutoComplete options={groupOptions} placeholder="General" />
          </Form.Item>
          {/* Both are optional — a contact may be only a phone number — but a
              value that is there has to look like one. */}
          <Form.Item name="email" label="Email" rules={[{ type: 'email', message: 'Enter a valid email address.' }]}>
            <Input placeholder="dana@example.com" />
          </Form.Item>
          <Form.Item
            name="phone"
            label="Phone"
            rules={[{ pattern: /^[+()\d\s.-]{5,32}$/, message: 'Digits, spaces and + ( ) . - only.' }]}
          >
            <Input placeholder="+1 555 0134" />
          </Form.Item>
          <Form.Item name="company" label="Company">
            <Input placeholder="Northwind" />
          </Form.Item>
          <Form.Item name="jobTitle" label="Role">
            <Input placeholder="QA lead" />
          </Form.Item>
        </div>

        <Form.Item name="tags" label="Tags">
          <Select mode="tags" placeholder="supplier, on-call" tokenSeparators={[',']} />
        </Form.Item>

        <Form.Item name="notes" label="Notes">
          <Input.TextArea rows={3} placeholder="How you know them, what they handle…" />
        </Form.Item>

        <Form.Item name="favourite" label="Favourite" valuePropName="checked" tooltip="Favourites sort to the top.">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
