import { useEffect, useState } from 'react';
import {
  Alert, Card, Col, Empty, Progress, Result, Row, Segmented, Select, Slider, Space, Tag, Typography,
} from 'antd';
import { QuestionCircleOutlined, SafetyCertificateOutlined, UserOutlined } from '@ant-design/icons';
import ClipRecorder from './ClipRecorder';
import { speakerColor } from './useSpeakers';
import { useLanguage } from '../../i18n';

const { Text } = Typography;

/**
 * Who is speaking in a clip — or, in Verify mode, is it this particular
 * speaker? The clip can be tried with any speaker model on the server, and
 * compared with a second one (a fine-tuned model with the one it came from).
 */
export default function IdentifyPanel({ area }) {
  const { t } = useLanguage();
  const [mode, setMode] = useState('identify');
  const [speakerId, setSpeakerId] = useState('');
  const [modelId, setModelId] = useState('');
  const [compareId, setCompareId] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null); // { results: [{ model, result }], source, mode, url }

  const models = area.status?.models || [];
  const model = models.find((item) => item.id === modelId) || models[0] || null;
  const compare = models.find((item) => item.id === compareId && item.id !== model?.id) || null;

  useEffect(() => () => { if (outcome?.url) URL.revokeObjectURL(outcome.url); }, [outcome]);
  useEffect(() => {
    if (mode === 'verify' && !area.enrolled.some((speaker) => speaker.id === speakerId)) setSpeakerId(area.enrolled[0]?.id || '');
  }, [mode, area.enrolled, speakerId]);
  // A fine-tuned model is compared with its base by default.
  useEffect(() => {
    const origin = model?.kind === 'finetuned' && models.find((item) => item.id === model.baseModel);
    setCompareId(origin ? origin.id : '');
  }, [model?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (clip, source) => {
    setBusy(true);
    const results = [];
    for (const item of compare ? [model, compare] : [model]) {
      const result = await area.identify(clip, { ...(mode === 'verify' ? { speakerId } : {}), modelId: item?.id });
      if (result) results.push({ model: item, result });
    }
    setBusy(false);
    if (results.length) setOutcome({ results, source, mode, url: URL.createObjectURL(clip.blob) });
  };

  const option = (item) => ({
    value: item.id,
    label: `${item.name} · ${item.kind === 'finetuned' ? t('trainFinetuned') : t('trainBase')}`,
  });
  const first = outcome?.results[0].result;

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
            {models.length > 0 && (
              <Row gutter={[8, 8]}>
                <Col xs={24} sm={12}>
                  <Text type="secondary">{t('mlTestModel')}</Text>
                  <Select
                    style={{ width: '100%' }}
                    value={model?.id}
                    onChange={(value) => { setModelId(value); setOutcome(null); }}
                    options={models.map(option)}
                  />
                </Col>
                <Col xs={24} sm={12}>
                  <Text type="secondary">{t('mlTestCompare')}</Text>
                  <Select
                    style={{ width: '100%' }}
                    value={compare?.id || ''}
                    disabled={models.length < 2}
                    onChange={(value) => { setCompareId(value); setOutcome(null); }}
                    options={[{ value: '', label: t('mlTestNoCompare') }, ...models.filter((item) => item.id !== model?.id).map(option)]}
                  />
                </Col>
                {models.length < 2 && (
                  <Col span={24}><Text type="secondary" style={{ fontSize: 12 }}>{t('speakerOneModel')}</Text></Col>
                )}
              </Row>
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
          {!outcome ? (
            <Empty description={t('speakerNoResult')} />
          ) : (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <audio controls src={outcome.url} style={{ width: '100%' }} />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('speakerClipInfo', { source: outcome.source, seconds: first.seconds, speech: first.speechSeconds })}
              </Text>
              <Row gutter={[16, 16]}>
                {outcome.results.map(({ model: item, result }) => (
                  <Col key={item?.id || 'current'} xs={24} xl={outcome.results.length > 1 ? 12 : 24}>
                    {outcome.results.length > 1 && (
                      <Space wrap size={4}>
                        <Tag color={item.kind === 'finetuned' ? 'purple' : 'default'}>
                          {item.kind === 'finetuned' ? t('trainFinetuned') : t('trainBase')}
                        </Tag>
                        <Text strong>{item.name}</Text>
                      </Space>
                    )}
                    <Outcome result={result} verifying={outcome.mode === 'verify'} />
                  </Col>
                ))}
              </Row>
            </Space>
          )}
        </Card>
      </Col>
    </Row>
  );
}

/** One model's answer: the verdict, then every speaker's score. */
function Outcome({ result, verifying }) {
  const { t } = useLanguage();
  const top = result.results[0];
  return (
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
  );
}
