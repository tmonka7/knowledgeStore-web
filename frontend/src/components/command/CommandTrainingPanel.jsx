import { useEffect, useRef, useState } from 'react';
import {
  Alert, Button, Card, Col, Collapse, Empty, Input, InputNumber, List, Popconfirm, Row, Select, Space, Table, Tag, Tooltip,
  Typography,
} from 'antd';
import {
  DeleteOutlined, ExperimentOutlined, ReloadOutlined, RocketOutlined, UploadOutlined,
} from '@ant-design/icons';
import DeviceSelect from '../ml/DeviceSelect';
import JobView, { MONO } from '../ml/JobView';
import TestCard, { Side } from '../ml/TestCard';
import useMlArea from '../ml/useMlArea';
import ClipRecorder from '../speaker/ClipRecorder';
import { CommandTag, recognizeClip } from './CommandRecognize';
import { moonshineFor } from '../../lib/commandSets';
import { useLanguage } from '../../i18n';

const { Text, Paragraph } = Typography;

const LEARNING_RATES = [1e-5, 3e-5, 5e-5, 1e-4];
const percent = (value) => (value == null ? '—' : `${Math.round(value * 100)}%`);

/**
 * Train: fine-tune a Moonshine model on a command set's recordings, so it
 * hears those commands, said by those people, more reliably — then test it.
 * The job reports, on held-back recordings, the share recognised as the
 * right command before and after.
 */
export default function CommandTrainingPanel({ reloadKey = 0 }) {
  const { t } = useLanguage();
  const area = useMlArea('command', t);
  const { models, datasets, jobs } = area;
  const [form, setForm] = useState({
    datasetId: '', baseModelId: '', name: '', epochs: 10, batchSize: 8, learningRate: 5e-5, device: 'auto',
  });
  const [testId, setTestId] = useState('');
  const testRef = useRef(null);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  // Command sets change on the Commands tab: re-read them when this tab is shown.
  useEffect(() => { if (reloadKey) area.loadDatasets(); }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = datasets.filter((item) => (item.recorded || 0) >= 2);
  const dataset = ready.find((item) => item.id === form.datasetId) || null;
  const baseModels = models.filter((model) => model.kind === 'base');
  const suitable = baseModels.filter((model) => !dataset || model.language === dataset.language);

  useEffect(() => {
    if (!dataset && ready.length) set({ datasetId: ready[0].id });
  }, [ready.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!suitable.some((model) => model.id === form.baseModelId)) set({ baseModelId: suitable[0]?.id || '' });
  }, [models, dataset?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const train = () => area.train({
    datasetId: form.datasetId,
    baseModelId: form.baseModelId,
    name: form.name,
    options: { epochs: form.epochs, batchSize: form.batchSize, learningRate: form.learningRate, device: form.device },
  });

  const openTest = (model) => {
    setTestId(model.id);
    testRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const busyIds = new Set(jobs.filter((job) => job.status === 'running').map((job) => job.modelId));
  const latest = jobs[0] || null;
  const ordered = [...models.filter((model) => model.kind === 'finetuned'), ...baseModels];

  const columns = [
    {
      title: t('trainModel'),
      key: 'name',
      render: (_, model) => (
        <Space direction="vertical" size={0}>
          <Space size={6} wrap>
            <Text strong>{model.name}</Text>
            <Tag color={model.kind === 'base' ? 'default' : 'purple'}>{model.kind === 'base' ? t('trainBase') : t('trainFinetuned')}</Tag>
            <Tag>{model.language}</Tag>
          </Space>
          {model.kind === 'finetuned' && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('cmdTrainedFrom', { base: model.baseName, set: model.datasetName, count: model.commandCount })}
            </Text>
          )}
          {model.kind === 'base' && model.licence && <Text type="secondary" style={{ fontSize: 12 }}>{model.licence}</Text>}
        </Space>
      ),
    },
    {
      title: t('cmdAccuracyColumn'),
      key: 'accuracy',
      render: (_, model) => (model.result?.accuracyAfter == null ? '—' : (
        <Tooltip title={model.result.heldOut ? t('cmdHeldOutHelp') : t('cmdNotHeldOutHelp')}>
          {`${percent(model.result.accuracyBefore)} → ${percent(model.result.accuracyAfter)}`}
          {!model.result.heldOut && ' *'}
        </Tooltip>
      )),
    },
    {
      key: 'actions',
      render: (_, model) => (
        <Space>
          <Button size="small" icon={<ExperimentOutlined />} onClick={() => openTest(model)}>{t('trainTest')}</Button>
          {model.kind === 'finetuned' && (
            <Popconfirm title={t('trainDeleteModel')} onConfirm={() => area.removeModel(model)} okButtonProps={{ danger: true }}>
              <Button size="small" danger icon={<DeleteOutlined />} disabled={busyIds.has(model.id)} aria-label={t('delete')} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        bordered={false}
        title={t('cmdTrainTitle')}
        extra={(
          <Tooltip title={t('translationReload')}>
            <Button icon={<ReloadOutlined />} loading={area.loading} onClick={area.reload} />
          </Tooltip>
        )}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Paragraph type="secondary" style={{ margin: 0 }}>{t('cmdTrainHelp')}</Paragraph>
          {!area.loading && !baseModels.length && (
            <Alert
              type="warning"
              showIcon
              message={t('cmdNoModels')}
              description={<pre style={{ ...MONO, margin: 0 }}>python backend/python/download_models.py moonshine-tiny</pre>}
            />
          )}
          {!ready.length && <Alert type="info" showIcon message={t('cmdNoTrainableSets')} />}
          {dataset && !suitable.length && (
            <Alert
              type="warning"
              showIcon
              message={t('cmdNoModelForLanguage', { language: dataset.language })}
              description={<pre style={{ ...MONO, margin: 0 }}>{`python backend/python/download_models.py ${moonshineFor(dataset.language)}`}</pre>}
            />
          )}

          <Row gutter={[12, 12]}>
            <Col xs={24} md={8}>
              <Text type="secondary">{t('cmdSet')}</Text>
              <Select
                style={{ width: '100%' }}
                value={form.datasetId || undefined}
                placeholder={t('cmdPickSet')}
                onChange={(datasetId) => set({ datasetId })}
                options={ready.map((item) => ({ value: item.id, label: `${item.name} (${item.language}, ${item.recorded})` }))}
              />
            </Col>
            <Col xs={24} md={8}>
              <Text type="secondary">{t('trainStartFrom')}</Text>
              <Select
                style={{ width: '100%' }}
                value={form.baseModelId || undefined}
                placeholder={t('trainPickModel')}
                onChange={(baseModelId) => set({ baseModelId })}
                options={suitable.map((model) => ({ value: model.id, label: `${model.name} (${model.language})` }))}
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
              <InputNumber style={{ width: '100%' }} min={1} max={200} value={form.epochs} onChange={(epochs) => set({ epochs })} />
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
            <Col xs={24} md={6}>
              <Text type="secondary">{t('trainDevice')}</Text>
              <DeviceSelect base="/tools/command" value={form.device} onChange={(device) => set({ device })} />
            </Col>
            <Col xs={24} md={6} style={{ display: 'flex', alignItems: 'flex-end' }}>
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
                { title: t('cmdExpected'), dataIndex: 'reference' },
                { title: t('trainBefore'), dataIndex: 'before' },
                { title: t('trainAfter'), dataIndex: 'after' },
              ]}
            />
          )}

          <Table
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={ordered}
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

      <TestCard ref={testRef} models={ordered} value={testId} onChange={setTestId} describe={(model) => model.language}>
        {(model, compare) => <CommandTest model={model} compare={compare} sets={datasets} />}
      </TestCard>
    </Space>
  );
}

/**
 * Say a command (or choose WAV files) and see what the model — and the one it
 * is compared with — makes of it. A base model is given a command set; a
 * trained one uses its own commands unless a set is chosen.
 */
function CommandTest({ model, compare, sets }) {
  const { t } = useLanguage();
  const tested = compare ? [model, compare] : [model];
  const needsSet = tested.some((item) => !item.commands);
  const usable = sets.filter((item) => item.language === model.language);
  const [setId, setSetId] = useState('');
  const [rows, setRows] = useState([]); // [{ name, url, results: { modelId: result | { error } } }]
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!usable.some((item) => item.id === setId)) setSetId(usable.find((item) => item.id === model.datasetId)?.id || usable[0]?.id || '');
  }, [model.id, sets]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => rows.forEach((row) => URL.revokeObjectURL(row.url)), [rows]);

  const run = async (items) => {
    if (!items.length) return;
    setBusy(true);
    const next = [];
    for (const { name, blob } of items) {
      const results = {};
      for (const item of tested) {
        try {
          results[item.id] = await recognizeClip({ blob, modelId: item.id, datasetId: item.commands && !needsSet ? '' : setId });
        } catch (error) {
          results[item.id] = { error: error.response?.data?.message || t('cmdRecognizeFailed') };
        }
      }
      next.push({ name, url: URL.createObjectURL(blob), results });
    }
    setRows((current) => [...next, ...current].slice(0, 20));
    setBusy(false);
  };

  const cannot = needsSet && !setId;

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Space wrap>
        {needsSet && (
          <>
            <Text type="secondary">{t('cmdSet')}</Text>
            <Select
              style={{ minWidth: 220 }}
              value={setId || undefined}
              onChange={setSetId}
              placeholder={t('cmdPickSet')}
              notFoundContent={t('cmdNoSetsForLanguage')}
              options={usable.map((item) => ({ value: item.id, label: item.name }))}
            />
          </>
        )}
        <Button
          icon={<UploadOutlined />}
          loading={busy}
          disabled={cannot}
          onClick={() => document.getElementById('command-test-input')?.click()}
        >
          {t('speechChooseWav')}
        </Button>
        <input
          id="command-test-input"
          type="file"
          accept=".wav,audio/wav"
          multiple
          style={{ display: 'none' }}
          onChange={(event) => {
            const files = [...(event.target.files || [])].slice(0, 8);
            event.target.value = '';
            run(files.map((file) => ({ name: file.name, blob: file })));
          }}
        />
      </Space>
      <ClipRecorder
        onClip={(clip) => run([{ name: t('voiceMicrophone'), blob: clip.blob }])}
        disabled={cannot}
        busy={busy}
        maxSeconds={8}
        recordLabel={t('cmdSayCommand')}
      />
      {needsSet && model.commands == null && (
        <Text type="secondary" style={{ fontSize: 12 }}>{t('cmdTestSetHelp')}</Text>
      )}
      {rows.length > 0 && (
        <List
          dataSource={rows}
          renderItem={(row) => (
            <List.Item>
              <Space direction="vertical" style={{ width: '100%' }} size={4}>
                <Space wrap>
                  <Text strong>{row.name}</Text>
                  <audio controls src={row.url} style={{ height: 32 }} />
                </Space>
                <Side
                  models={tested.filter((item) => item.id in row.results)}
                  render={(item) => {
                    const result = row.results[item.id];
                    if (result.error) return <Text type="danger">{result.error}</Text>;
                    return (
                      <Space wrap>
                        <CommandTag result={result} />
                        <Text>{result.text ? `"${result.text}"` : '—'}</Text>
                        <Text type="secondary">{percent(result.score)}</Text>
                      </Space>
                    );
                  }}
                />
              </Space>
            </List.Item>
          )}
        />
      )}
    </Space>
  );
}
