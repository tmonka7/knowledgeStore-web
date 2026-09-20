import { Alert, Card, Col, Input, Row, Select, Space, Typography } from 'antd';

const { Paragraph, Text, Title } = Typography;

export default function YoloToolPage() {
  return (
    <div className="vision-page vision-stack">
      <div className="vision-page-header">
        <div>
          <h1 className="vision-page-title">YOLO</h1>
          <p className="vision-page-subtitle">Quick object-detection pipeline presets for YOLO-style model exports.</p>
        </div>
      </div>

      <Row gutter={[16, 16]}>
        <Col span={24} lg={12}>
          <Card title="Model settings" bordered={false}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Select
                defaultValue="yolov8n"
                options={[
                  { value: 'yolov8n', label: 'YOLOv8n' },
                  { value: 'yolov8s', label: 'YOLOv8s' },
                  { value: 'yolov8m', label: 'YOLOv8m' },
                ]}
                style={{ width: '100%' }}
              />
              <Input placeholder="Input image or video path" />
              <Input placeholder="Output folder" />
            </Space>
          </Card>
        </Col>

        <Col span={24} lg={12}>
          <Card title="Recommended command" bordered={false}>
            <pre style={{ margin: 0, background: '#f6f8fb', borderRadius: 12, padding: 16, whiteSpace: 'pre-wrap' }}>
              yolo detect predict model=yolov8n.pt source=./input.jpg imgsz=640 conf=0.25
            </pre>
            <Paragraph style={{ marginTop: 16 }}>
              <Text strong>Purpose:</Text> generate detection overlays, labels, and export-ready results for inference workflows.
            </Paragraph>
          </Card>
        </Col>

        <Col span={24}>
          <Card bordered={false}>
            <Alert
              type="info"
              showIcon
              message="YOLO utility"
              description="This workspace page is a lightweight model configuration and command-generation shell for YOLO projects."
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
