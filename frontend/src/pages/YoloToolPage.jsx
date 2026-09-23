import { Alert, Card, Col, Input, Row, Select, Space, Tabs, Typography } from 'antd';
import { HighlightOutlined, SettingOutlined } from '@ant-design/icons';
import LabelingTool from '../components/yolo/LabelingTool';
import { useLanguage } from '../i18n';

const { Paragraph, Text } = Typography;

/** The original page: model choice and the command to run. */
function ModelSettings() {
  const { t } = useLanguage();
  return (
    <Row gutter={[16, 16]}>
      <Col span={24} lg={12}>
        <Card title={t('modelSettings')} bordered={false}>
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
            <Input placeholder={t('inputImageOrVideoPath')} />
            <Input placeholder={t('outputFolder')} />
          </Space>
        </Card>
      </Col>

      <Col span={24} lg={12}>
        <Card title={t('recommendedCommand')} bordered={false}>
          <pre style={{ margin: 0, background: '#f6f8fb', borderRadius: 12, padding: 16, whiteSpace: 'pre-wrap' }}>
            yolo detect predict model=yolov8n.pt source=./input.jpg imgsz=640 conf=0.25
          </pre>
          <Paragraph style={{ marginTop: 16 }}>
            <Text strong>{t('purpose')}:</Text> {t('yoloPurpose')}
          </Paragraph>
        </Card>
      </Col>

      <Col span={24}>
        <Card bordered={false}>
          <Alert
            type="info"
            showIcon
            message={t('yoloUtility')}
            description={t('yoloDescription')}
          />
        </Card>
      </Col>
    </Row>
  );
}

export default function YoloToolPage() {
  const { t } = useLanguage();
  return (
    <div className="vision-page vision-stack">
      <div className="vision-page-header">
        <div>
          <h1 className="vision-page-title">YOLO</h1>
          <p className="vision-page-subtitle">{t('yoloSubtitle')}</p>
        </div>
      </div>

      <Tabs
        defaultActiveKey="labelling"
        items={[
          {
            key: 'labelling',
            label: <span><HighlightOutlined /> {t('labelling')}</span>,
            children: <LabelingTool />,
          },
          {
            key: 'model',
            label: <span><SettingOutlined /> {t('modelSettings')}</span>,
            children: <ModelSettings />,
          },
        ]}
      />
    </div>
  );
}
