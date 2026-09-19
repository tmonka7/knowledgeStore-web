import { ArrowLeftOutlined, CameraOutlined, EnvironmentOutlined } from '@ant-design/icons';
import { Button, Card, Empty, Space, Tag, Typography } from 'antd';

const { Title, Text } = Typography;
const statusColors = { online: 'green', offline: 'default', maintenance: 'orange' };
const isBrowserPreviewUrl = (address = '') => /^https?:\/\//i.test(address);

const CameraTile = ({ camera }) => {
  const canPreview = camera.status === 'online' && isBrowserPreviewUrl(camera.address);

  return (
    <Card className="camera-wall-tile" bodyStyle={{ padding: 0 }}>
      <div className="camera-wall-preview">
        {canPreview ? (
          <iframe
            src={camera.address}
            title={`${camera.name} live view`}
            allow="autoplay; fullscreen"
          />
        ) : (
          <div className="camera-wall-unavailable">
            <CameraOutlined />
            <span>{camera.status === 'online' ? 'Browser preview unavailable' : 'Camera offline'}</span>
          </div>
        )}
        <Tag className="camera-wall-status" color={statusColors[camera.status]}>{camera.status.toUpperCase()}</Tag>
      </div>
      <div className="camera-wall-meta">
        <div>
          <strong>{camera.name}</strong>
          <Text type="secondary"><EnvironmentOutlined /> {camera.location}</Text>
        </div>
        <Text className="camera-wall-address" type="secondary">{camera.address}</Text>
      </div>
    </Card>
  );
};

export default function CameraWallPage({ cameras, onBack }) {
  return (
    <div className="camera-wall-page">
      <div className="camera-wall-header">
        <div>
          <Button icon={<ArrowLeftOutlined />} onClick={onBack}>Back to Cameras</Button>
          <Title level={2}>Live Camera View</Title>
          <Text type="secondary">All registered cameras in one monitoring screen.</Text>
        </div>
        <Space className="camera-wall-summary">
          <Tag color="green">{cameras.filter((camera) => camera.status === 'online').length} online</Tag>
          <Tag>{cameras.length} total</Tag>
        </Space>
      </div>

      {cameras.length ? (
        <div className="camera-wall-grid">
          {cameras.map((camera) => <CameraTile key={camera.id} camera={camera} />)}
        </div>
      ) : (
        <Card><Empty description="No registered cameras" /></Card>
      )}
    </div>
  );
}
