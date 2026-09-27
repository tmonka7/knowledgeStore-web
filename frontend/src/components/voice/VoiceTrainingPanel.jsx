import {
  forwardRef, useEffect, useRef, useState,
} from 'react';
import {
  Alert, Button, Card, Checkbox, Col, Collapse, Empty, Input, InputNumber, Popconfirm, Progress, Row, Select, Space, Table,
  Tag, Tooltip, Typography,
} from 'antd';
import {
  DeleteOutlined, DownloadOutlined, ExperimentOutlined, ReloadOutlined, RocketOutlined, SoundOutlined,
} from '@ant-design/icons';
import api from '../../api';
import DeviceSelect from '../ml/DeviceSelect';
import JobView, { MONO } from '../ml/JobView';
import useMlArea from '../ml/useMlArea';
import { formatBytes } from '../../lib/mlUpload';
import { useLanguage } from '../../i18n';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

const PRESET_VOICES = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'];
const LEARNING_RATES = [0.001, 0.003, 0.005, 0.01];
// A sentence to test with, in the voice's language, when the box is empty.
const TEST_SENTENCES = {
  en: 'Good morning. The train to the city leaves at half past eight from platform two.',
  ko: '안녕하십니까. 도시로 가는 기차는 두 번 승강장에서 여덟 시 반에 출발합니다.',
  ja: 'おはようございます。町へ行く電車は二番線から八時半に出発します。',
  de: 'Guten Morgen. Der Zug in die Stadt fährt um halb neun von Gleis zwei ab.',
  es: 'Buenos días. El tren a la ciudad sale a las ocho y media del andén dos.',
  fr: 'Bonjour. Le train pour la ville part à huit heures et demie du quai deux.',
  ru: 'Доброе утро. Поезд в город отправляется в половине девятого со второй платформы.',
};

const percent = (value) => (value == null ? '—' : `${Math.round(value * 100)}%`);

/** The server's reason, from an error whose body came back as an ArrayBuffer. */
const errorText = (error) => {
  const data = error.response?.data;
  if (data instanceof ArrayBuffer) {
    try {
      return JSON.parse(new TextDecoder().decode(data)).message || error.message;
    } catch {
      return error.message;
    }
  }
  return data?.message || error.message;
};

/**
 * Train voice: a Supertonic voice learned from a Speech to Text dataset — the
 * recordings of one person, with their transcripts — then tested against
 * those recordings. Supertonic itself cannot be retrained (it is released as
 * ONNX only); what is trained is a voice style, the same kind of file as its
 * own ten voices, so a trained voice is used on Read aloud like any other.
 */
export default function VoiceTrainingPanel({ onVoicesChanged }) {
  const { t } = useLanguage();
  const area = useMlArea('voice', t);
  const { models, datasets, jobs } = area;
  const [form, setForm] = useState({
    datasetId: '', baseVoice: 'auto', name: '', steps: 300, learningRate: 0.003, device: 'auto',
  });
  const [consent, setConsent] = useState(false);
  const [testId, setTestId] = useState('');
  const testRef = useRef(null);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const ready = datasets.filter((dataset) => dataset.complete && dataset.supported);
  const dataset = ready.find((item) => item.id === form.datasetId) || null;
  useEffect(() => {
    if (!dataset && ready.length) set({ datasetId: ready[0].id });
  }, [ready.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // A voice just trained appears on Read aloud too.
  const count = models.length;
  useEffect(() => { onVoicesChanged?.(); }, [count]); // eslint-disable-line react-hooks/exhaustive-deps

  const train = async () => {
    const started = await area.train({
      datasetId: form.datasetId,
      baseModelId: form.baseVoice,
      name: form.name,
      options: { steps: form.steps, learningRate: form.learningRate, device: form.device },
    });
    if (started) setConsent(false);
  };

  const openTest = (voice) => {
    setTestId(voice.id);
    testRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const latest = jobs[0] || null;
  const busyIds = new Set(jobs.filter((job) => job.status === 'running').map((job) => job.modelId));

  const voiceColumns = [
    {
      title: t('voiceTrained'),
      key: 'name',
      render: (_, voice) => (
        <Space direction="vertical" size={0}>
          <Space size={6} wrap>
            <Text strong>{voice.name}</Text>
            <Tag>{voice.language}</Tag>
            <Tag color="purple">{t('voiceFrom', { voice: voice.baseVoice })}</Tag>
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('voiceOnDataset', { dataset: voice.datasetName, seconds: Math.round(voice.speechSeconds || 0) })}
          </Text>
        </Space>
      ),
    },
    {
      title: t('voiceLikeness'),
      key: 'likeness',
      width: 220,
      render: (_, voice) => (
        <Tooltip title={t('voiceLikenessHelp')}>
          <Text>{`${voice.baseVoice} ${percent(voice.similarityBefore)} → ${percent(voice.similarityAfter)}`}</Text>
        </Tooltip>
      ),
    },
    {
      key: 'actions',
      width: 200,
      render: (_, voice) => (
        <Space>
          <Button size="small" icon={<ExperimentOutlined />} onClick={() => openTest(voice)}>{t('trainTest')}</Button>
          <Popconfirm title={t('voiceDelete')} onConfirm={() => area.removeModel(voice)} okButtonProps={{ danger: true }}>
            <Button size="small" danger icon={<DeleteOutlined />} disabled={busyIds.has(voice.id)} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const datasetColumns = [
    { title: t('trainDataset'), dataIndex: 'name' },
    {
      title: t('mlSpokenLanguage'),
      key: 'language',
      render: (_, item) => {
        if (!item.complete) return <Tag color="gold">{t('mlIncomplete')}</Tag>;
        return item.supported
          ? <Tag>{item.language}</Tag>
          : <Tooltip title={t('voiceLanguageUnsupported')}><Tag color="red">{item.language}</Tag></Tooltip>;
      },
    },
    { title: t('mlClips'), key: 'clips', render: (_, item) => `${item.transcribed ?? 0} / ${item.fileCount ?? 0}` },
    { title: t('mlSize'), key: 'size', render: (_, item) => formatBytes(item.bytes || 0) },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        bordered={false}
        title={t('voiceTrainTitle')}
        extra={(
          <Tooltip title={t('translationReload')}>
            <Button icon={<ReloadOutlined />} loading={area.loading} onClick={area.reload} />
          </Tooltip>
        )}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Paragraph type="secondary" style={{ margin: 0 }}>{t('voiceTrainHelp')}</Paragraph>
          {!ready.length && <Alert type="info" showIcon message={t('voiceNoDatasets')} />}

          <Row gutter={[12, 12]}>
            <Col xs={24} md={8}>
              <Text type="secondary">{t('voiceRecordings')}</Text>
              <Select
                style={{ width: '100%' }}
                value={form.datasetId || undefined}
                placeholder={t('translationPickDataset')}
                onChange={(datasetId) => set({ datasetId })}
                options={ready.map((item) => ({ value: item.id, label: `${item.name} (${item.language}, ${item.transcribed})` }))}
              />
            </Col>
            <Col xs={24} md={8}>
              <Text type="secondary">{t('trainStartFrom')}</Text>
              <Select
                style={{ width: '100%' }}
                value={form.baseVoice}
                onChange={(baseVoice) => set({ baseVoice })}
                options={[
                  { value: 'auto', label: t('voiceStartAuto') },
                  ...PRESET_VOICES.map((voice) => ({ value: voice, label: voice })),
                ]}
              />
            </Col>
            <Col xs={24} md={8}>
              <Text type="secondary">{t('voiceName')}</Text>
              <Input
                value={form.name}
                maxLength={120}
                placeholder={dataset ? `${dataset.name} (${dataset.language})` : ''}
                onChange={(event) => set({ name: event.target.value })}
              />
            </Col>
            <Col xs={12} md={4}>
              <Tooltip title={t('voiceStepsHelp')}>
                <Text type="secondary">{t('voiceSteps')}</Text>
              </Tooltip>
              <InputNumber style={{ width: '100%' }} min={20} max={5000} step={50} value={form.steps} onChange={(steps) => set({ steps })} />
            </Col>
            <Col xs={12} md={4}>
              <Text type="secondary">{t('trainLearningRate')}</Text>
              <Select
                style={{ width: '100%' }}
                value={form.learningRate}
                onChange={(learningRate) => set({ learningRate })}
                options={LEARNING_RATES.map((rate) => ({ value: rate, label: String(rate) }))}
              />
            </Col>
            <Col xs={24} md={8}>
              <Text type="secondary">{t('trainDevice')}</Text>
              <DeviceSelect base="/tools/voice" value={form.device} onChange={(device) => set({ device })} />
            </Col>
            <Col xs={24} md={8} style={{ display: 'flex', alignItems: 'flex-end' }}>
              <Button
                type="primary"
                size="large"
                icon={<RocketOutlined />}
                block
                disabled={!dataset || !consent || area.running}
                onClick={train}
              >
                {t('voiceTrainButton')}
              </Button>
            </Col>
            <Col xs={24}>
              <Checkbox checked={consent} onChange={(event) => setConsent(event.target.checked)}>{t('voiceConsent')}</Checkbox>
            </Col>
          </Row>

          {latest && (
            <JobView
              job={latest}
              onCancel={area.cancel}
              sampleColumns={[
                { title: t('voiceHeldOutSentence'), dataIndex: 'source' },
                { title: t('trainStartFrom'), dataIndex: 'reference' },
                { title: t('voiceLikenessBefore'), dataIndex: 'before', render: percent },
                { title: t('voiceLikenessAfter'), dataIndex: 'after', render: percent },
              ]}
            />
          )}

          <Table
            rowKey="id"
            size="small"
            columns={voiceColumns}
            dataSource={models}
            pagination={false}
            loading={area.loading}
            locale={{ emptyText: <Empty description={t('voiceNone')} /> }}
            scroll={{ x: 'max-content' }}
          />

          {jobs.length > 1 && (
            <Collapse
              size="small"
              items={[{
                key: 'jobs',
                label: t('trainEarlierJobs', { count: jobs.length - 1 }),
                children: (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    {jobs.slice(1).map((job) => <JobView key={job.id} job={job} onCancel={area.cancel} compact />)}
                  </Space>
                ),
              }]}
            />
          )}
        </Space>
      </Card>

      <VoiceTest ref={testRef} voices={models} value={testId} onChange={setTestId} />

      <Card bordered={false} title={t('voiceDatasetsTitle')}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text type="secondary">{t('voiceDatasetsHelp')}</Text>
          <Table
            rowKey="id"
            size="small"
            columns={datasetColumns}
            dataSource={datasets}
            pagination={false}
            locale={{ emptyText: <Empty description={t('voiceNoDatasets')} /> }}
            scroll={{ x: 'max-content' }}
          />
        </Space>
      </Card>
    </Space>
  );
}

/**
 * Test: a sentence spoken by the trained voice and by another (the voice it
 * started from, by default), each scored against the recordings the voice was
 * trained on — so both the likeness and the change training made can be
 * heard and read.
 */
function VoiceTestInner({ voices, value, onChange }, ref) {
  const { t } = useLanguage();
  const voice = voices.find((item) => item.id === value) || null;
  const [compare, setCompare] = useState('');
  const [text, setText] = useState('');
  const [results, setResults] = useState([]); // [{ key, label, url, similarity, error }]
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!voice && voices.length) onChange(voices[0].id);
  }, [voice, voices]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setCompare(voice && PRESET_VOICES.includes(voice.baseVoice) ? `preset:${voice.baseVoice}` : '');
    setResults([]);
  }, [voice?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => results.forEach((row) => row.url && URL.revokeObjectURL(row.url)), [results]);

  const sentence = text.trim() || TEST_SENTENCES[voice?.language] || '';

  const speakAndScore = async (choice) => {
    const preset = choice.startsWith('preset:') ? choice.slice(7) : '';
    const trainedId = preset ? '' : choice;
    const label = preset || voices.find((item) => item.id === trainedId)?.name || choice;
    try {
      const response = await api.post('/tools/speech/synthesize', {
        modelId: voice.synthesisModel,
        text: sentence,
        language: voice.language,
        ...(preset ? { voice: preset } : { voiceId: trainedId }),
        steps: 8,
      }, { responseType: 'arraybuffer', timeout: 0 });
      const blob = new Blob([response.data], { type: 'audio/wav' });
      const form = new FormData();
      form.append('audio', blob, 'test.wav');
      const { data } = await api.post(`/tools/voice/models/${voice.id}/score`, form, { timeout: 0 });
      return { key: choice, label, url: URL.createObjectURL(blob), similarity: data.similarity };
    } catch (error) {
      return { key: choice, label, error: errorText(error) };
    }
  };

  const run = async () => {
    if (!voice || !sentence) return;
    setBusy(true);
    const rows = [await speakAndScore(voice.id)];
    if (compare) rows.push(await speakAndScore(compare));
    setResults(rows);
    setBusy(false);
  };

  const download = (row) => {
    const link = document.createElement('a');
    link.href = row.url;
    link.download = `${row.label.replace(/[^\p{L}\p{N}]+/gu, '_')}.wav`;
    link.click();
  };

  return (
    <Card ref={ref} bordered={false} title={<Space><ExperimentOutlined />{t('mlTestTitle')}</Space>}>
      {!voices.length ? <Empty description={t('voiceNone')} /> : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Space wrap>
            <Text type="secondary">{t('voiceTrained')}</Text>
            <Select
              style={{ minWidth: 260 }}
              value={voice?.id}
              onChange={onChange}
              options={voices.map((item) => ({ value: item.id, label: `${item.name} (${item.language})` }))}
            />
            <Text type="secondary">{t('mlTestCompare')}</Text>
            <Select
              style={{ minWidth: 220 }}
              value={compare}
              onChange={setCompare}
              options={[
                { value: '', label: t('mlTestNoCompare') },
                { label: t('voicePresets'), options: PRESET_VOICES.map((item) => ({ value: `preset:${item}`, label: item })) },
                {
                  label: t('voiceTrainedVoices'),
                  options: voices.filter((item) => item.id !== voice?.id && item.language === voice?.language)
                    .map((item) => ({ value: item.id, label: item.name })),
                },
              ]}
            />
          </Space>
          <TextArea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={TEST_SENTENCES[voice?.language] || t('voiceTestPlaceholder')}
            autoSize={{ minRows: 2, maxRows: 6 }}
            maxLength={400}
            showCount
          />
          <Space wrap>
            <Button type="primary" icon={<SoundOutlined />} loading={busy} disabled={!sentence} onClick={run}>{t('voiceTestButton')}</Button>
            <Text type="secondary">{t('voiceTestHelp')}</Text>
          </Space>
          {results.length > 0 && (
            <Row gutter={[16, 16]}>
              {results.map((row, index) => (
                <Col key={row.key} xs={24} lg={results.length > 1 ? 12 : 24}>
                  <Card size="small" type="inner" title={<Space><Tag color={index === 0 ? 'purple' : 'default'}>{index === 0 ? t('voiceTrained') : t('mlTestCompare')}</Tag>{row.label}</Space>}>
                    {row.error ? <Alert type="error" showIcon message={row.error} /> : (
                      <Space direction="vertical" style={{ width: '100%' }}>
                        <audio controls src={row.url} style={{ width: '100%' }} />
                        <Text>{t('voiceLikenessToRecordings')}</Text>
                        <Progress
                          percent={Math.max(0, Math.round(row.similarity * 100))}
                          strokeColor={row.similarity >= 0.5 ? '#22c55e' : row.similarity >= 0.3 ? '#f59e0b' : '#ef4444'}
                        />
                        <Button size="small" icon={<DownloadOutlined />} onClick={() => download(row)}>{t('ttsDownload')}</Button>
                      </Space>
                    )}
                  </Card>
                </Col>
              ))}
            </Row>
          )}
          {voice?.consistency != null && (
            <Text type="secondary" style={MONO}>{t('voiceConsistency', { value: percent(voice.consistency) })}</Text>
          )}
        </Space>
      )}
    </Card>
  );
}

// A ref, so the Test button in the list above can scroll to this card.
const VoiceTest = forwardRef(VoiceTestInner);
