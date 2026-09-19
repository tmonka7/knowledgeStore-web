import { Button, Form, Input, Layout, Space, Tooltip, Typography } from 'antd';
import {
  CameraOutlined,
  LockOutlined,
  MailOutlined,
  UploadOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useEffect, useRef, useState } from 'react';
import {
  descriptorFromFile,
  descriptorFromImage,
  imageDataFromCanvas,
  imageDataFromFile,
} from '../lib/faceRecognition';

const { Content } = Layout;
const { Title, Text } = Typography;

function FaceCapture({ onDescriptor }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Add a clear face photo or use your camera.');

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);

  useEffect(() => {
    if (cameraOpen && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraOpen]);

  const processFace = async (source) => {
    setBusy(true);
    setStatus('Checking face...');
    try {
      const descriptor = source instanceof File ? await descriptorFromFile(source) : await descriptorFromImage(source);
      const faceImage = source instanceof File
        ? await imageDataFromFile(source)
        : imageDataFromCanvas(source);
      onDescriptor({ descriptor, faceImage });
      setStatus('Face captured.');
    } catch (error) {
      onDescriptor(null);
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  };

  const openCamera = async () => {
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      setCameraOpen(true);
      setStatus('Position your face in the camera, then capture.');
    } catch {
      setStatus('Camera access was denied. Choose an image instead.');
    }
  };

  const capture = async () => {
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    await processFace(canvas);
  };

  return (
    <div className="face-capture">
      <div className="face-capture-heading">
        <Text strong>Face verification</Text>
        <Text type="secondary">Use one clear face photo. It will be used to verify future logins.</Text>
      </div>
      <Text className={status === 'Face captured.' ? 'face-status-success' : 'face-status'}>{status}</Text>
      {cameraOpen && <video ref={videoRef} className="face-preview" autoPlay muted playsInline />}
      <Space className="face-actions" wrap>
        {!cameraOpen && (
          <Tooltip title="Open camera">
            <Button className="face-camera-button" type="primary" shape="circle" icon={<CameraOutlined />} onClick={openCamera} disabled={busy} aria-label="Open camera" />
          </Tooltip>
        )}
        {cameraOpen && <Button type="primary" icon={<CameraOutlined />} onClick={capture} loading={busy}>Capture Face</Button>}
        <label className="face-upload-button">
          <UploadOutlined /> Upload Photo
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => event.target.files?.[0] && processFace(event.target.files[0])}
          />
        </label>
      </Space>
    </div>
  );
}

function RegisterForm({ loading, faceError, onFaceDescriptor, onSubmit }) {
  const [registerForm] = Form.useForm();

  return (
    <Form form={registerForm} layout="vertical" onFinish={onSubmit}>
      <Form.Item name="fullName" label="Full Name" rules={[{ required: true, whitespace: true, message: 'Please enter your full name.' }]}><Input prefix={<UserOutlined />} autoComplete="name" placeholder="Full Name" /></Form.Item>
      <Form.Item name="username" label="Username" rules={[{ required: true, whitespace: true, message: 'Please enter a username.' }]}><Input prefix={<UserOutlined />} autoComplete="username" placeholder="Username" /></Form.Item>
      <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}><Input prefix={<MailOutlined />} placeholder="Email" /></Form.Item>
      <Form.Item name="password" label="Password" rules={[{ required: true, min: 6 }]}><Input.Password prefix={<LockOutlined />} placeholder="Password" /></Form.Item>
      <Form.Item name="confirmPassword" label="Confirm Password" dependencies={['password']} rules={[{ required: true, message: 'Please confirm your password.' }, ({ getFieldValue }) => ({ validator(_, value) { return !value || getFieldValue('password') === value ? Promise.resolve() : Promise.reject(new Error('Passwords do not match.')); } })]}><Input.Password prefix={<LockOutlined />} placeholder="Confirm Password" /></Form.Item>
      <FaceCapture onDescriptor={onFaceDescriptor} />
      {faceError && <Text type="danger" className="face-form-error">{faceError}</Text>}
      <Button type="primary" htmlType="submit" block loading={loading}>Create Account</Button>
    </Form>
  );
}

export default function AuthPage({ defaultUser, loading, loginForm, handleLogin, handleRegister }) {
  const [loginFaceData, setLoginFaceData] = useState(null);
  const [registerFaceData, setRegisterFaceData] = useState(null);
  const [faceError, setFaceError] = useState('');
  const [mode, setMode] = useState('login');

  const handleRegisterFace = (data) => {
    setRegisterFaceData(data);
    setFaceError(data ? '' : 'Please capture or upload a clear face photo before creating your account.');
  };

  const submitRegistration = (values) => {
    if (!registerFaceData) {
      setFaceError('Please capture or upload a clear face photo before creating your account.');
      return;
    }
    handleRegister({ ...values, faceDescriptor: registerFaceData.descriptor, faceImage: registerFaceData.faceImage });
  };

  return (
    <Layout className="auth-layout">
      <Content className="auth-shell">
        <div className="auth-card">
          <aside className="auth-brand-panel">
            <div className="auth-brand-mark"><CameraOutlined /></div>
            <Title level={4}>Face Recognition</Title>
            <Text>Secure access with your face.</Text>
            <div className="auth-face-illustration"><CameraOutlined /></div>
            <div className="auth-benefits"><span>Secure</span><span>Fast</span><span>Convenient</span></div>
          </aside>
          <section className="auth-form-panel">
            <div className="auth-form-heading">
              <Title level={2}>{mode === 'login' ? 'Login' : 'Register'}</Title>
              <Text type="secondary">{mode === 'login' ? 'Please enter your account information.' : 'Create your account and start using face recognition.'}</Text>
            </div>
            {mode === 'login' ? (
              <Form form={loginForm} layout="vertical" onFinish={(values) => handleLogin({ ...values, faceDescriptor: loginFaceData?.descriptor })} initialValues={defaultUser}>
                <Form.Item name="username" label="Username" rules={[{ required: true }]}><Input prefix={<UserOutlined />} placeholder="Username" /></Form.Item>
                <Form.Item name="password" label="Password" rules={[{ required: true }]}><Input.Password prefix={<LockOutlined />} placeholder="Password" /></Form.Item>
                <div className="auth-form-options"><label><input type="checkbox" /> Remember me</label><button type="button" className="auth-link">Forgot password?</button></div>
                <Button type="primary" htmlType="submit" block loading={loading}>Login</Button>
                <div className="auth-divider"><span>or</span></div>
                <FaceCapture onDescriptor={setLoginFaceData} />
                <Button className="face-login-button" htmlType="submit" block icon={<CameraOutlined />} loading={loading}>Login with Face</Button>
                <div className="auth-switch">Don't have an account? <button type="button" onClick={() => setMode('register')}>Register</button></div>
              </Form>
            ) : (
              <>
                <RegisterForm loading={loading} faceError={faceError} onFaceDescriptor={handleRegisterFace} onSubmit={submitRegistration} />
                <div className="auth-switch">Already have an account? <button type="button" onClick={() => setMode('login')}>Login</button></div>
              </>
            )}
          </section>
        </div>
      </Content>
    </Layout>
  );
}
