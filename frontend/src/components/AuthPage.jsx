import { Alert, Button, Checkbox, DatePicker, Form, Input, Layout, Modal, Select, Typography, message } from 'antd';
import {
  CameraOutlined,
  CheckCircleFilled,
  CheckSquareOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  HomeOutlined,
  LoadingOutlined,
  LockOutlined,
  MailOutlined,
  PhoneOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SolutionOutlined,
  UploadOutlined,
  UserOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useEffect, useRef, useState } from 'react';
import { FaceIdIcon, FaceScanArt } from './FaceArt';
import FaceRegistration from './face/FaceRegistration';
import {
  descriptorFromFile,
  descriptorFromImage,
  imageDataFromCanvas,
  imageDataFromFile,
} from '../lib/faceRecognition';
import { useLanguage } from '../i18n';

const { Content } = Layout;
const { Title, Text } = Typography;

const REMEMBER_KEY = 'rememberedUsername';
function FaceCapture({ onDescriptor, autoOpenCamera = false, hasError = false, idleText }) {
  const { t } = useLanguage();
  const videoRef = useRef(null);
  const fileRef = useRef(null);
  const streamRef = useRef(null);
  const mountedRef = useRef(false);
  const [stream, setStream] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState('');
  const [status, setStatus] = useState({ tone: 'idle', text: idleText });

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const closeCamera = () => {
    stopTracks();
    setStream(null);
  };

  const openCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus({ tone: 'error', text: t('cameraUnavailableUploadInstead') });
      return;
    }
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (!mountedRef.current) {
        nextStream.getTracks().forEach((track) => track.stop());
        return;
      }
      stopTracks();
      streamRef.current = nextStream;
      setStream(nextStream);
      setStatus({ tone: 'idle', text: t('centerFaceThenCapture') });
    } catch {
      setStatus({ tone: 'error', text: t('cameraAccessDeniedUploadInstead') });
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    if (autoOpenCamera) openCamera();
    return () => {
      mountedRef.current = false;
      stopTracks();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const processFace = async (source) => {
    setBusy(true);
    setStatus({ tone: 'busy', text: t('checkingFace') });
    try {
      const isFile = source instanceof File;
      const descriptor = isFile ? await descriptorFromFile(source) : await descriptorFromImage(source);
      const faceImage = isFile ? await imageDataFromFile(source) : imageDataFromCanvas(source);
      if (!mountedRef.current) return;
      setPreview(faceImage);
      setStatus({ tone: 'success', text: t('faceCapturedReady') });
      closeCamera();
      onDescriptor({ descriptor, faceImage });
    } catch (error) {
      if (!mountedRef.current) return;
      setPreview('');
      setStatus({ tone: 'error', text: error.message || t('unableToProcessPhoto') });
      onDescriptor(null);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const processFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatus({ tone: 'error', text: t('chooseImageFile') });
      return;
    }
    processFace(file);
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!video?.videoWidth) {
      setStatus({ tone: 'error', text: 'The camera is still starting. Try again in a moment.' });
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    await processFace(canvas);
  };

  const onDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    if (!busy) processFile(event.dataTransfer.files?.[0]);
  };

  const stateClass = [
    'face-capture',
    status.tone === 'success' && 'is-success',
    (status.tone === 'error' || hasError) && 'is-error',
    dragging && 'is-dragging',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={stateClass}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {stream && (
        <div className="face-camera">
          <video ref={videoRef} className="face-preview" autoPlay muted playsInline />
          <span className="face-camera-frame" aria-hidden="true" />
        </div>
      )}
      <div className="face-capture-row">
        <div className="face-capture-thumb">
          {preview ? <img src={preview} alt="Captured face" /> : <FaceIdIcon />}
          {status.tone === 'success' && <CheckCircleFilled className="face-capture-badge" />}
        </div>
        <div className="face-capture-text">
          <Text strong>{t('facePhoto')}</Text>
          <span className={`face-status face-status-${status.tone}`} role="status">
            {status.tone === 'busy' && <LoadingOutlined />} {status.text}
          </span>
        </div>
      </div>
      <div className="face-capture-actions">
        {stream ? (
          <>
            <Button type="primary" icon={<CameraOutlined />} onClick={capture} loading={busy}>{t('capture')}</Button>
            <Button icon={<CloseOutlined />} onClick={closeCamera} disabled={busy}>{t('cancel')}</Button>
          </>
        ) : (
          <>
            <Button icon={preview ? <ReloadOutlined /> : <CameraOutlined />} onClick={openCamera} disabled={busy}>
              {preview ? t('retake') : t('useCamera')}
            </Button>
            <Button icon={<UploadOutlined />} onClick={() => fileRef.current?.click()} loading={busy && !stream}>
              {t('uploadPhoto')}
            </Button>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Reset so choosing the same file again still fires onChange.
            event.target.value = '';
            processFile(file);
          }}
        />
      </div>
    </div>
  );
}

function RegisterForm({ loading, faceError, onFaceDescriptor, onSubmit }) {
  const { t } = useLanguage();
  const [registerForm] = Form.useForm();

  return (
    <Form form={registerForm} size="large" onFinish={onSubmit} requiredMark={false} scrollToFirstError>
      <Form.Item name="fullName" rules={[{ required: true, whitespace: true, message: t('enterFullName') }]}>
        <Input prefix={<UserOutlined />} autoComplete="name" placeholder={t('fullName')} />
      </Form.Item>
      <Form.Item
        name="username"
        normalize={(value) => value?.trim()}
        rules={[
          { required: true, message: t('enterUsername') },
          { min: 3, message: t('usernameMinLength') },
        ]}
      >
        <Input prefix={<UserOutlined />} autoComplete="username" placeholder={t('username')} />
      </Form.Item>
      <Form.Item
        name="email"
        normalize={(value) => value?.trim()}
        validateTrigger="onBlur"
        rules={[
          { required: true, message: t('enterEmail') },
          { type: 'email', message: t('validEmail') },
        ]}
      >
        <Input prefix={<MailOutlined />} autoComplete="email" placeholder={t('email')} />
      </Form.Item>
      <Form.Item
        name="password"
        rules={[
          { required: true, message: t('enterPassword') },
          { min: 6, message: t('passwordMinLength') },
        ]}
      >
        <Input.Password prefix={<LockOutlined />} autoComplete="new-password" placeholder={t('password')} />
      </Form.Item>
      <Form.Item
        name="confirmPassword"
        dependencies={['password']}
        rules={[
          { required: true, message: t('confirmYourPassword') },
          ({ getFieldValue }) => ({
            validator(_, value) {
              return !value || getFieldValue('password') === value
                ? Promise.resolve()
                : Promise.reject(new Error(t('passwordsDoNotMatch')));
            },
          }),
        ]}
      >
        <Input.Password prefix={<LockOutlined />} autoComplete="new-password" placeholder={t('confirmPassword')} />
      </Form.Item>
      {/* Personal details, all optional: nothing here blocks an account being
          created, and each one can be filled in later from My Page. */}
      <Form.Item name="gender">
        <Select
          allowClear
          placeholder={t('gender')}
          options={[
            { value: 'male', label: t('male') },
            { value: 'female', label: t('female') },
            { value: 'other', label: t('otherGender') },
          ]}
        />
      </Form.Item>
      <Form.Item name="birthday">
        <DatePicker
          style={{ width: '100%' }}
          format="YYYY-MM-DD"
          placeholder={t('birthday')}
          disabledDate={(current) => current && current > dayjs().endOf('day')}
        />
      </Form.Item>
      <Form.Item name="phone" rules={[{ max: 40, message: t('phoneTooLong') }]}>
        <Input prefix={<PhoneOutlined />} autoComplete="tel" placeholder={t('phoneNumber')} />
      </Form.Item>
      <Form.Item name="job" rules={[{ max: 80, message: t('jobTooLong') }]}>
        <Input prefix={<SolutionOutlined />} autoComplete="organization-title" placeholder={t('job')} />
      </Form.Item>
      <Form.Item name="address" rules={[{ max: 200, message: t('addressTooLong') }]}>
        <Input prefix={<HomeOutlined />} autoComplete="street-address" placeholder={t('address')} />
      </Form.Item>
      <FaceRegistration onChange={onFaceDescriptor} error={faceError} />
      <Button type="primary" htmlType="submit" block loading={loading}>{t('register')}</Button>
    </Form>
  );
}

export default function AuthPage({
  defaultUser,
  loading,
  loginForm,
  handleLogin,
  handleFaceLogin,
  handleRegister,
}) {
  const { t } = useLanguage();
  const [rememberedUsername] = useState(() => localStorage.getItem(REMEMBER_KEY) || '');
  const [remember, setRemember] = useState(Boolean(rememberedUsername));
  const [faceLoginOpen, setFaceLoginOpen] = useState(false);
  const [registerFaceData, setRegisterFaceData] = useState(null);
  const [faceError, setFaceError] = useState('');
  const [mode, setMode] = useState('login');
  const isLogin = mode === 'login';

  const switchMode = (nextMode) => {
    setRegisterFaceData(null);
    setFaceError('');
    setMode(nextMode);
  };

  const submitLogin = (values) => {
    if (remember) {
      localStorage.setItem(REMEMBER_KEY, values.username);
    } else {
      localStorage.removeItem(REMEMBER_KEY);
    }
    handleLogin(values);
  };

  /*
   * The two methods are alternatives, so this no longer asks the login form to
   * validate first. It used to: the face was a second factor on top of a
   * username and password, which meant "Login with Face" could not be used by
   * anyone who did not already know their password — not a second way in at
   * all. The camera opens straight away, and the face alone identifies you.
   */
  const startFaceLogin = () => setFaceLoginOpen(true);

  const handleLoginFace = (data) => {
    if (!data) return;
    setFaceLoginOpen(false);
    // No username is sent. The server searches every approved account for the
    // closest match; see loginWithFace.
    handleFaceLogin(data.descriptor);
  };

  const handleRegisterFace = (data) => {
    setRegisterFaceData(data);
    setFaceError(data ? '' : t('faceRequiredForRegistration'));
  };

  const submitRegistration = async ({ confirmPassword, ...values }) => {
    if (!registerFaceData) {
      setFaceError(t('faceRequiredForRegistration'));
      return;
    }
    const created = await handleRegister({
      ...values,
      // The picker hands back a dayjs; the API stores a calendar day.
      birthday: values.birthday ? values.birthday.format('YYYY-MM-DD') : '',
      gender: values.gender || '',
      faceDescriptor: registerFaceData.descriptor,
      faceImage: registerFaceData.faceImage,
    });

    // Registering no longer signs you in — the account is created and waits
    // for an administrator — so the card goes back to the login side rather
    // than sitting on a filled-in form that has already been submitted.
    if (created) switchMode('login');
  };

  return (
    <Layout className="auth-layout">
      <Content className="auth-shell">
        <div className={`auth-card auth-card-${mode}`}>
          <aside className="auth-brand-panel">
            <div className="auth-brand">
              <span className="auth-brand-mark"><FaceIdIcon /></span>
              <span className="auth-brand-text">
                <span className="auth-brand-name">VisionAI</span>
                <span className="auth-brand-tagline">AI Security Platform</span>
              </span>
            </div>
            {isLogin ? (
              <div className="auth-brand-copy">
                <strong>{t('secureAccess')}</strong>
                  <span>{t('faceLoginDescription')}</span>
              </div>
            ) : (
              <div className="auth-brand-copy">
                <span>{t('createAccountDescription')}</span>
              </div>
            )}
            <FaceScanArt mesh={isLogin} />
            {!isLogin && (
              <ul className="auth-benefits">
                <li><SafetyCertificateOutlined /> {t('secure')}</li>
                <li><ClockCircleOutlined /> {t('fast')}</li>
                <li><CheckSquareOutlined /> {t('convenient')}</li>
              </ul>
            )}
          </aside>
          <section className="auth-form-panel">
            <div className="auth-form-heading">
              <Title level={2}>{isLogin ? t('login') : t('register')}</Title>
              <Text type="secondary">{isLogin ? t('enterAccountInformation') : t('fillInformationBelow')}</Text>
            </div>
            {isLogin ? (
              <Form
                form={loginForm}
                size="large"
                requiredMark={false}
                onFinish={(values) => submitLogin(values)}
                initialValues={rememberedUsername ? { username: rememberedUsername } : defaultUser}
              >
                <Form.Item name="username" normalize={(value) => value?.trim()} rules={[{ required: true, message: t('enterUsername') }]}>
                  <Input prefix={<UserOutlined />} autoComplete="username" placeholder="Username" />
                </Form.Item>
                <Form.Item name="password" rules={[{ required: true, message: t('enterPassword') }]}>
                  <Input.Password prefix={<LockOutlined />} autoComplete="current-password" placeholder="Password" />
                </Form.Item>
                <div className="auth-form-options">
                  <Checkbox checked={remember} onChange={(event) => setRemember(event.target.checked)}>{t('rememberMe')}</Checkbox>
                  <button type="button" className="auth-link" onClick={() => message.info(t('contactAdministratorResetPassword'))}>
                    {t('forgotPassword')}
                  </button>
                </div>
                <Button type="primary" htmlType="submit" block loading={loading}>{t('login')}</Button>
                <div className="auth-divider"><span>{t('or')}</span></div>
                <Button className="face-login-button" block icon={<FaceIdIcon />} onClick={startFaceLogin} disabled={loading}>
                  {t('loginWithFace')}
                </Button>
                <div className="auth-switch">{t('noAccount')} <button type="button" onClick={() => switchMode('register')}>{t('register')}</button></div>
              </Form>
            ) : (
              <>
                {/* Said before the form is filled in rather than after it is
                    sent: someone expecting to be signed in at the end should
                    find that out now, not from a message that flashes past. */}
                <Alert
                  type="info"
                  showIcon
                  className="auth-pending-note"
                  message={t('registrationNeedsApproval')}
                />
                <RegisterForm loading={loading} faceError={faceError} onFaceDescriptor={handleRegisterFace} onSubmit={submitRegistration} />
                <div className="auth-switch">{t('alreadyHaveAccount')} <button type="button" onClick={() => switchMode('login')}>{t('login')}</button></div>
              </>
            )}
          </section>
        </div>
      </Content>
      <Modal
        title={t('loginWithFace')}
        open={faceLoginOpen}
        onCancel={() => setFaceLoginOpen(false)}
        footer={null}
        width={400}
        centered
        destroyOnClose
      >
        <div className="face-login-modal">
          <FaceCapture
            autoOpenCamera
            onDescriptor={handleLoginFace}
            idleText={t('lookAtCameraToVerify')}
          />
        </div>
      </Modal>
    </Layout>
  );
}
