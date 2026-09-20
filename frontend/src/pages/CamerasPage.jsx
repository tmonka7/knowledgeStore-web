import { useEffect, useMemo, useState } from 'react';
import { Button, Form, Input, Modal, Select, Space, message } from 'antd';
import {
  AppstoreOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  HeartOutlined,
  PlusOutlined,
  SearchOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import api from '../api';
import CameraCard from '../components/CameraCard';
import FilterBar from '../components/ui/FilterBar';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import CameraViewPage from './CameraViewPage';
import CameraWallPage from './CameraWallPage';

export default function CamerasPage({ cameras, setCameras }) {
  const [form] = Form.useForm();
  const [editingCamera, setEditingCamera] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewingCamera, setViewingCamera] = useState(null);
  const [showCameraWall, setShowCameraWall] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');

  const onlineCount = cameras.filter((camera) => camera.status === 'online').length;
  const offlineCount = cameras.filter((camera) => camera.status !== 'online').length;
  const healthRate = cameras.length ? Math.round((onlineCount / cameras.length) * 100) : 100;
  const percentOfCameras = (count) => (cameras.length
    ? `${Math.round((count / cameras.length) * 100)}% of total`
    : '0% of total');

  const locations = useMemo(
    () => [...new Set(cameras.map((camera) => camera.location).filter(Boolean))].sort(),
    [cameras],
  );

  const visibleCameras = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return cameras.filter((camera) => {
      if (statusFilter !== 'all' && camera.status !== statusFilter) return false;
      if (locationFilter !== 'all' && camera.location !== locationFilter) return false;
      if (!needle) return true;
      return [camera.name, camera.location, camera.address]
        .some((field) => String(field || '').toLowerCase().includes(needle));
    });
  }, [cameras, search, statusFilter, locationFilter]);

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

  if (viewingCamera) {
    const currentCamera = cameras.find((camera) => camera.id === viewingCamera.id) || viewingCamera;
    return <CameraViewPage camera={currentCamera} onBack={() => setViewingCamera(null)} />;
  }

  if (showCameraWall) {
    return <CameraWallPage cameras={cameras} onBack={() => setShowCameraWall(false)} />;
  }

  return (
    <div className="vision-page">
      <PageHeader
        title="Camera Management"
        subtitle="Manage and monitor your camera devices."
        actions={(
          <>
            <Button className="vision-btn-ghost" icon={<AppstoreOutlined />} onClick={() => setShowCameraWall(true)}>
              Live Camera View
            </Button>
            <Button type="primary" className="vision-btn-primary" icon={<PlusOutlined />} onClick={() => openCameraForm()}>
              Add Camera
            </Button>
          </>
        )}
      />

      <div className="vision-stat-grid">
        <StatCard
          tone="blue"
          icon={<VideoCameraOutlined />}
          label="Total Cameras"
          value={cameras.length}
          meta={`${onlineCount} online, ${offlineCount} offline`}
        />
        <StatCard
          tone="green"
          icon={<CheckCircleOutlined />}
          label="Online"
          value={onlineCount}
          meta={`${percentOfCameras(onlineCount)} of total`}
          trend={onlineCount > 0 ? 'up' : undefined}
        />
        <StatCard
          tone="red"
          icon={<CloseCircleOutlined />}
          label="Offline"
          value={offlineCount}
          meta={`${percentOfCameras(offlineCount)} of total`}
        />
        <StatCard
          tone="violet"
          icon={<HeartOutlined />}
          label="Health Rate"
          value={`${healthRate}%`}
          meta={healthRate === 100 ? 'System normal' : 'Needs attention'}
          trend={healthRate === 100 ? 'up' : 'down'}
        />
      </div>

      <FilterBar
        actions={(
          <Button type="primary" className="vision-btn-primary" icon={<PlusOutlined />} onClick={() => openCameraForm()}>
            Add Camera
          </Button>
        )}
      >
        <Input
          allowClear
          className="vision-filter-search"
          prefix={<SearchOutlined />}
          placeholder="Search camera name or location..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select
          className="vision-filter-select"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'all', label: 'All Status' },
            { value: 'online', label: 'Online' },
            { value: 'offline', label: 'Offline' },
            { value: 'maintenance', label: 'Maintenance' },
          ]}
        />
        <Select
          className="vision-filter-select"
          value={locationFilter}
          onChange={setLocationFilter}
          options={[
            { value: 'all', label: 'All Locations' },
            ...locations.map((location) => ({ value: location, label: location })),
          ]}
        />
      </FilterBar>

      {visibleCameras.length ? (
        <div className="vision-camera-grid">
          {visibleCameras.map((camera) => (
            <CameraCard
              key={camera.id}
              camera={camera}
              onView={() => setViewingCamera(camera)}
              onEdit={() => openCameraForm(camera)}
              onDelete={() => removeCamera(camera)}
            />
          ))}
        </div>
      ) : (
        <div className="vision-table-panel">
          <div className="vision-empty">
            <VideoCameraOutlined />
            <span>{cameras.length ? 'No cameras match these filters.' : 'No cameras registered yet.'}</span>
          </div>
        </div>
      )}

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
            <Button type="primary" className="vision-btn-primary" htmlType="submit" loading={saving}>Save Camera</Button>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
