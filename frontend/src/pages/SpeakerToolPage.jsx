import { Alert, Button, Tabs, Typography } from 'antd';
import {
  AudioOutlined, AppstoreOutlined, ReloadOutlined, SearchOutlined, TeamOutlined,
} from '@ant-design/icons';
import IdentifyPanel from '../components/speaker/IdentifyPanel';
import LivePanel from '../components/speaker/LivePanel';
import ModelsPanel from '../components/speaker/ModelsPanel';
import SpeakersPanel from '../components/speaker/SpeakersPanel';
import useSpeakers from '../components/speaker/useSpeakers';
import { MONO } from '../components/ml/JobView';
import { useLanguage } from '../i18n';

const { Paragraph } = Typography;

/**
 * Speaker recognition with ECAPA-TDNN: enroll people by voice, then tell who
 * is speaking in a clip, verify a claimed speaker, or follow a conversation
 * live. Voiceprints are made and compared on the server; each account sees
 * only the speakers it enrolled.
 */
export default function SpeakerToolPage() {
  const { t } = useLanguage();
  const area = useSpeakers(t);
  const { status } = area;

  return (
    <div className="vision-page vision-stack">
      <div className="vision-page-header">
        <div>
          <h1 className="vision-page-title">{t('speakerRecognition')}</h1>
          <p className="vision-page-subtitle">{t('speakerSubtitle')}</p>
        </div>
        <Button icon={<ReloadOutlined />} loading={area.loading} onClick={area.load}>{t('translationReload')}</Button>
      </div>

      {status && !status.model && (
        <Alert
          type="warning"
          showIcon
          message={t('speakerNoModel')}
          description={(
            <Paragraph style={{ margin: 0 }}>
              {t('speakerNoModelHelp')}
              <pre style={{ ...MONO, margin: '8px 0 0' }}>
                pip install speechbrain{'\n'}python backend/python/download_models.py ecapa
              </pre>
            </Paragraph>
          )}
        />
      )}
      {status?.model && !status.engine.ok && (
        <Alert type="error" showIcon message={t('speakerEngineFailed')} description={status.engine.message} />
      )}

      <Tabs
        defaultActiveKey="speakers"
        items={[
          { key: 'speakers', label: <span><TeamOutlined /> {t('speakerSpeakers')}</span>, children: <SpeakersPanel area={area} /> },
          { key: 'identify', label: <span><SearchOutlined /> {t('speakerIdentifyTab')}</span>, children: <IdentifyPanel area={area} /> },
          { key: 'live', label: <span><AudioOutlined /> {t('speakerLiveTab')}</span>, children: <LivePanel area={area} /> },
          { key: 'models', label: <span><AppstoreOutlined /> {t('speakerModelsTab')}</span>, children: <ModelsPanel /> },
        ]}
      />
    </div>
  );
}
