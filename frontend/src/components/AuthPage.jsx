import {
  Alert,
  Avatar,
  Button,
  Card,
  Col,
  Form,
  Input,
  Layout,
  Row,
  Space,
  Tabs,
  Typography,
} from 'antd';
import { useEffect, useRef, useState } from 'react';
import { descriptorFromFile, descriptorFromImage } from '../lib/faceRecognition';

const { Content } = Layout;
const { Title, Text } = Typography;

function FaceCapture({ onDescriptor }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Add a clear face photo or use your camera.');

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);

  const processFace = async (source) => {
    setBusy(true);
    setStatus('Checking face...');
    try {
      const descriptor = source instanceof File ? await descriptorFromFile(source) : await descriptorFromImage(source);
      onDescriptor(descriptor);
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
      videoRef.current.srcObject = streamRef.current;
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
      <Text strong>Face verification</Text>
      <Text type="secondary">{status}</Text>
      {cameraOpen && <video ref={videoRef} className="face-preview" autoPlay muted playsInline />}
      <Space wrap>
        {!cameraOpen && <Button onClick={openCamera} disabled={busy}>Use Camera</Button>}
        {cameraOpen && <Button onClick={capture} loading={busy}>Capture Face</Button>}
        <label className="face-upload-button">
          Choose Image
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

export default function AuthPage({ defaultUser, loading, loginForm, handleLogin, handleRegister }) {
  const [faceDescriptor, setFaceDescriptor] = useState(null);

  return (
    <Layout className="auth-layout">
      <Content className="auth-shell">
        <Row justify="center" align="middle" style={{ minHeight: '100vh' }}>
          <Col xs={22} sm={18} md={12} lg={8}>
            <Card className="auth-card" bordered={false}>
              <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <div style={{ textAlign: 'center' }}>
                  <Avatar size={64} style={{ backgroundColor: '#1677ff' }}>KS</Avatar>
                  <Title level={3} style={{ marginTop: 16 }}>Knowledge Store</Title>
                  <Text type="secondary">Login or create an account</Text>
                </div>

                <Tabs
                  defaultActiveKey="login"
                  items={[
                    {
                      key: 'login',
                      label: 'Login',
                      children: (
                        <Form form={loginForm} layout="vertical" onFinish={(values) => handleLogin({ ...values, faceDescriptor })} initialValues={defaultUser}>
                          <Form.Item name="username" label="Username" rules={[{ required: true }]}> <Input /> </Form.Item>
                          <Form.Item name="password" label="Password" rules={[{ required: true }]}> <Input.Password /> </Form.Item>
                          <FaceCapture onDescriptor={setFaceDescriptor} />
                          <Button type="primary" htmlType="submit" block loading={loading}>Sign In</Button>
                        </Form>
                      ),
                    },
                    {
                      key: 'register',
                      label: 'Register',
                      children: (
                        <Form layout="vertical" onFinish={(values) => handleRegister({ ...values, faceDescriptor })}>
                          <Form.Item name="fullName" label="Full Name" rules={[{ required: true }]}> <Input /> </Form.Item>
                          <Form.Item name="username" label="Username" rules={[{ required: true }]}> <Input /> </Form.Item>
                          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}> <Input /> </Form.Item>
                          <Form.Item name="password" label="Password" rules={[{ required: true, min: 6 }]}> <Input.Password /> </Form.Item>
                          <FaceCapture onDescriptor={setFaceDescriptor} />
                          <Button type="primary" htmlType="submit" block loading={loading}>Create Account</Button>
                        </Form>
                      ),
                    },
                  ]}
                />
              </Space>
            </Card>
          </Col>
        </Row>
      </Content>
    </Layout>
  );
}
