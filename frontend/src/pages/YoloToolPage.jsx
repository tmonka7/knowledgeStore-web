import { Alert, Tabs } from 'antd';
import { HighlightOutlined, RocketOutlined } from '@ant-design/icons';
import LabelingTool from '../components/yolo/LabelingTool';
import YoloTrainingPanel from '../components/yolo/YoloTrainingPanel';
import { useLanguage } from '../i18n';
import { can } from '../permissions';

export default function YoloToolPage({ user }) {
  const { t } = useLanguage();
  // Training ties up the server for hours; it is a separate grant, and the
  // API enforces the same rule.
  const canTrain = can(user, 'yolo', 'train');

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
            key: 'train',
            label: <span><RocketOutlined /> {t('mlTrainTab')}</span>,
            children: canTrain
              ? <YoloTrainingPanel />
              : <Alert type="info" showIcon message={t('yoloTrainNeedsPermission')} />,
          },
        ]}
      />
    </div>
  );
}
