import { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, Collapse, Empty, Input, InputNumber, List, Modal, Popconfirm, Row, Select, Space, Table,
  Tag, Tooltip, Typography,
} from 'antd';
import { DeleteOutlined, ReloadOutlined, RocketOutlined, UploadOutlined } from '@ant-design/icons';
import JobView, { MONO } from '../ml/JobView';
import ModelActions from '../ml/ModelActions';
import useMlArea from '../ml/useMlArea';
import { formatBytes } from '../../lib/mlUpload';
import { COMMON_LANGUAGES } from '../../lib/translationDataset';
import { useLanguage } from '../../i18n';

const { Text, Paragraph } = Typography;

const LEARNING_RATES = [1e-6, 5e-6, 1e-5, 3e-5, 1e-4];
const languageOptions = COMMON_LANGUAGES.map(([code, label]) => ({ value: code, label: `${code} · ${label}` }));

const errorAfter = (model) => (model.result?.errorAfter == null ? null : model.result);

/**
 * Fine-tuning Whisper on transcribed clips saved from the Transcribe tab,
 * testing it on a WAV file, and exporting it to ONNX — on the server, offline.
 */
export default function SpeechTrainingPanel() {
  const { t } = useLanguage();
  const area = useMlArea('speech', t);
  const { models, datasets, jobs } = area;
  const [form, setForm] = useState({ datasetId: '', baseModelId: '', name: '', epochs: 5, batchSize: 8, learningRate: 1e-5 });
  const [testing, setTesting] = useState(null);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const ready = datasets.filter((dataset) => dataset.complete);
  const dataset = ready.find((item) => item.id === form.datasetId) || null;

  useEffect(() => {
    if (!dataset && ready.length) set({ datasetId: ready[0].id });
  }, [ready.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!models.some((model) => model.id === form.baseModelId)) {
      set({ baseModelId: (models.find((model) => model.kind === 'base') || models[0])?.id || '' });
    }
  }, [models]); // eslint-disable-line react-hooks/exhaustive-deps

  const train = () => area.train({
    datasetId: form.datasetId,
    baseModelId: form.baseModelId,
    name: form.name,
    options: { epochs: form.epochs, batchSize: form.batchSize, learningRate: form.learningRate },
  });

  const busyModelIds = new Set(jobs.filter((job) => job.status === 'running').map((job) => job.modelId));
  const baseModels = models.filter((model) => model.kind === 'base');
  const latest = jobs[0] || null;

  const modelColumns = [
    {
      title: t('trainModel'),
      key: 'name',
      render: (_, model) => (
        <Space direction="vertical" size={0}>
          <Space size={6} wrap>
            <Text strong>{model.name}</Text>
            <Tag color={model.kind === 'base' ? 'default' : 'purple'}>{model.kind === 'base' ? t('trainBase') : t('trainFinetuned')}</Tag>
            <Tag>{model.language || t('mlAnyLanguage')}</Tag>
          </Space>
          {model.kind === 'finetuned' && (
            <Text type="secondary" style={{ fontSize: 12 }}>{t('trainFromOn', { base: model.baseName, dataset: model.datasetName })}</Text>
          )}
        </Space>
      ),
    },
    {
      title: t('mlErrorColumn'),
      key: 'error',
      width: 150,
      render: (_, model) => {
        const result = errorAfter(model);
        return result ? `${result.metric} ${(result.errorBefore * 100).toFixed(1)}% → ${(result.errorAfter * 100).toFixed(1)}%` : '—';
      },
    },
    {
      key: 'actions',
      width: 280,
      render: (_, model) => (
        <ModelActions model={model} area={area} busy={busyModelIds.has(model.id)} onTest={setTesting} />
      ),
    },
  ];

  const datasetColumns = [
    { title: t('trainDataset'), dataIndex: 'name' },
    {
      title: t('mlSpokenLanguage'),
      key: 'language',
      render: (_, item) => (item.complete ? <Tag>{item.language}</Tag> : <Tag color="gold">{t('mlIncomplete')}</Tag>),
    },
    { title: t('mlClips'), key: 'clips', render: (_, item) => `${item.transcribed ?? 0} / ${item.fileCount ?? 0}` },
    { title: t('mlSize'), key: 'size', render: (_, item) => formatBytes(item.bytes || 0) },
    {
      key: 'actions',
      width: 60,
      render: (_, item) => (
        <Popconfirm title={t('mlDeleteDataset')} onConfirm={() => area.removeDataset(item)} okButtonProps={{ danger: true }}>
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        bordered={false}
        title={t('trainTitle')}
        extra={(
          <Tooltip title={t('translationReload')}>
            <Button icon={<ReloadOutlined />} loading={area.loading} onClick={area.reload} />
          </Tooltip>
        )}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {!area.loading && !baseModels.length && (
            <Alert
              type="warning"
              showIcon
              message={t('trainNoBaseModels')}
              description={(
                <Paragraph style={{ margin: 0 }}>
                  {t('trainNoBaseModelsHelp')}
                  <pre style={{ ...MONO, margin: '8px 0 0' }}>
                    pip install -r backend/python/requirements.txt{'\n'}python backend/python/download_models.py whisper-tiny
                  </pre>
                </Paragraph>
              )}
            />
          )}
          {!ready.length && <Alert type="info" showIcon icon={<UploadOutlined />} message={t('speechNoServerDatasets')} />}

          <Row gutter={[12, 12]}>
            <Col xs={24} md={8}>
              <Text type="secondary">{t('trainDataset')}</Text>
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
                value={form.baseModelId || undefined}
                placeholder={t('trainPickModel')}
                onChange={(baseModelId) => set({ baseModelId })}
                options={models.map((model) => ({ value: model.id, label: model.name }))}
                notFoundContent={t('trainNoBaseModels')}
              />
            </Col>
            <Col xs={24} md={8}>
              <Text type="secondary">{t('trainModelName')}</Text>
              <Input
                value={form.name}
                maxLength={120}
                placeholder={dataset ? `${dataset.name} (${dataset.language})` : ''}
                onChange={(event) => set({ name: event.target.value })}
              />
            </Col>
            <Col xs={8} md={4}>
              <Text type="secondary">{t('trainEpochs')}</Text>
              <InputNumber style={{ width: '100%' }} min={1} max={100} value={form.epochs} onChange={(epochs) => set({ epochs })} />
            </Col>
            <Col xs={8} md={4}>
              <Text type="secondary">{t('trainBatchSize')}</Text>
              <InputNumber style={{ width: '100%' }} min={1} max={64} value={form.batchSize} onChange={(batchSize) => set({ batchSize })} />
            </Col>
            <Col xs={8} md={4}>
              <Text type="secondary">{t('trainLearningRate')}</Text>
              <Select
                style={{ width: '100%' }}
                value={form.learningRate}
                onChange={(learningRate) => set({ learningRate })}
                options={LEARNING_RATES.map((rate) => ({ value: rate, label: rate.toExponential(0) }))}
              />
            </Col>
            <Col xs={24} md={{ span: 6, offset: 6 }} style={{ display: 'flex', alignItems: 'flex-end' }}>
              <Button
                type="primary"
                size="large"
                icon={<RocketOutlined />}
                block
                disabled={!dataset || !form.baseModelId || area.running}
                onClick={train}
              >
                {t('trainButton')}
              </Button>
            </Col>
          </Row>

          {latest && (
            <JobView
              job={latest}
              onCancel={area.cancel}
              sampleColumns={[
                { title: t('mlClip'), dataIndex: 'source' },
                { title: t('trainReference'), dataIndex: 'reference' },
                { title: t('trainBefore'), dataIndex: 'before' },
                { title: t('trainAfter'), dataIndex: 'after' },
              ]}
            />
          )}

          <Table
            rowKey="id"
            size="small"
            columns={modelColumns}
            dataSource={[...models.filter((model) => model.kind === 'finetuned'), ...baseModels]}
            pagination={false}
            loading={area.loading}
            locale={{ emptyText: <Empty description={t('trainNoModels')} /> }}
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

      <Card bordered={false} title={t('mlServerDatasets')}>
        <Table
          rowKey="id"
          size="small"
          columns={datasetColumns}
          dataSource={datasets}
          pagination={false}
          locale={{ emptyText: <Empty description={t('speechNoServerDatasets')} /> }}
          scroll={{ x: 'max-content' }}
        />
      </Card>

      <SpeechTestModal model={testing} area={area} onClose={() => setTesting(null)} />
    </Space>
  );
}

/** Pick WAV files and transcribe them with the model. */
function SpeechTestModal({ model, area, onClose }) {
  const { t } = useLanguage();
  const [language, setLanguage] = useState('en');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setResults([]);
    if (model) setLanguage(model.language || 'en');
  }, [model?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (files) => {
    if (!files.length) return;
    setBusy(true);
    const data = await area.test(files, { modelId: model.id, language: model.language ? '' : language });
    setResults(data ? files.map((file, index) => ({ name: file.name, url: URL.createObjectURL(file), text: data.texts[index] })) : []);
    setBusy(false);
  };

  // Object URLs for the players are released when the list is replaced or the dialog closes.
  useEffect(() => () => results.forEach((row) => URL.revokeObjectURL(row.url)), [results]);

  return (
    <Modal open={Boolean(model)} title={model?.name} onCancel={onClose} footer={null} width={720} destroyOnClose>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Space wrap>
          {!model?.language && (
            <>
              <Text type="secondary">{t('mlSpokenLanguage')}</Text>
              <Select showSearch style={{ minWidth: 180 }} value={language} onChange={setLanguage} options={languageOptions} />
            </>
          )}
          <Button
            type="primary"
            icon={<UploadOutlined />}
            loading={busy}
            onClick={() => document.getElementById('speech-test-input')?.click()}
          >
            {t('speechChooseWav')}
          </Button>
          <input
            id="speech-test-input"
            type="file"
            accept=".wav,audio/wav"
            multiple
            style={{ display: 'none' }}
            onChange={(event) => {
              const files = [...(event.target.files || [])].slice(0, 8);
              event.target.value = '';
              run(files);
            }}
          />
        </Space>
        <Text type="secondary">{t('speechTestHelp')}</Text>
        {results.length > 0 && (
          <List
            dataSource={results}
            renderItem={(row) => (
              <List.Item>
                <Space direction="vertical" style={{ width: '100%' }} size={4}>
                  <Space wrap>
                    <Text strong>{row.name}</Text>
                    <audio controls src={row.url} style={{ height: 32 }} />
                  </Space>
                  <Text>{row.text || <Text type="secondary">{t('pythonNoOutput')}</Text>}</Text>
                </Space>
              </List.Item>
            )}
          />
        )}
      </Space>
    </Modal>
  );
}
