import { Alert } from 'antd';
import PageHeader from '../components/ui/PageHeader';
import RecordingsBrowser from '../components/camera/RecordingsBrowser';
import { useLanguage } from '../i18n';

/** Camera Management → Recordings: footage of every camera, to find and play back. */
export default function CameraRecordingsPage({ user, cameras }) {
  const { t } = useLanguage();
  return (
    <div className="vision-page">
      <PageHeader title={t('recTitle')} subtitle={t('recSubtitle')} />
      <Alert type="info" showIcon message={t('recHowTo')} style={{ marginBottom: 16 }} />
      <div className="vision-panel">
        <RecordingsBrowser cameras={cameras} user={user} />
      </div>
    </div>
  );
}
