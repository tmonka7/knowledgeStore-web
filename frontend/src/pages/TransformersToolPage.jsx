import { Alert, Card, Col, Input, Row, Select, Space, Typography } from 'antd';
import { useLanguage } from '../i18n';

const { Paragraph, Text } = Typography;

export default function TransformersToolPage() {
  const { t } = useLanguage();
  return (
    <div className="vision-page vision-stack">
      <div className="vision-page-header">
        <div>
          <h1 className="vision-page-title">Transformers</h1>
          <p className="vision-page-subtitle">{t('transformersSubtitle')}</p>
        </div>
      </div>

      <Row gutter={[16, 16]}>
        <Col span={24} lg={12}>
          <Card title={t('pipeline')} bordered={false}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Select
                defaultValue="image-classification"
                options={[
                  { value: 'image-classification', label: t('imageClassification') },
                  { value: 'object-detection', label: t('objectDetection') },
                  { value: 'text-generation', label: t('textGeneration') },
                ]}
                style={{ width: '100%' }}
              />
              <Input placeholder={t('modelIdPlaceholder')} />
              <Input placeholder={t('inputPathOrPrompt')} />
            </Space>
          </Card>
        </Col>

        <Col span={24} lg={12}>
          <Card title={t('example')} bordered={false}>
            <pre style={{ margin: 0, background: '#f6f8fb', borderRadius: 12, padding: 16, whiteSpace: 'pre-wrap' }}>
              from transformers import pipeline\n
              classifier = pipeline("image-classification", model="google/vit-base-patch16-224")\n              result = classifier("./sample.jpg")
            </pre>
            <Paragraph style={{ marginTop: 16 }}>
              <Text strong>{t('useCase')}:</Text> {t('transformersUseCase')}
            </Paragraph>
          </Card>
        </Col>

        <Col span={24}>
          <Card bordered={false}>
            <Alert
              type="info"
              showIcon
              message={t('transformersUtility')}
              description={t('transformersDescription')}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
