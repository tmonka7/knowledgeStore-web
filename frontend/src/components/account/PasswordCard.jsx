import { useState } from 'react';
import { Button, Form, Input } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useLanguage } from '../../i18n';

/**
 * Changing your own password.
 *
 * It lived at the bottom of the Users page, which only administrators can
 * open — so the one account setting every user has was behind a permission
 * none of them had. It belongs on My Page.
 */
export default function PasswordCard({ onSubmit }) {
  const { t } = useLanguage();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const submit = async (values) => {
    setSaving(true);
    const ok = await onSubmit(values);
    setSaving(false);
    if (ok) form.resetFields();
  };

  return (
    <section className="vision-panel vision-panel-tight">
      <div className="vision-panel-head">
        <div className="vision-panel-head-title">
          <span className="vision-panel-icon"><LockOutlined /></span>
          <h3 className="vision-section-title">{t('userSettings')}</h3>
        </div>
      </div>

      <p className="vision-monitor-note">{t('updatePasswordBelow')}</p>

      <Form form={form} layout="vertical" onFinish={submit} style={{ maxWidth: 460 }}>
        <Form.Item
          label={t('currentPassword')}
          name="currentPassword"
          rules={[{ required: true, message: t('enterCurrentPassword') }]}
        >
          <Input.Password placeholder={t('currentPassword')} autoComplete="current-password" />
        </Form.Item>

        <Form.Item
          label={t('newPassword')}
          name="newPassword"
          rules={[{ required: true, min: 6, message: t('passwordMinLength') }]}
        >
          <Input.Password placeholder={t('newPassword')} autoComplete="new-password" />
        </Form.Item>

        <Form.Item
          label={t('confirmNewPassword')}
          name="confirmPassword"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: t('confirmNewPasswordRequired') },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('newPassword') === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error(t('passwordsDoNotMatch')));
              },
            }),
          ]}
        >
          <Input.Password placeholder={t('confirmNewPassword')} autoComplete="new-password" />
        </Form.Item>

        <Form.Item>
          <Button type="primary" className="vision-btn-primary" htmlType="submit" loading={saving}>
            {t('updatePassword')}
          </Button>
        </Form.Item>
      </Form>
    </section>
  );
}
