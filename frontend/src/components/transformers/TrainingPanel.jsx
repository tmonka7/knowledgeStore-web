import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Card, Col, Collapse, Empty, Input, InputNumber, Modal, Popconfirm, Row, Select,
  Space, Table, Tag, Tooltip, Typography, message,
} from 'antd';
import {
  CloudDownloadOutlined, DeleteOutlined, ExportOutlined, ReloadOutlined, RocketOutlined, TranslationOutlined,
} from '@ant-design/icons';
import api from '../../api';
import JobView, { MONO } from '../ml/JobView';
import { useLanguage } from '../../i18n';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

const POLL_MS = 2000;
const LEARNING_RATES = [1e-5, 2e-5, 3e-5, 5e-5, 1e-4];


const formatBytes = (bytes) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(0)} MB` : `${Math.ceil(bytes / 1e3)} KB`);


// Mirrors LANGUAGE_ALIASES in backend/python/ks_common.py.
const LANGUAGE_ALIASES = { jp: 'ja', jpn: 'ja', kor: 'ko', zho: 'zh', chi: 'zh', eng: 'en', spa: 'es' };

/** A dataset code ("ko", "zh-Hans", "jp") as a multilingual model names it. */
const modelLanguage = (code) => {
  const primary = String(code).split(/[-_]/)[0].toLowerCase();
  return LANGUAGE_ALIASES[primary] || primary;
};

/** A multilingual base model (M2M100) translates any direction it has languages for. */
const isOpenMultilingual = (model) => Boolean(model.multilingual && !model.source);

/**
 * How well `model` fits source -> target: 'exact' when it was made for that
 * direction, 'multi' when it is a multilingual model covering both
 * languages, '' when it does neither.
 */
const fitFor = (model, source, target) => {
  if (!source || !target) return '';
  if (model.source === source && model.target === target) return 'exact';
  if (isOpenMultilingual(model)) {
    const languages = model.languages || [];
    if (!languages.length || [source, target].every((code) => languages.includes(modelLanguage(code)))) return 'multi';
  }
  return '';
};

const lastLoss = (model) => {
  const final = model.history?.[model.history.length - 1];
  return final ? (final.validationLoss ?? final.trainLoss) : null;
};

/**
 * Fine-tuning local translation models, exporting them to ONNX, and trying
 * them out. Everything runs from models already on the server; nothing here
 * reaches the internet.
 *
 * `request` is set by the dataset editor's Train button ({ datasetId, source,
 * target }) and pre-fills the form.
 */
const TrainingPanel = forwardRef(function TrainingPanel({ datasets, activeId, request }, ref) {
  const { t } = useLanguage();

  const [models, setModels] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [starting, setStarting] = useState(false);
  const [form, setForm] = useState({
    datasetId: activeId || '', source: '', target: '', baseModelId: '', name: '', epochs: 3, batchSize: 8, learningRate: 5e-5,
  });
  const [testing, setTesting] = useState(null);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const loadModels = useCallback(async () => {
    setLoadingModels(true);
    try {
      const { data } = await api.get('/tools/transformers/models');
      setModels(data.models || []);
    } catch (error) {
      message.error(error.response?.data?.message || t('trainModelsLoadFailed'));
    } finally {
      setLoadingModels(false);
    }
  }, [t]);

  const loadJobs = useCallback(async () => {
    try {
      const { data } = await api.get('/tools/transformers/jobs');
      setJobs(data.jobs || []);
      return data.jobs || [];
    } catch {
      return [];
    }
  }, []);

  useEffect(() => { loadModels(); loadJobs(); }, [loadModels, loadJobs]);

  // Poll only while something is running; a finished job means new models.
  const running = jobs.some((job) => job.status === 'running');
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) loadModels();
    wasRunning.current = running;
    if (!running) return undefined;
    const timer = setInterval(loadJobs, POLL_MS);
    return () => clearInterval(timer);
  }, [running, loadJobs, loadModels]);

  // The editor's Train button, or simply opening another dataset.
  useEffect(() => {
    if (request) set({ datasetId: request.datasetId, source: request.source, target: request.target });
  }, [request]);
  useEffect(() => {
    if (activeId) set({ datasetId: activeId });
  }, [activeId]);

  const dataset = datasets.find((item) => item.id === form.datasetId) || null;
  const languages = dataset?.languages || [];

  // Source and target have to be languages of the chosen dataset.
  useEffect(() => {
    if (!dataset) return;
    setForm((current) => {
      const source = languages.includes(current.source) ? current.source : languages[0];
      const target = languages.includes(current.target) && current.target !== source
        ? current.target
        : languages.find((code) => code !== source);
      return { ...current, source, target };
    });
  }, [dataset?.id, languages.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const baseModels = models.filter((model) => model.kind === 'base');
  const finetuned = models.filter((model) => model.kind === 'finetuned');

  const pairLabel = (model) => (isOpenMultilingual(model)
    ? t('trainMultilingual', { count: model.languages?.length || '' })
    : `${model.source}→${model.target}`);

  // Models for the chosen direction first — including a multilingual model
  // that covers it; anything else is allowed but marked, since a model
  // trained en→es learns nothing useful from ja→en.
  const modelOptions = useMemo(() => {
    const fits = (model) => Boolean(fitFor(model, form.source, form.target));
    const option = (model) => ({
      value: model.id,
      label: `${model.name} (${pairLabel(model)})${fits(model) ? '' : ` — ${t('trainOtherPair')}`}`,
    });
    return [
      { label: t('trainMatchingModels'), options: models.filter(fits).map(option) },
      { label: t('trainOtherModels'), options: models.filter((model) => !fits(model)).map(option) },
    ].filter((group) => group.options.length);
  }, [models, form.source, form.target, t]);

  // Default to the best starting point: a small model made for the pair,
  // then one trained on it earlier, then the multilingual model.
  useEffect(() => {
    setForm((current) => {
      const fit = (model) => fitFor(model, current.source, current.target);
      if (models.some((model) => model.id === current.baseModelId && fit(model))) return current;
      const match = models.find((model) => model.kind === 'base' && fit(model) === 'exact')
        || models.find((model) => fit(model) === 'exact')
        || models.find((model) => fit(model) === 'multi');
      return { ...current, baseModelId: match?.id || '' };
    });
  }, [models, form.source, form.target]);

  const train = async () => {
    setStarting(true);
    try {
      const { data } = await api.post('/tools/transformers/train', {
        datasetId: form.datasetId,
        source: form.source,
        target: form.target,
        baseModelId: form.baseModelId,
        name: form.name,
        options: { epochs: form.epochs, batchSize: form.batchSize, learningRate: form.learningRate },
      });
      setJobs((current) => [data.job, ...current]);
      message.success(t('trainStarted'));
    } catch (error) {
      message.error(error.response?.data?.message || t('trainFailedToStart'));
    } finally {
      setStarting(false);
    }
  };

  const cancel = async (job) => {
    try {
      await api.post(`/tools/transformers/jobs/${job.id}/cancel`);
      loadJobs();
    } catch (error) {
      message.error(error.response?.data?.message || error.message);
    }
  };

  const exportOnnx = async (model) => {
    try {
      const { data } = await api.post(`/tools/transformers/models/${model.id}/onnx`);
      setJobs((current) => [data.job, ...current]);
    } catch (error) {
      message.error(error.response?.data?.message || t('onnxFailedToStart'));
    }
  };

  // The zip can be over a gigabyte, so the browser downloads it natively from
  // a one-use link rather than through the API client as an in-memory blob.
  const downloadOnnx = async (model) => {
    try {
      const { data } = await api.post(`/tools/transformers/models/${model.id}/onnx/link`);
      const link = document.createElement('a');
      link.href = `${api.defaults.baseURL.replace(/\/$/, '')}${data.path}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      message.error(error.response?.data?.message || t('onnxDownloadFailed'));
    }
  };

  const removeModel = async (model) => {
    try {
      await api.delete(`/tools/transformers/models/${model.id}`);
      loadModels();
    } catch (error) {
      message.error(error.response?.data?.message || error.message);
    }
  };

  const latest = jobs[0] || null;
  const busyModelIds = new Set(jobs.filter((job) => job.status === 'running').map((job) => job.modelId));
  const canTrain = Boolean(dataset && form.source && form.target && form.baseModelId) && !running;

  const modelColumns = [
    {
      title: t('trainModel'),
      key: 'name',
      render: (_, model) => (
        <Space direction="vertical" size={0}>
          <Space size={6}>
            <Text strong>{model.name}</Text>
            <Tag color={model.kind === 'base' ? 'default' : 'purple'}>{model.kind === 'base' ? t('trainBase') : t('trainFinetuned')}</Tag>
          </Space>
          {model.kind === 'finetuned' && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('trainFromOn', { base: model.baseName, dataset: model.datasetName })}
            </Text>
          )}
        </Space>
      ),
    },
    { title: t('trainPair'), key: 'pair', width: 130, render: (_, model) => <Tag>{pairLabel(model)}</Tag> },
    {
      title: t('trainLoss'),
      key: 'loss',
      width: 90,
      render: (_, model) => (lastLoss(model) == null ? '—' : lastLoss(model).toFixed(3)),
    },
    {
      key: 'actions',
      width: 260,
      render: (_, model) => (
        <Space wrap>
          <Button size="small" icon={<TranslationOutlined />} onClick={() => setTesting(model)}>{t('trainTest')}</Button>
          {model.onnxBytes ? (
            <Tooltip title={formatBytes(model.onnxBytes)}>
              <Button size="small" icon={<CloudDownloadOutlined />} onClick={() => downloadOnnx(model)}>ONNX</Button>
            </Tooltip>
          ) : null}
          <Tooltip title={model.onnxBytes ? t('onnxExportAgain') : t('onnxExport')}>
            <Button
              size="small"
              icon={<ExportOutlined />}
              disabled={running || busyModelIds.has(model.id)}
              onClick={() => exportOnnx(model)}
            >
              {model.onnxBytes ? '' : t('onnxExport')}
            </Button>
          </Tooltip>
          {model.kind === 'finetuned' && (
            <Popconfirm title={t('trainDeleteModel')} onConfirm={() => removeModel(model)} okButtonProps={{ danger: true }}>
              <Button size="small" danger icon={<DeleteOutlined />} disabled={busyModelIds.has(model.id)} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card
      ref={ref}
      bordered={false}
      title={t('trainTitle')}
      extra={(
        <Tooltip title={t('translationReload')}>
          <Button icon={<ReloadOutlined />} loading={loadingModels} onClick={() => { loadModels(); loadJobs(); }} />
        </Tooltip>
      )}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {!loadingModels && !baseModels.length && (
          <Alert
            type="warning"
            showIcon
            message={t('trainNoBaseModels')}
            description={(
              <Paragraph style={{ margin: 0 }}>
                {t('trainNoBaseModelsHelp')}
                <pre style={{ ...MONO, margin: '8px 0 0' }}>
                  pip install -r backend/python/requirements.txt{'\n'}python backend/python/download_models.py en-es en-zh m2m100
                </pre>
              </Paragraph>
            )}
          />
        )}

        <Row gutter={[12, 12]}>
          <Col xs={24} md={8}>
            <Text type="secondary">{t('trainDataset')}</Text>
            <Select
              style={{ width: '100%' }}
              value={form.datasetId || undefined}
              placeholder={t('translationPickDataset')}
              onChange={(datasetId) => set({ datasetId })}
              options={datasets.map((item) => ({ value: item.id, label: `${item.name} (${item.rowCount})` }))}
            />
          </Col>
          <Col xs={12} md={4}>
            <Text type="secondary">{t('translationSource')}</Text>
            <Select
              style={{ width: '100%' }}
              value={form.source || undefined}
              onChange={(source) => set({ source, target: source === form.target ? form.source : form.target })}
              options={languages.map((code) => ({ value: code, label: code }))}
            />
          </Col>
          <Col xs={12} md={4}>
            <Text type="secondary">{t('translationTarget')}</Text>
            <Select
              style={{ width: '100%' }}
              value={form.target || undefined}
              onChange={(target) => set({ target, source: target === form.source ? form.target : form.source })}
              options={languages.map((code) => ({ value: code, label: code }))}
            />
          </Col>
          <Col xs={24} md={8}>
            <Text type="secondary">{t('trainStartFrom')}</Text>
            <Select
              style={{ width: '100%' }}
              value={form.baseModelId || undefined}
              placeholder={t('trainPickModel')}
              onChange={(baseModelId) => set({ baseModelId })}
              options={modelOptions}
              notFoundContent={t('trainNoBaseModels')}
            />
          </Col>
          <Col xs={8} md={4}>
            <Text type="secondary">{t('trainEpochs')}</Text>
            <InputNumber style={{ width: '100%' }} min={1} max={50} value={form.epochs} onChange={(epochs) => set({ epochs })} />
          </Col>
          <Col xs={8} md={4}>
            <Text type="secondary">{t('trainBatchSize')}</Text>
            <InputNumber style={{ width: '100%' }} min={1} max={128} value={form.batchSize} onChange={(batchSize) => set({ batchSize })} />
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
          <Col xs={24} md={8}>
            <Text type="secondary">{t('trainModelName')}</Text>
            <Input
              value={form.name}
              maxLength={120}
              placeholder={dataset ? `${dataset.name} ${form.source}→${form.target}` : ''}
              onChange={(event) => set({ name: event.target.value })}
            />
          </Col>
          <Col xs={24} md={4} style={{ display: 'flex', alignItems: 'flex-end' }}>
            <Button type="primary" size="large" icon={<RocketOutlined />} block loading={starting} disabled={!canTrain} onClick={train}>
              {t('trainButton')}
            </Button>
          </Col>
        </Row>

        {latest && <JobView job={latest} onCancel={cancel} />}

        <Table
          rowKey="id"
          size="small"
          columns={modelColumns}
          dataSource={[...finetuned, ...baseModels]}
          pagination={false}
          loading={loadingModels}
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
                  {jobs.slice(1).map((job) => <JobView key={job.id} job={job} onCancel={cancel} compact />)}
                </Space>
              ),
            }]}
          />
        )}
      </Space>

      <TestModal model={testing} onClose={() => setTesting(null)} />
    </Card>
  );
});

export default TrainingPanel;

function TestModal({ model, onClose }) {
  const { t } = useLanguage();
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pair, setPair] = useState({ source: '', target: '' });

  // A multilingual base model has no direction of its own: pick one.
  const open = Boolean(model && isOpenMultilingual(model));
  useEffect(() => {
    setResult(null);
    if (!model) return;
    const languages = model.languages || [];
    setPair(open
      ? { source: 'en', target: ['ko', 'zh', 'es', 'ja'].find((code) => languages.includes(code)) || languages[0] || '' }
      : { source: model.source, target: model.target });
  }, [model?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const languageOptions = (model?.languages || []).map((code) => ({ value: code, label: code }));

  const run = async () => {
    const texts = text.split(/\r?\n/).filter((line) => line.trim());
    if (!texts.length) return;
    setBusy(true);
    try {
      const { data } = await api.post(
        '/tools/transformers/translate',
        { modelId: model.id, texts, source: pair.source, target: pair.target },
        { timeout: 0 },
      );
      setResult({ ...data, texts, source: pair.source, target: pair.target });
    } catch (error) {
      message.error(error.response?.data?.message || t('trainTranslateFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(model)}
      title={model ? `${model.name} (${open ? t('trainMultilingual', { count: model.languages?.length || '' }) : `${model.source} → ${model.target}`})` : ''}
      onCancel={onClose}
      footer={null}
      width={760}
      destroyOnClose
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        {open && (
          <Space wrap>
            <Select
              showSearch
              style={{ width: 120 }}
              value={pair.source}
              options={languageOptions}
              onChange={(source) => setPair((current) => ({ ...current, source }))}
            />
            →
            <Select
              showSearch
              style={{ width: 120 }}
              value={pair.target}
              options={languageOptions}
              onChange={(target) => setPair((current) => ({ ...current, target }))}
            />
          </Space>
        )}
        <TextArea
          value={text}
          onChange={(event) => setText(event.target.value)}
          autoSize={{ minRows: 4, maxRows: 10 }}
          placeholder={t('trainTestPlaceholder')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              run();
            }
          }}
        />
        <Button type="primary" icon={<TranslationOutlined />} loading={busy} onClick={run}>{t('trainTranslate')}</Button>
        {result && (
          <Table
            rowKey={(_, index) => index}
            size="small"
            pagination={false}
            dataSource={result.texts.map((source, index) => ({ source, output: result.translations[index] }))}
            columns={[
              { title: result.source, dataIndex: 'source' },
              { title: result.target, dataIndex: 'output' },
            ]}
            footer={() => <Text type="secondary">{`${result.seconds} s · ${result.device}`}</Text>}
          />
        )}
      </Space>
    </Modal>
  );
}
