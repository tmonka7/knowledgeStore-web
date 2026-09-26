import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Card, Col, Collapse, Descriptions, Empty, Input, InputNumber, Modal, Popconfirm, Progress, Row, Select,
  Space, Table, Tag, Tooltip, Typography, message,
} from 'antd';
import {
  CloudDownloadOutlined, DeleteOutlined, ExportOutlined, ReloadOutlined, RocketOutlined, StopOutlined, TranslationOutlined,
} from '@ant-design/icons';
import api from '../../api';
import { useLanguage } from '../../i18n';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

const POLL_MS = 2000;
const LEARNING_RATES = [1e-5, 2e-5, 3e-5, 5e-5, 1e-4];
const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12 };

const STATUS_COLOR = { running: 'processing', succeeded: 'success', failed: 'error', cancelled: 'default' };

const formatBytes = (bytes) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(0)} MB` : `${Math.ceil(bytes / 1e3)} KB`);

const formatSeconds = (seconds) => {
  if (seconds == null) return '';
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes} min ${seconds % 60} s` : `${seconds} s`;
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

  // A model for the chosen direction first; anything else is allowed but
  // marked, since a model trained en→es learns nothing useful from ja→en.
  const modelOptions = useMemo(() => {
    const fits = (model) => model.source === form.source && model.target === form.target;
    const option = (model) => ({
      value: model.id,
      label: `${model.name} (${model.source}→${model.target})${fits(model) ? '' : ` — ${t('trainOtherPair')}`}`,
    });
    return [
      { label: t('trainMatchingModels'), options: models.filter(fits).map(option) },
      { label: t('trainOtherModels'), options: models.filter((model) => !fits(model)).map(option) },
    ].filter((group) => group.options.length);
  }, [models, form.source, form.target, t]);

  useEffect(() => {
    setForm((current) => {
      if (models.some((model) => model.id === current.baseModelId
        && model.source === current.source && model.target === current.target)) return current;
      const match = models.find((model) => model.kind === 'base' && model.source === current.source && model.target === current.target)
        || models.find((model) => model.source === current.source && model.target === current.target);
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
    { title: t('trainPair'), key: 'pair', width: 110, render: (_, model) => <Tag>{`${model.source} → ${model.target}`}</Tag> },
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
                  pip install -r backend/python/requirements.txt{'\n'}python backend/python/download_models.py en-es es-en
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

function JobView({ job, onCancel, compact = false }) {
  const { t } = useLanguage();
  const progress = job.progress;
  const percent = job.status === 'succeeded'
    ? 100
    : progress?.totalSteps ? Math.floor((progress.step / progress.totalSteps) * 100) : 0;
  const onnxCheck = job.kind === 'onnx' ? job.result?.check : null;

  return (
    <Card size="small" type="inner" title={(
      <Space wrap>
        <Tag color={job.kind === 'train' ? 'purple' : 'cyan'}>{job.kind === 'train' ? t('trainButton') : 'ONNX'}</Tag>
        <Text strong>{job.title}</Text>
        <Tag color={STATUS_COLOR[job.status]}>{t(`jobStatus_${job.status}`)}</Tag>
      </Space>
    )}
      extra={job.status === 'running' && (
        <Button size="small" danger icon={<StopOutlined />} onClick={() => onCancel(job)}>{t('cancel')}</Button>
      )}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        {job.kind === 'train' && (
          <Progress
            percent={percent}
            status={job.status === 'failed' ? 'exception' : job.status === 'running' ? 'active' : undefined}
          />
        )}
        <Space wrap size={[16, 4]}>
          <Text type="secondary">{job.message}</Text>
          {progress?.loss != null && <Text>{t('trainLoss')}: {progress.loss.toFixed(4)}</Text>}
          {job.status === 'running' && progress?.etaSeconds != null && (
            <Text type="secondary">{t('trainEta', { time: formatSeconds(progress.etaSeconds) })}</Text>
          )}
          {job.details?.device && <Tag>{job.details.device}</Tag>}
        </Space>
        {job.error && <Alert type="error" showIcon message={job.error} />}

        {!compact && job.history?.length > 0 && (
          <Space wrap>
            {job.history.map((entry) => (
              <Tag key={entry.epoch}>
                {t('trainEpochSummary', {
                  epoch: entry.epoch,
                  train: entry.trainLoss.toFixed(3),
                  validation: entry.validationLoss == null ? '—' : entry.validationLoss.toFixed(3),
                })}
              </Tag>
            ))}
          </Space>
        )}

        {!compact && job.samples?.length > 0 && (
          <Table
            rowKey="source"
            size="small"
            pagination={false}
            dataSource={job.samples}
            columns={[
              { title: t('translationSource'), dataIndex: 'source' },
              { title: t('trainReference'), dataIndex: 'reference' },
              { title: t('trainBefore'), dataIndex: 'before' },
              { title: t('trainAfter'), dataIndex: 'after' },
            ]}
            scroll={{ x: 'max-content' }}
          />
        )}

        {!compact && onnxCheck && (
          onnxCheck.verified ? (
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label={t('onnxCheckInput')}>{onnxCheck.input}</Descriptions.Item>
              <Descriptions.Item label="ONNX">{onnxCheck.onnx}</Descriptions.Item>
              <Descriptions.Item label="PyTorch">
                {onnxCheck.pytorch}{' '}
                <Tag color={onnxCheck.match ? 'green' : 'gold'}>{onnxCheck.match ? t('onnxCheckMatch') : t('onnxCheckDiffers')}</Tag>
              </Descriptions.Item>
            </Descriptions>
          ) : <Alert type="info" showIcon message={onnxCheck.reason} />
        )}

        {!compact && job.log?.length > 0 && (
          <Collapse
            size="small"
            items={[{
              key: 'log',
              label: t('trainLog', { count: job.log.length }),
              children: (
                <pre style={{ ...MONO, margin: 0, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                  {job.log.join('\n')}
                </pre>
              ),
            }]}
          />
        )}
      </Space>
    </Card>
  );
}

function TestModal({ model, onClose }) {
  const { t } = useLanguage();
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setResult(null); }, [model?.id]);

  const run = async () => {
    const texts = text.split(/\r?\n/).filter((line) => line.trim());
    if (!texts.length) return;
    setBusy(true);
    try {
      const { data } = await api.post('/tools/transformers/translate', { modelId: model.id, texts }, { timeout: 0 });
      setResult({ ...data, texts });
    } catch (error) {
      message.error(error.response?.data?.message || t('trainTranslateFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(model)}
      title={model ? `${model.name} (${model.source} → ${model.target})` : ''}
      onCancel={onClose}
      footer={null}
      width={760}
      destroyOnClose
    >
      <Space direction="vertical" style={{ width: '100%' }}>
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
              { title: model?.source, dataIndex: 'source' },
              { title: model?.target, dataIndex: 'output' },
            ]}
            footer={() => <Text type="secondary">{`${result.seconds} s · ${result.device}`}</Text>}
          />
        )}
      </Space>
    </Modal>
  );
}
