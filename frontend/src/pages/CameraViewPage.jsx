import { ArrowLeftOutlined, CameraOutlined, EnvironmentOutlined, LinkOutlined } from '@ant-design/icons';
import { Button, Card, Space, Tag, Typography } from 'antd';

const { Title, Text } = Typography;
const statusColors = { online: 'green', offline: 'default', maintenance: 'orange' };

const isBrowserPreviewUrl = (address = '') => /^https?:\/\//i.test(address);

export default function CameraViewPage({ camera, onBack }) {
  const canPreview = camera && camera.status === 'online' && isBrowserPreviewUrl(camera.address);

  return (
    <div className="camera-view-page">
      <div className="camera-view-header">
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>Back to Cameras</Button>
        <Tag color={statusColors[camera.status]}>{camera.status.toUpperCase()}</Tag>
      </div>

      <div className="camera-view-heading">
        <div>
          <Title level={2}>{camera.name}</Title>
          <Text type="secondary"><EnvironmentOutlined /> {camera.location}</Text>
        </div>
        <Tag icon={<CameraOutlined />}>{camera.status}</Tag>
      </div>

      <Card className="camera-preview-card">
        {canPreview ? (
          <iframe
            className="camera-preview-frame"
            src={camera.address}
            title={`${camera.name} live view`}
            allow="autoplay; fullscreen"
          />
        ) : (
          <div className="camera-preview-empty">
            <CameraOutlined />
            <Title level={4}>Preview unavailable</Title>
            <Text type="secondary">
              {camera.status !== 'online'
                ? 'This camera is not currently online.'
                : 'Browser preview requires an HTTP or HTTPS stream URL.'}
            </Text>
          </div>
        )}
      </Card>

      <Card title="Camera details" className="camera-details-card">
        <div className="camera-detail-grid">
          <div><Text type="secondary">Location</Text><strong>{camera.location}</strong></div>
          <div><Text type="secondary">Address</Text><strong><LinkOutlined /> {camera.address}</strong></div>
          <div><Text type="secondary">Status</Text><strong>{camera.status}</strong></div>
          <div><Text type="secondary">Notes</Text><strong>{camera.notes || 'No notes added.'}</strong></div>
        </div>
      </Card>
    </div>
  );
}
