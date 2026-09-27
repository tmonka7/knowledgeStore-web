import { useEffect, useState } from 'react';
import {
  Alert, Card, Col, Empty, Progress, Result, Row, Segmented, Select, Slider, Space, Typography,
} from 'antd';
import { QuestionCircleOutlined, SafetyCertificateOutlined, UserOutlined } from '@ant-design/icons';
import ClipRecorder from './ClipRecorder';
import { speakerColor } from './useSpeakers';
import { useLanguage } from '../../i18n';

const { Text } = Typography;

/** Who is speaking in a clip — or, in Verify mode, is it this particular speaker? */
export default function IdentifyPanel({ area }) {
  const { t } = useLanguage();
  const [mode, setMode] = useState('identify');
  const [speakerId, setSpeakerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null); // { result, source, url }

  useEffect(() => () => { if (outcome?.url) URL.revokeObjectURL(outcome.url); }, [outcome]);
  useEffect(() => {
    if (mode === 'verify' && !area.enrolled.some((speaker) => speaker.id === speakerId)) setSpeakerId(area.enrolled[0]?.id || '');
  }, [mode, area.enrolled, speakerId]);

  const run = async (clip, source) => {
    setBusy(true);
    const result = await area.identify(clip, mode === 'verify' ? { speakerId } : {});
    setBusy(false);
    if (result) setOutcome({ result, source, mode, url: URL.createObjectURL(clip.blob) });
  };

  const result = outcome?.result;
  const verifying = outcome?.mode === 'verify';
  const top = result?.results[0];

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={10}>
        <Card bordered={false} title={t('speakerIdentifyTitle')}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Segmented
              block
              value={mode}
              onChange={(value) => { setMode(value); setOutcome(null); }}
              options={[
                { value: 'identify', label: t('speakerModeIdentify') },
                { value: 'verify', label: t('speakerModeVerify') },
              ]}
            />
            <Text type="secondary">{mode === 'identify' ? t('speakerIdentifyHelp') : t('speakerVerifyHelp')}</Text>
            {mode === 'verify' && (
              <Select
                style={{ width: '100%' }}
                value={speakerId || undefined}
                placeholder={t('speakerPick')}
                onChange={setSpeakerId}
                options={area.enrolled.map((speaker) => ({ value: speaker.id, label: speaker.name }))}
              />
            )}
            {!area.enrolled.length && <Alert type="warning" showIcon message={t('speakerEnrollFirst')} />}
            <ClipRecorder
              onClip={run}
              busy={busy}
              disabled={!area.ready || !area.enrolled.length || (mode === 'verify' && !speakerId) || busy}
              maxSeconds={20}
              hint={t('speakerClipHint')}
            />
            <div>
              <Text type="secondary">{t('speakerThreshold', { value: area.threshold.toFixed(2) })}</Text>
              <Slider min={0.1} max={0.9} step={0.01} value={area.threshold} onChange={area.setThreshold} marks={{ 0.25: '0.25', 0.5: '0.5', 0.75: '0.75' }} />
              <Text type="secondary" style={{ fontSize: 12 }}>{t('speakerThresholdHelp')}</Text>
            </div>
          </Space>
        </Card>
      </Col>

      <Col xs={24} lg={14}>
        <Card bordered={false} title={t('result')}>
          {!result ? (
            <Empty description={t('speakerNoResult')} />
          ) : (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {verifying ? (
                <Result
                  status={result.match ? 'success' : 'error'}
                  icon={<SafetyCertificateOutlined />}
                  title={result.match ? t('speakerVerified', { name: top?.name }) : t('speakerNotVerified', { name: top?.name })}
                  subTitle={t('speakerScoreLine', { score: top?.score?.toFixed(2), threshold: result.threshold.toFixed(2) })}
                />
              ) : result.match ? (
                <Result
                  status="success"
                  icon={<UserOutlined style={{ color: speakerColor(result.match.speakerId) }} />}
                  title={result.match.name}
                  subTitle={t('speakerScoreLine', { score: result.match.score.toFixed(2), threshold: result.threshold.toFixed(2) })}
                />
              ) : (
                <Result
                  status="warning"
                  icon={<QuestionCircleOutlined />}
                  title={t('speakerUnknown')}
                  subTitle={top ? t('speakerClosest', { name: top.name, score: top.score.toFixed(2) }) : t('speakerNobodyEnrolled')}
                />
              )}
              <audio controls src={outcome.url} style={{ width: '100%' }} />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('speakerClipInfo', { source: outcome.source, seconds: result.seconds, speech: result.speechSeconds })}
              </Text>
              {!verifying && result.results.map((row) => (
                <div key={row.speakerId}>
                  <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                    <Text strong={row.speakerId === result.match?.speakerId}>{row.name}</Text>
                    <Text type="secondary">{row.score.toFixed(3)}</Text>
                  </Space>
                  <Progress
                    percent={Math.max(0, Math.round(row.score * 100))}
                    showInfo={false}
                    strokeColor={row.score >= result.threshold ? speakerColor(row.speakerId) : '#d9d9d9'}
                    success={{ percent: 0 }}
                  />
                </div>
              ))}
            </Space>
          )}
        </Card>
      </Col>
    </Row>
  );
}
