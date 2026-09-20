import { Alert, Card, Col, Input, Row, Select, Space, Typography } from 'antd';

const { Paragraph, Text } = Typography;

export default function KerasToolPage() {
  return (
    <div className="vision-page vision-stack">
      <div className="vision-page-header">
        <div>
          <h1 className="vision-page-title">Keras</h1>
          <p className="vision-page-subtitle">Template-based configuration for Keras model training and inference.</p>
        </div>
      </div>

      <Row gutter={[16, 16]}>
        <Col span={24} lg={12}>
          <Card title="Model config" bordered={false}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Select
                defaultValue="cnn"
                options={[
                  { value: 'cnn', label: 'CNN' },
                  { value: 'mobilenet', label: 'MobileNet' },
                  { value: 'resnet', label: 'ResNet' },
                ]}
                style={{ width: '100%' }}
              />
              <Input placeholder="Dataset path" />
              <Input placeholder="Class names or labels file" />
            </Space>
          </Card>
        </Col>

        <Col span={24} lg={12}>
          <Card title="Example training snippet" bordered={false}>
            <pre style={{ margin: 0, background: '#f6f8fb', borderRadius: 12, padding: 16, whiteSpace: 'pre-wrap' }}>
              model = keras.Sequential([\n    keras.layers.Input((224, 224, 3)),\n    keras.layers.Conv2D(32, 3, activation="relu"),\n    keras.layers.Flatten(),\n    keras.layers.Dense(10, activation="softmax")\n])\n
              model.compile(optimizer="adam", loss="sparse_categorical_crossentropy", metrics=["accuracy"])
            </pre>
            <Paragraph style={{ marginTop: 16 }}>
              <Text strong>Use case:</Text> quick prototyping and training templates for image classification and vision models.
            </Paragraph>
          </Card>
        </Col>

        <Col span={24}>
          <Card bordered={false}>
            <Alert
              type="info"
              showIcon
              message="Keras utility"
              description="This page provides a lightweight training/inference scaffold for Keras-based workflows in the same productivity dashboard."
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
