import { Alert, Tabs } from 'antd';
import { EditOutlined, RocketOutlined } from '@ant-design/icons';
import SpeechTrainingPanel from '../components/tts/SpeechTrainingPanel';
import TtsDatasetTool from '../components/tts/TtsDatasetTool';
import { useLanguage } from '../i18n';
import { can } from '../permissions';

export default function TtsToolPage({ user }) {
  const { t } = useLanguage();
  // Training ties up the server for hours; it is a separate grant, and the
  // API enforces the same rule.
  const canTrain = can(user, 'tts', 'train');

  return (
    <div className="vision-page vision-stack">
      <div className="vision-page-header">
        <div>
          <h1 className="vision-page-title">{t('speechToText')}</h1>
          <p className="vision-page-subtitle">{t('ttsSubtitle')}</p>
        </div>
      </div>

      <Tabs
        defaultActiveKey="transcribe"
        items={[
          {
            key: 'transcribe',
            label: <span><EditOutlined /> {t('mlTranscribeTab')}</span>,
            children: <TtsDatasetTool />,
          },
          {
            key: 'train',
            label: <span><RocketOutlined /> {t('mlTrainTab')}</span>,
            children: canTrain
              ? <SpeechTrainingPanel />
              : <Alert type="info" showIcon message={t('speechTrainNeedsPermission')} />,
          },
        ]}
      />
    </div>
  );
}
