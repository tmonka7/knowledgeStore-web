import TtsDatasetTool from '../components/tts/TtsDatasetTool';
import { useLanguage } from '../i18n';

export default function TtsToolPage() {
  const { t } = useLanguage();
  return (
    <div className="vision-page vision-stack">
      <div className="vision-page-header">
        <div>
          <h1 className="vision-page-title">{t('speechToText')}</h1>
          <p className="vision-page-subtitle">{t('ttsSubtitle')}</p>
        </div>
      </div>

      <TtsDatasetTool />
    </div>
  );
}
