import { useEffect, useState } from 'react';
import { Button, DatePicker, Form, Input, Select } from 'antd';
import { IdcardOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

export const GENDER_LABEL = { male: 'Male', female: 'Female', other: 'Other' };

/**
 * The personal details of your own account: gender, birthday, phone, address
 * and job.
 *
 * Name, email, role and the face photo are not here on purpose — those are how
 * the rest of the app identifies and authorises you, so they stay with an
 * administrator on the Users page. These five are nobody else's to maintain.
 */
export default function ProfileCard({ user, onSubmit }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  // Re-seeded whenever the account changes underneath, so a save elsewhere
  // does not leave a stale draft sitting in the form.
  useEffect(() => {
    form.setFieldsValue({
      gender: user?.gender || undefined,
      birthday: user?.birthday ? dayjs(user.birthday) : null,
      phone: user?.phone || '',
      address: user?.address || '',
      job: user?.job || '',
    });
  }, [user, form]);

  const submit = async (values) => {
    setSaving(true);
    await onSubmit({
      ...values,
      gender: values.gender || '',
      // The API stores a calendar day as 'YYYY-MM-DD'; '' clears it.
      birthday: values.birthday ? values.birthday.format('YYYY-MM-DD') : '',
    });
    setSaving(false);
  };

  return (
    <section className="vision-panel vision-panel-tight">
      <div className="vision-panel-head">
        <div className="vision-panel-head-title">
          <span className="vision-panel-icon"><IdcardOutlined /></span>
          <h3 className="vision-section-title">Personal details</h3>
        </div>
      </div>

      <p className="vision-monitor-note">
        Optional, and only you and an administrator can see them.
      </p>

      <Form form={form} layout="vertical" onFinish={submit}>
        <div className="vision-form-grid">
          <Form.Item name="gender" label="Gender">
            <Select
              allowClear
              placeholder="Not specified"
              options={Object.entries(GENDER_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
          <Form.Item name="birthday" label="Birthday">
            <DatePicker
              style={{ width: '100%' }}
              format="YYYY-MM-DD"
              placeholder="YYYY-MM-DD"
              disabledDate={(current) => current && current > dayjs().endOf('day')}
            />
          </Form.Item>
          <Form.Item name="phone" label="Phone number" rules={[{ max: 40, message: 'Phone number is too long.' }]}>
            <Input placeholder="+1 555 0100" />
          </Form.Item>
          <Form.Item name="job" label="Job" rules={[{ max: 80, message: 'Job title is too long.' }]}>
            <Input placeholder="QA engineer" />
          </Form.Item>
        </div>

        <Form.Item name="address" label="Address" rules={[{ max: 200, message: 'Address is too long.' }]}>
          <Input.TextArea rows={2} placeholder="Street, city, country" />
        </Form.Item>

        <Form.Item>
          <Button type="primary" className="vision-btn-primary" htmlType="submit" loading={saving}>
            Save details
          </Button>
        </Form.Item>
      </Form>
    </section>
  );
}
