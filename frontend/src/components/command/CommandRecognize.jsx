import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import {
  Alert, Button, Card, Col, Empty, List, Progress, Row, Select, Slider, Space, Tag, Tooltip, Typography, message,
} from 'antd';
import {
  AudioOutlined, CheckCircleFilled, ClearOutlined, QuestionCircleOutlined, ReloadOutlined, StopOutlined,
} from '@ant-design/icons';
import api from '../../api';
import ClipRecorder from '../speaker/ClipRecorder';
import { MONO } from '../ml/JobView';
import { encodeWav16k, openMicrophone } from '../../lib/speechCapture';
import { commandLanguageLabel, moonshineFor } from '../../lib/commandSets';
import { useLanguage } from '../../i18n';

const { Text, Paragraph } = Typography;
const OWN = '__own__';
const MAX_LOG = 30;

const percent = (value) => `${Math.round((value || 0) * 100)}%`;

/**
 * Send one WAV to be recognised; resolves to the answer, or throws with the server's reason.
 * Used by Recognize and by Train's Test section.
 */
export const recognizeClip = async ({ blob, modelId, datasetId, threshold }) => {
  const form = new FormData();
  form.append('audio', blob, 'command.wav');
  form.append('modelId', modelId);
  if (datasetId) form.append('datasetId', datasetId);
  if (threshold != null) form.append('threshold', String(threshold));
  const { data } = await api.post('/tools/command/recognize', form, { timeout: 0 });
  return data;
};

/** What was recognised, as a tag: the command, "unsure", or "no command". */
export function CommandTag({ result, large = false }) {
  const { t } = useLanguage();
  const style = large ? { fontSize: 20, padding: '6px 14px', lineHeight: 1.4 } : undefined;
  if (result.command) return <Tag color="green" icon={<CheckCircleFilled />} style={style}>{result.command.name}</Tag>;
  if (result.ambiguous) {
    const [first, second] = result.alternatives || [];
    return (
      <Tooltip title={first && second ? t('cmdUnsureBetween', { first: first.name, second: second.name }) : ''}>
        <Tag color="gold" icon={<QuestionCircleOutlined />} style={style}>{t('cmdUnsure')}</Tag>
      </Tooltip>
    );
  }
  return <Tag style={style}>{t('cmdNoCommand')}</Tag>;
}

/**
 * Recognize: speak and see which command was said. Push to talk with the
 * recorder (or choose a file), or Listen, which hears phrase after phrase
 * until stopped. A trained model knows its own commands; a base Moonshine
 * model is given a command set.
 */
export default function CommandRecognize({ reloadKey = 0 }) {
  const { t } = useLanguage();
  const [models, setModels] = useState([]);
  const [sets, setSets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modelId, setModelId] = useState('');
  const [setId, setSetId] = useState('');
  const [setDetail, setSetDetail] = useState(null);
  const [threshold, setThreshold] = useState(0.7);
  const [log, setLog] = useState([]); // newest first: { at, ...result }
  const [pending, setPending] = useState(0);
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const micRef = useRef(null);

  // Opening the tab starts the recogniser on the server, which takes a few
  // seconds the first time; said now, the first command does not wait for it.
  const [engine, setEngine] = useState({ ready: false, starting: true });
  useEffect(() => {
    let alive = true;
    api.get('/tools/command/status', { timeout: 0 })
      .then(({ data }) => { if (alive) setEngine({ ...data, starting: false }); })
      .catch((error) => { if (alive) setEngine({ ready: false, starting: false, message: error.response?.data?.message || error.message }); });
    return () => { alive = false; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: modelData }, { data: setData }] = await Promise.all([
        api.get('/tools/command/models'), api.get('/tools/command/datasets'),
      ]);
      setModels(modelData.models || []);
      setSets(setData.datasets || []);
    } catch (error) {
      message.error(error.response?.data?.message || t('trainModelsLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);
  useEffect(() => { load(); }, [load, reloadKey]);

  const model = models.find((item) => item.id === modelId) || null;
  const usableSets = sets.filter((item) => !model || item.language === model.language);

  // Defaults: the newest trained model with its own commands; else a base model and a set in its language.
  useEffect(() => {
    if (model || !models.length) return;
    setModelId(models[0].id);
  }, [models]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!model) return;
    if (setId === OWN && model.commands) return;
    if (usableSets.some((item) => item.id === setId)) return;
    setSetId(model.commands ? OWN : usableSets[0]?.id || '');
  }, [model?.id, sets]); // eslint-disable-line react-hooks/exhaustive-deps

  // The commands in play, to show what can be said.
  useEffect(() => {
    setSetDetail(null);
    if (!setId || setId === OWN) return undefined;
    let alive = true;
    api.get(`/tools/command/datasets/${setId}`).then(({ data }) => { if (alive) setSetDetail(data.dataset); }).catch(() => {});
    return () => { alive = false; };
  }, [setId]);
  const commands = setId === OWN ? model?.commands || [] : setDetail?.commands || [];

  const ready = Boolean(model && (setId === OWN ? model.commands : setId));

  const send = async (clip) => {
    if (!ready) return;
    setPending((value) => value + 1);
    try {
      const result = await recognizeClip({
        blob: clip.blob, modelId: model.id, datasetId: setId === OWN ? '' : setId, threshold,
      });
      setLog((current) => [{ at: new Date(), ...result }, ...current].slice(0, MAX_LOG));
    } catch (error) {
      message.error(error.response?.data?.message || t('cmdRecognizeFailed'));
    } finally {
      setPending((value) => value - 1);
    }
  };

  const stopListening = async () => {
    const mic = micRef.current;
    micRef.current = null;
    setListening(false);
    setLevel(0);
    if (mic) await mic.stop();
  };

  const startListening = async () => {
    try {
      micRef.current = await openMicrophone({
        live: true,
        pauseSeconds: 0.6,
        maxPhraseSeconds: 8,
        onLevel: setLevel,
        onPhrase: async (samples, rate) => send(await encodeWav16k(samples, rate)),
      });
      setListening(true);
    } catch (error) {
      message.error(error.message);
    }
  };

  // Stop the microphone when the tab goes, or the model or set changes under it.
  useEffect(() => () => { micRef.current?.stop(); }, []);
  useEffect(() => { if (listening) stopListening(); }, [modelId, setId]); // eslint-disable-line react-hooks/exhaustive-deps

  const latest = log[0] || null;
  const noModels = !loading && !models.length;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        bordered={false}
        title={t('cmdRecognizeTitle')}
        extra={(
          <Tooltip title={t('translationReload')}>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={load} />
          </Tooltip>
        )}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {noModels && (
            <Alert
              type="warning"
              showIcon
              message={t('cmdNoModels')}
              description={<pre style={{ ...MONO, margin: 0 }}>python backend/python/download_models.py moonshine-tiny</pre>}
            />
          )}
          <Row gutter={[12, 12]}>
            <Col xs={24} md={9}>
              <Text type="secondary">{t('trainModel')}</Text>
              <Select
                style={{ width: '100%' }}
                value={model?.id}
                onChange={setModelId}
                placeholder={t('trainPickModel')}
                options={[
                  { label: t('trainFinetuned'), options: models.filter((item) => item.kind === 'finetuned') },
                  { label: t('trainBase'), options: models.filter((item) => item.kind !== 'finetuned') },
                ].filter((group) => group.options.length).map((group) => ({
                  label: group.label,
                  options: group.options.map((item) => ({ value: item.id, label: `${item.name} (${item.language})` })),
                }))}
              />
            </Col>
            <Col xs={24} md={9}>
              <Text type="secondary">{t('cmdSet')}</Text>
              <Select
                style={{ width: '100%' }}
                value={setId || undefined}
                onChange={setSetId}
                placeholder={t('cmdPickSet')}
                notFoundContent={t('cmdNoSetsForLanguage')}
                options={[
                  ...(model?.commands ? [{ value: OWN, label: t('cmdOwnCommands', { count: model.commands.length }) }] : []),
                  ...usableSets.map((item) => ({ value: item.id, label: `${item.name} (${item.commandCount})` })),
                ]}
              />
            </Col>
            <Col xs={24} md={6}>
              <Tooltip title={t('cmdThresholdHelp')}>
                <Text type="secondary">{t('cmdThreshold', { value: percent(threshold) })}</Text>
              </Tooltip>
              <Slider min={0.5} max={0.95} step={0.05} value={threshold} onChange={setThreshold} tooltip={{ formatter: percent }} />
            </Col>
          </Row>

          {engine.starting && <Alert type="info" showIcon message={t('cmdEngineStarting')} />}
          {!engine.starting && !engine.ready && !noModels && (
            <Alert type="error" showIcon message={t('cmdEngineFailed')} description={engine.message} />
          )}
          {model && !ready && (
            <Alert type="info" showIcon message={t('cmdNeedSet', { language: commandLanguageLabel(model.language) })} />
          )}
          {model?.licence && model.licence !== 'MIT' && (
            <Text type="secondary" style={{ fontSize: 12 }}>{t('cmdLicence', { licence: model.licence })}</Text>
          )}

          <Row gutter={[16, 16]}>
            <Col xs={24} lg={10}>
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {listening ? (
                  <Button danger type="primary" size="large" icon={<StopOutlined />} onClick={stopListening} block>
                    {t('cmdStopListening')}
                  </Button>
                ) : (
                  <Button type="primary" size="large" icon={<AudioOutlined />} onClick={startListening} disabled={!ready} block>
                    {t('cmdListen')}
                  </Button>
                )}
                {listening && (
                  <Progress percent={Math.round(level * 100)} showInfo={false} status="active" strokeColor={level > 0.1 ? '#52c41a' : '#bfbfbf'} />
                )}
                <Text type="secondary" style={{ fontSize: 12 }}>{listening ? t('cmdListeningHelp') : t('cmdListenHelp')}</Text>
                {!listening && (
                  <ClipRecorder onClip={send} disabled={!ready} maxSeconds={8} allowFile recordLabel={t('cmdPushToTalk')} />
                )}
              </Space>
            </Col>
            <Col xs={24} lg={14}>
              <div className="cmd-result">
                {latest ? (
                  <Space direction="vertical" size={6}>
                    <Space wrap>
                      <CommandTag result={latest} large />
                      <Text type="secondary">{percent(latest.score)}</Text>
                    </Space>
                    <Text>{latest.text ? `"${latest.text}"` : t('pythonNoOutput')}</Text>
                  </Space>
                ) : (
                  <Text type="secondary">{pending ? t('cmdRecognizing') : t('cmdSaySomething')}</Text>
                )}
              </div>
              {commands.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <Text type="secondary">{t('cmdYouCanSay')}</Text>
                  <div className="cmd-available">
                    {commands.map((item) => (
                      <Tooltip key={item.id} title={(item.phrases || []).join(' · ')}>
                        <Tag color={latest?.command?.id === item.id ? 'green' : 'default'}>{item.name}</Tag>
                      </Tooltip>
                    ))}
                  </div>
                </div>
              )}
            </Col>
          </Row>
        </Space>
      </Card>

      <Card
        bordered={false}
        title={t('cmdHeard')}
        extra={log.length > 0 && <Button icon={<ClearOutlined />} onClick={() => setLog([])}>{t('clear')}</Button>}
      >
        {log.length ? (
          <List
            size="small"
            dataSource={log}
            renderItem={(item) => (
              <List.Item>
                <Space wrap>
                  <Text type="secondary" style={MONO}>{item.at.toLocaleTimeString()}</Text>
                  <CommandTag result={item} />
                  <Text>{item.text ? `"${item.text}"` : '—'}</Text>
                  <Text type="secondary">{`${percent(item.score)} · ${Math.round((item.took || 0) * 1000)} ms`}</Text>
                </Space>
              </List.Item>
            )}
          />
        ) : (
          <Empty description={t('cmdNothingYet')} />
        )}
        <Paragraph type="secondary" style={{ margin: '12px 0 0', fontSize: 12 }}>
          {t('cmdOtherLanguages', { command: `download_models.py ${moonshineFor('ko')}` })}
        </Paragraph>
      </Card>
    </Space>
  );
}
