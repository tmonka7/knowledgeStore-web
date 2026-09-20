import { Alert, Card, Col, Input, Row, Select, Space, Typography } from 'antd';

const { Paragraph, Text } = Typography;

export default function TransformersToolPage() {
  return (
    <div className="vision-page vision-stack">
      <div className="vision-page-header">
        <div>
          <h1 className="vision-page-title">Transformers</h1>
          <p className="vision-page-subtitle">Ready-to-run model presets for vision and text pipelines.</p>
        </div>
      </div>

      <Row gutter={[16, 16]}>
        <Col span={24} lg={12}>
          <Card title="Pipeline" bordered={false}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Select
                defaultValue="image-classification"
                options={[
                  { value: 'image-classification', label: 'Image Classification' },
                  { value: 'object-detection', label: 'Object Detection' },
                  { value: 'text-generation', label: 'Text Generation' },
                ]}
                style={{ width: '100%' }}
              />
              <Input placeholder="Model ID (e.g. google/vit-base-patch16-224)" />
              <Input placeholder="Input path or prompt" />
            </Space>
          </Card>
        </Col>

        <Col span={24} lg={12}>
          <Card title="Example" bordered={false}>
            <pre style={{ margin: 0, background: '#f6f8fb', borderRadius: 12, padding: 16, whiteSpace: 'pre-wrap' }}>
              from transformers import pipeline\n
              classifier = pipeline("image-classification", model="google/vit-base-patch16-224")\n              result = classifier("./sample.jpg")
            </pre>
            <Paragraph style={{ marginTop: 16 }}>
              <Text strong>Use case:</Text> standard inference pipelines for Hugging Face models and local experimentation.
            </Paragraph>
          </Card>
        </Col>

        <Col span={24}>
          <Card bordered={false}>
            <Alert
              type="info"
              showIcon
              message="Transformers utility"
              description="This page provides a compact configuration shell for Hugging Face models used in computer vision and NLP workflows."
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
