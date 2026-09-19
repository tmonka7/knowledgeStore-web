import { useEffect, useState } from 'react';
import { Button, Card, Form, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { CameraOutlined, DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import api from '../api';
import CameraViewPage from './CameraViewPage';
import CameraWallPage from './CameraWallPage';

const { Title, Text } = Typography;

const statusColors = { online: 'green', offline: 'default', maintenance: 'orange' };

export default function CamerasPage({ cameras, setCameras }) {
  const [form] = Form.useForm();
  const [editingCamera, setEditingCamera] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewingCamera, setViewingCamera] = useState(null);
  const [showCameraWall, setShowCameraWall] = useState(false);

  const loadCameras = async () => {
    try {
      const { data } = await api.get('/cameras');
      setCameras(data.cameras || []);
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to load cameras.');
    }
  };

  useEffect(() => {
    loadCameras();
  }, []);

  const openCameraForm = (camera = null) => {
    setEditingCamera(camera);
    form.setFieldsValue(camera || { status: 'offline' });
    setModalOpen(true);
  };

  const saveCamera = async (values) => {
    setSaving(true);
    try {
      if (editingCamera) {
        await api.put(`/cameras/${editingCamera.id}`, values);
      } else {
        await api.post('/cameras', values);
      }
      message.success(editingCamera ? 'Camera updated.' : 'Camera added.');
      setModalOpen(false);
      form.resetFields();
      await loadCameras();
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to save camera.');
    } finally {
      setSaving(false);
    }
  };

  const removeCamera = (camera) => {
    Modal.confirm({
      title: `Delete ${camera.name}?`,
      content: 'This action cannot be undone.',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.delete(`/cameras/${camera.id}`);
          message.success('Camera deleted.');
          await loadCameras();
        } catch (error) {
          message.error(error.response?.data?.message || 'Unable to delete camera.');
        }
      },
    });
  };

  const columns = [
    { title: 'Camera', dataIndex: 'name', key: 'name', render: (name, camera) => <Button type="link" className="camera-name-link" icon={<CameraOutlined />} onClick={() => setViewingCamera(camera)}>{name}</Button> },
    { title: 'Location', dataIndex: 'location', key: 'location' },
    { title: 'IP / Stream URL', dataIndex: 'address', key: 'address' },
    { title: 'Status', dataIndex: 'status', key: 'status', render: (status) => <Tag color={statusColors[status]}>{status.toUpperCase()}</Tag> },
    {
      title: 'Actions', key: 'actions', render: (_, camera) => (
        <Space>
          <Button type="text" icon={<EyeOutlined />} onClick={() => setViewingCamera(camera)} aria-label={`View ${camera.name}`} />
          <Button type="text" icon={<EditOutlined />} onClick={() => openCameraForm(camera)} aria-label={`Edit ${camera.name}`} />
          <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeCamera(camera)} aria-label={`Delete ${camera.name}`} />
        </Space>
      ),
    },
  ];

  if (viewingCamera) {
    const currentCamera = cameras.find((camera) => camera.id === viewingCamera.id) || viewingCamera;
    return <CameraViewPage camera={currentCamera} onBack={() => setViewingCamera(null)} />;
  }

  if (showCameraWall) {
    return <CameraWallPage cameras={cameras} onBack={() => setShowCameraWall(false)} />;
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card>
        <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
          <div>
            <Title level={3} style={{ margin: 0 }}>Camera Management</Title>
            <Text type="secondary">Register and maintain cameras connected to the system.</Text>
          </div>
          <Space>
            <Button onClick={() => setShowCameraWall(true)} icon={<CameraOutlined />}>Live Camera View</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openCameraForm()}>Add Camera</Button>
          </Space>
        </Space>
      </Card>

      <Card>
        <Table rowKey="id" dataSource={cameras} columns={columns} locale={{ emptyText: 'No cameras registered yet.' }} />
      </Card>

      <Modal
        title={editingCamera ? 'Edit Camera' : 'Add Camera'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={saveCamera} preserve={false}>
          <Form.Item name="name" label="Camera name" rules={[{ required: true, message: 'Enter a camera name.' }]}>
            <Input placeholder="Front entrance" />
          </Form.Item>
          <Form.Item name="location" label="Location" rules={[{ required: true, message: 'Enter the camera location.' }]}>
            <Input placeholder="Building A / Floor 1" />
          </Form.Item>
          <Form.Item name="address" label="IP address or stream URL" rules={[{ required: true, message: 'Enter an IP address or stream URL.' }]}>
            <Input placeholder="rtsp://192.168.1.20/stream" />
          </Form.Item>
          <Form.Item name="status" label="Status" rules={[{ required: true }]}>
            <Select options={[{ value: 'online', label: 'Online' }, { value: 'offline', label: 'Offline' }, { value: 'maintenance', label: 'Maintenance' }]} />
          </Form.Item>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={3} placeholder="Optional notes" />
          </Form.Item>
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={saving}>Save Camera</Button>
          </Space>
        </Form>
      </Modal>
    </Space>
  );
}
