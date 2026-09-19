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
  Select,
  Space,
  Tabs,
  Typography,
} from 'antd';

const { Content } = Layout;
const { Title, Text } = Typography;

export default function AuthPage({ defaultUser, loading, loginForm, handleLogin, handleRegister }) {
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
                        <Form form={loginForm} layout="vertical" onFinish={handleLogin} initialValues={defaultUser}>
                          <Form.Item name="username" label="Username" rules={[{ required: true }]}> <Input /> </Form.Item>
                          <Form.Item name="password" label="Password" rules={[{ required: true }]}> <Input.Password /> </Form.Item>
                          <Button type="primary" htmlType="submit" block loading={loading}>Sign In</Button>
                        </Form>
                      ),
                    },
                    {
                      key: 'register',
                      label: 'Register',
                      children: (
                        <Form layout="vertical" onFinish={handleRegister} initialValues={{ role: 'user' }}>
                          <Form.Item name="fullName" label="Full Name" rules={[{ required: true }]}> <Input /> </Form.Item>
                          <Form.Item name="username" label="Username" rules={[{ required: true }]}> <Input /> </Form.Item>
                          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}> <Input /> </Form.Item>
                          <Form.Item name="password" label="Password" rules={[{ required: true, min: 6 }]}> <Input.Password /> </Form.Item>
                          <Form.Item name="role" label="Role">
                            <Select options={[{ value: 'user', label: 'User' }, { value: 'admin', label: 'Admin' }]} />
                          </Form.Item>
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
