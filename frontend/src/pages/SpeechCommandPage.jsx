import { useState } from 'react';
import { Alert, Tabs } from 'antd';
import { AudioOutlined, RocketOutlined, UnorderedListOutlined } from '@ant-design/icons';
import CommandRecognize from '../components/command/CommandRecognize';
import CommandSetPanel from '../components/command/CommandSetPanel';
import CommandTrainingPanel from '../components/command/CommandTrainingPanel';
import { useLanguage } from '../i18n';
import { can } from '../permissions';

/**
 * Tools > AI > Speech to Command, with Moonshine: Recognize (say a command,
 * see which one it was), Commands (command sets and recordings of them), and —
 * with 'speech-command:train' — Train, which fine-tunes Moonshine on those
 * recordings and tests the result.
 */
export default function SpeechCommandPage({ user }) {
  const { t } = useLanguage();
  // Training ties up the server: a separate grant, and the API enforces the same rule.
  const canTrain = can(user, 'speech-command', 'train');
  const [tab, setTab] = useState('recognize');
  // Each tab re-reads what the others change when it is shown.
  const [versions, setVersions] = useState({ recognize: 0, train: 0 });

  return (
    <div className="vision-page vision-stack">
      <div className="vision-page-header">
        <div>
          <h1 className="vision-page-title">{t('speechCommand')}</h1>
          <p className="vision-page-subtitle">{t('cmdSubtitle')}</p>
        </div>
      </div>
      <Tabs
        activeKey={tab}
        onChange={(key) => {
          setTab(key);
          if (key in versions) setVersions((current) => ({ ...current, [key]: current[key] + 1 }));
        }}
        items={[
          {
            key: 'recognize',
            label: <span><AudioOutlined /> {t('cmdRecognizeTab')}</span>,
            children: <CommandRecognize reloadKey={versions.recognize} />,
          },
          {
            key: 'commands',
            label: <span><UnorderedListOutlined /> {t('cmdCommandsTab')}</span>,
            children: <CommandSetPanel />,
          },
          {
            key: 'train',
            label: <span><RocketOutlined /> {t('mlTrainTab')}</span>,
            children: canTrain
              ? <CommandTrainingPanel reloadKey={versions.train} />
              : <Alert type="info" showIcon message={t('cmdTrainNeedsPermission')} />,
          },
        ]}
      />
    </div>
  );
}
