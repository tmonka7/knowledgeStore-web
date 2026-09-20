import { Button, Checkbox, Form, Input, Layout, Modal, Typography, message } from 'antd';
import {
  CameraOutlined,
  CheckCircleFilled,
  CheckSquareOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  LoadingOutlined,
  LockOutlined,
  MailOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  UploadOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useEffect, useRef, useState } from 'react';
import { FaceIdIcon, FaceScanArt } from './FaceArt';
import {
  descriptorFromFile,
  descriptorFromImage,
  imageDataFromCanvas,
  imageDataFromFile,
} from '../lib/faceRecognition';

const { Content } = Layout;
const { Title, Text } = Typography;

const REMEMBER_KEY = 'rememberedUsername';
const FACE_REQUIRED_MESSAGE = 'Please take or upload a clear face photo before registering.';

function FaceCapture({ onDescriptor, autoOpenCamera = false, hasError = false, idleText }) {
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
      setStatus({ tone: 'error', text: 'Camera is not available in this browser. Upload a photo instead.' });
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
      setStatus({ tone: 'idle', text: 'Center your face in the frame, then capture.' });
    } catch {
      setStatus({ tone: 'error', text: 'Camera access was denied. Upload a photo instead.' });
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
    setStatus({ tone: 'busy', text: 'Checking face...' });
    try {
      const isFile = source instanceof File;
      const descriptor = isFile ? await descriptorFromFile(source) : await descriptorFromImage(source);
      const faceImage = isFile ? await imageDataFromFile(source) : imageDataFromCanvas(source);
      if (!mountedRef.current) return;
      setPreview(faceImage);
      setStatus({ tone: 'success', text: 'Face captured. You are all set.' });
      closeCamera();
      onDescriptor({ descriptor, faceImage });
    } catch (error) {
      if (!mountedRef.current) return;
      setPreview('');
      setStatus({ tone: 'error', text: error.message || 'Unable to process that photo.' });
      onDescriptor(null);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const processFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatus({ tone: 'error', text: 'Please choose an image file.' });
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
          <Text strong>Face photo</Text>
          <span className={`face-status face-status-${status.tone}`} role="status">
            {status.tone === 'busy' && <LoadingOutlined />} {status.text}
          </span>
        </div>
      </div>
      <div className="face-capture-actions">
        {stream ? (
          <>
            <Button type="primary" icon={<CameraOutlined />} onClick={capture} loading={busy}>Capture</Button>
            <Button icon={<CloseOutlined />} onClick={closeCamera} disabled={busy}>Cancel</Button>
          </>
        ) : (
          <>
            <Button icon={preview ? <ReloadOutlined /> : <CameraOutlined />} onClick={openCamera} disabled={busy}>
              {preview ? 'Retake' : 'Use Camera'}
            </Button>
            <Button icon={<UploadOutlined />} onClick={() => fileRef.current?.click()} loading={busy && !stream}>
              Upload Photo
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
  const [registerForm] = Form.useForm();

  return (
    <Form form={registerForm} size="large" onFinish={onSubmit} requiredMark={false} scrollToFirstError>
      <Form.Item name="fullName" rules={[{ required: true, whitespace: true, message: 'Please enter your full name.' }]}>
        <Input prefix={<UserOutlined />} autoComplete="name" placeholder="Full Name" />
      </Form.Item>
      <Form.Item
        name="username"
        normalize={(value) => value?.trim()}
        rules={[
          { required: true, message: 'Please enter a username.' },
          { min: 3, message: 'Username must be at least 3 characters.' },
        ]}
      >
        <Input prefix={<UserOutlined />} autoComplete="username" placeholder="Username" />
      </Form.Item>
      <Form.Item
        name="email"
        normalize={(value) => value?.trim()}
        validateTrigger="onBlur"
        rules={[
          { required: true, message: 'Please enter your email.' },
          { type: 'email', message: 'Please enter a valid email address.' },
        ]}
      >
        <Input prefix={<MailOutlined />} autoComplete="email" placeholder="Email" />
      </Form.Item>
      <Form.Item
        name="password"
        rules={[
          { required: true, message: 'Please enter a password.' },
          { min: 6, message: 'Password must be at least 6 characters.' },
        ]}
      >
        <Input.Password prefix={<LockOutlined />} autoComplete="new-password" placeholder="Password" />
      </Form.Item>
      <Form.Item
        name="confirmPassword"
        dependencies={['password']}
        rules={[
          { required: true, message: 'Please confirm your password.' },
          ({ getFieldValue }) => ({
            validator(_, value) {
              return !value || getFieldValue('password') === value
                ? Promise.resolve()
                : Promise.reject(new Error('Passwords do not match.'));
            },
          }),
        ]}
      >
        <Input.Password prefix={<LockOutlined />} autoComplete="new-password" placeholder="Confirm Password" />
      </Form.Item>
      <FaceCapture
        onDescriptor={onFaceDescriptor}
        hasError={Boolean(faceError)}
        idleText="Take a photo or upload one. It verifies your future logins."
      />
      {faceError && <Text type="danger" className="face-form-error">{faceError}</Text>}
      <Button type="primary" htmlType="submit" block loading={loading}>Register</Button>
    </Form>
  );
}

export default function AuthPage({ defaultUser, loading, loginForm, handleLogin, handleRegister }) {
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

  const submitLogin = (values, faceDescriptor) => {
    if (remember) {
      localStorage.setItem(REMEMBER_KEY, values.username);
    } else {
      localStorage.removeItem(REMEMBER_KEY);
    }
    handleLogin({ ...values, faceDescriptor });
  };

  const startFaceLogin = async () => {
    try {
      await loginForm.validateFields();
      setFaceLoginOpen(true);
    } catch {
      // The form shows which field is missing.
    }
  };

  const handleLoginFace = (data) => {
    if (!data) return;
    setFaceLoginOpen(false);
    submitLogin(loginForm.getFieldsValue(['username', 'password']), data.descriptor);
  };

  const handleRegisterFace = (data) => {
    setRegisterFaceData(data);
    setFaceError(data ? '' : FACE_REQUIRED_MESSAGE);
  };

  const submitRegistration = ({ confirmPassword, ...values }) => {
    if (!registerFaceData) {
      setFaceError(FACE_REQUIRED_MESSAGE);
      return;
    }
    handleRegister({ ...values, faceDescriptor: registerFaceData.descriptor, faceImage: registerFaceData.faceImage });
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
                <strong>Secure Access</strong>
                <span>Use your face to login to the system</span>
              </div>
            ) : (
              <div className="auth-brand-copy">
                <span>Create your account and start using face recognition.</span>
              </div>
            )}
            <FaceScanArt mesh={isLogin} />
            {!isLogin && (
              <ul className="auth-benefits">
                <li><SafetyCertificateOutlined /> Secure</li>
                <li><ClockCircleOutlined /> Fast</li>
                <li><CheckSquareOutlined /> Convenient</li>
              </ul>
            )}
          </aside>
          <section className="auth-form-panel">
            <div className="auth-form-heading">
              <Title level={2}>{isLogin ? 'Login' : 'Register'}</Title>
              <Text type="secondary">{isLogin ? 'Please enter your account information.' : 'Please fill in the information below.'}</Text>
            </div>
            {isLogin ? (
              <Form
                form={loginForm}
                size="large"
                requiredMark={false}
                onFinish={(values) => submitLogin(values)}
                initialValues={rememberedUsername ? { username: rememberedUsername } : defaultUser}
              >
                <Form.Item name="username" normalize={(value) => value?.trim()} rules={[{ required: true, message: 'Please enter your username.' }]}>
                  <Input prefix={<UserOutlined />} autoComplete="username" placeholder="Username" />
                </Form.Item>
                <Form.Item name="password" rules={[{ required: true, message: 'Please enter your password.' }]}>
                  <Input.Password prefix={<LockOutlined />} autoComplete="current-password" placeholder="Password" />
                </Form.Item>
                <div className="auth-form-options">
                  <Checkbox checked={remember} onChange={(event) => setRemember(event.target.checked)}>Remember me</Checkbox>
                  <button type="button" className="auth-link" onClick={() => message.info('Please contact your administrator to reset your password.')}>
                    Forgot password?
                  </button>
                </div>
                <Button type="primary" htmlType="submit" block loading={loading}>Login</Button>
                <div className="auth-divider"><span>or</span></div>
                <Button className="face-login-button" block icon={<FaceIdIcon />} onClick={startFaceLogin} disabled={loading}>
                  Login with Face
                </Button>
                <div className="auth-switch">Don't have an account? <button type="button" onClick={() => switchMode('register')}>Register</button></div>
              </Form>
            ) : (
              <>
                <RegisterForm loading={loading} faceError={faceError} onFaceDescriptor={handleRegisterFace} onSubmit={submitRegistration} />
                <div className="auth-switch">Already have an account? <button type="button" onClick={() => switchMode('login')}>Login</button></div>
              </>
            )}
          </section>
        </div>
      </Content>
      <Modal
        title="Login with Face"
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
            idleText="Look at the camera, then capture to verify it is you."
          />
        </div>
      </Modal>
    </Layout>
  );
}
