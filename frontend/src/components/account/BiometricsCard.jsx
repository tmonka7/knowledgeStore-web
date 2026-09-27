import { useEffect, useState } from 'react';
import { Alert, Avatar, Button, Form, Input, message } from 'antd';
import {
  AudioOutlined, CameraOutlined, CheckCircleFilled, ExclamationCircleFilled, ScanOutlined, UserOutlined,
} from '@ant-design/icons';
import api from '../../api';
import CameraRegistrationModal from '../face/CameraRegistrationModal';
import VoiceEnrollment, { clipsToDataUrls } from '../voice/VoiceEnrollment';
import { useLanguage } from '../../i18n';

const formatDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' });
};

/**
 * Your own face and voice — the two ways to sign in besides the password.
 *
 * Changes are drafted here and sent together with the current password,
 * which the API requires (PUT /user/biometrics): a session left open should
 * not be enough to enrol somebody else's face or voice on the account. A new
 * face comes from the camera only, as at sign-up and on the Users page.
 */
export default function BiometricsCard({ user, onSubmit }) {
  const { t } = useLanguage();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  // Face: null (unchanged), { descriptor, faceImage } (new), or 'remove'.
  const [face, setFace] = useState(null);
  // Voice: 'idle', 'record' (new clips being taken) or 'remove'.
  const [voiceMode, setVoiceMode] = useState('idle');
  const [voiceDraft, setVoiceDraft] = useState({ clips: [], done: false });
  const [voiceAvailable, setVoiceAvailable] = useState(false);

  useEffect(() => {
    api.get('/auth/voice').then(({ data }) => setVoiceAvailable(Boolean(data.available))).catch(() => {});
  }, []);

  const reset = () => {
    setFace(null);
    setVoiceMode('idle');
    setVoiceDraft({ clips: [], done: false });
    form.resetFields();
  };

  const hasFace = Boolean(user?.faceImage);
  const newFace = face && face !== 'remove' ? face : null;
  const photo = face === 'remove' ? '' : newFace?.faceImage || user?.faceImage || '';
  const voiceChange = (voiceMode === 'record' && voiceDraft.done) || voiceMode === 'remove';
  const changed = Boolean(face) || voiceChange;

  const submit = async ({ currentPassword }) => {
    // A half-recorded voice would otherwise be dropped without a word.
    if (voiceMode === 'record' && voiceDraft.clips.length && !voiceDraft.done) {
      message.warning(t('voiceEnrollIncomplete'));
      return;
    }
    setSaving(true);
    const ok = await onSubmit({
      currentPassword,
      ...(newFace ? { faceDescriptor: newFace.descriptor, faceImage: newFace.faceImage } : {}),
      ...(face === 'remove' ? { removeFace: true } : {}),
      ...(voiceMode === 'record' && voiceDraft.done ? { voiceClips: await clipsToDataUrls(voiceDraft.clips) } : {}),
      ...(voiceMode === 'remove' ? { removeVoice: true } : {}),
    });
    setSaving(false);
    if (ok) reset();
  };

  return (
    <section className="vision-panel vision-panel-tight">
      <div className="vision-panel-head">
        <div className="vision-panel-head-title">
          <span className="vision-panel-icon"><ScanOutlined /></span>
          <h3 className="vision-section-title">{t('biometricsTitle')}</h3>
        </div>
      </div>

      <p className="vision-monitor-note">{t('biometricsHelp')}</p>

      <div className="account-biometrics">
        <div className="account-biometric">
          <div className="account-biometric-head">
            {photo
              ? <img className="account-profile-photo" src={photo} alt={t('biometricsFace')} />
              : <Avatar size={72} icon={<UserOutlined />} className="vision-cell-avatar" />}
            <div>
              <strong>{t('biometricsFace')}</strong>
              <p className={`account-biometric-state${hasFace ? '' : ' is-missing'}`}>
                {hasFace ? <CheckCircleFilled /> : <ExclamationCircleFilled />}
                {hasFace ? t('biometricsFaceRegistered') : t('biometricsFaceMissing')}
              </p>
            </div>
          </div>

          {!face && (
            <div className="account-biometric-actions">
              <Button icon={<CameraOutlined />} onClick={() => setCameraOpen(true)}>
                {hasFace ? t('changeFacePhoto') : t('biometricsFaceAdd')}
              </Button>
              {hasFace && <Button danger onClick={() => setFace('remove')}>{t('biometricsFaceRemove')}</Button>}
            </div>
          )}
          {newFace && (
            <Alert
              type="success"
              showIcon
              message={t('biometricsFaceReady')}
              action={<Button size="small" onClick={() => setFace(null)}>{t('undo')}</Button>}
            />
          )}
          {face === 'remove' && (
            <Alert
              type="warning"
              showIcon
              message={t('biometricsFaceWillBeRemoved')}
              action={<Button size="small" onClick={() => setFace(null)}>{t('undo')}</Button>}
            />
          )}
        </div>

        {voiceAvailable && (
          <div className="account-biometric">
            <div className="account-biometric-head">
              <Avatar size={72} icon={<AudioOutlined />} className="vision-cell-avatar" />
              <div>
                <strong>{t('voiceSignIn')}</strong>
                <p className={`account-biometric-state${user?.hasVoice ? '' : ' is-missing'}`}>
                  {user?.hasVoice ? <CheckCircleFilled /> : <ExclamationCircleFilled />}
                  {user?.hasVoice ? t('voiceEnrolledOn', { date: formatDate(user.voiceEnrolledAt) }) : t('voiceNotEnrolled')}
                </p>
              </div>
            </div>

            {voiceMode === 'idle' && (
              <div className="account-biometric-actions">
                <Button icon={<AudioOutlined />} onClick={() => setVoiceMode('record')}>
                  {user?.hasVoice ? t('voiceReRecord') : t('voiceRecord')}
                </Button>
                {user?.hasVoice && <Button danger onClick={() => setVoiceMode('remove')}>{t('voiceRemove')}</Button>}
              </div>
            )}
            {voiceMode === 'record' && (
              <>
                <VoiceEnrollment onChange={(clips, done) => setVoiceDraft({ clips, done })} />
                {voiceDraft.done && <Alert type="success" showIcon message={t('voiceReadyToSave')} />}
                <Button type="link" onClick={() => { setVoiceMode('idle'); setVoiceDraft({ clips: [], done: false }); }}>
                  {t('cancel')}
                </Button>
              </>
            )}
            {voiceMode === 'remove' && (
              <Alert
                type="warning"
                showIcon
                message={t('voiceWillBeRemoved')}
                action={<Button size="small" onClick={() => setVoiceMode('idle')}>{t('undo')}</Button>}
              />
            )}
          </div>
        )}
      </div>

      {changed && (
        <Form form={form} layout="vertical" onFinish={submit} className="account-biometrics-save">
          <Form.Item
            label={t('currentPassword')}
            name="currentPassword"
            extra={t('biometricsPasswordHelp')}
            rules={[{ required: true, message: t('enterCurrentPassword') }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <div className="account-biometric-actions">
            <Button type="primary" className="vision-btn-primary" htmlType="submit" loading={saving}>
              {t('biometricsSave')}
            </Button>
            <Button onClick={reset} disabled={saving}>{t('cancel')}</Button>
          </div>
        </Form>
      )}

      <CameraRegistrationModal
        open={cameraOpen}
        mode="camera"
        onCancel={() => setCameraOpen(false)}
        onComplete={({ descriptor, faceImage }) => {
          setFace({ descriptor, faceImage });
          setCameraOpen(false);
        }}
      />
    </section>
  );
}
