import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Card, Col, Collapse, Empty, Input, InputNumber, Popconfirm, Row, Select, Slider, Space, Table,
  Tag, Tooltip, Typography,
} from 'antd';
import { DeleteOutlined, ReloadOutlined, RocketOutlined, UploadOutlined } from '@ant-design/icons';
import DeviceSelect from '../ml/DeviceSelect';
import JobView, { MONO } from '../ml/JobView';
import ModelActions from '../ml/ModelActions';
import TestCard from '../ml/TestCard';
import useMlArea from '../ml/useMlArea';
import { colorForClass } from '../../lib/objectDetector';
import { formatBytes } from '../../lib/mlUpload';
import { useLanguage } from '../../i18n';

const { Text, Paragraph } = Typography;

const IMAGE_SIZES = [320, 416, 512, 640, 800, 960, 1280];

const taskOfModel = (model) => model.yoloTask || model.result?.task || 'detect';
const finalMap = (model) => model.final?.mAP50 ?? model.history?.[model.history.length - 1]?.mAP50;

/**
 * Training YOLO models on datasets saved from the Labelling tab, testing them
 * on an image, and exporting them to ONNX. Everything runs on the server,
 * offline, from the models in backend/python/models.
 */
export default function YoloTrainingPanel() {
  const { t } = useLanguage();
  const area = useMlArea('yolo', t);
  const { models, datasets, jobs } = area;
  const [form, setForm] = useState({
    datasetId: '', baseModelId: '', name: '', epochs: 50, imgsz: 640, batchSize: 8, device: 'auto',
  });
  const [testId, setTestId] = useState('');
  const testRef = useRef(null);
  // A row's Test button picks that model in the Test section below and scrolls to it.
  const openTest = (model) => {
    setTestId(model.id);
    testRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const ready = datasets.filter((dataset) => dataset.complete);
  const dataset = ready.find((item) => item.id === form.datasetId) || null;

  useEffect(() => {
    if (!dataset && ready.length) set({ datasetId: ready[0].id });
  }, [ready.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only weights for the dataset's task can train on it: a detection model
  // cannot learn outlines, and a segmentation one needs them.
  const candidates = useMemo(
    () => models.filter((model) => !dataset || taskOfModel(model) === dataset.task),
    [models, dataset],
  );
  useEffect(() => {
    if (!candidates.some((model) => model.id === form.baseModelId)) {
      set({ baseModelId: (candidates.find((model) => model.kind === 'base') || candidates[0])?.id || '' });
    }
  }, [candidates]); // eslint-disable-line react-hooks/exhaustive-deps

  const train = () => area.train({
    datasetId: form.datasetId,
    baseModelId: form.baseModelId,
    name: form.name,
    options: { epochs: form.epochs, imgsz: form.imgsz, batchSize: form.batchSize, device: form.device },
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
            <Tag>{taskOfModel(model) === 'segment' ? t('yoloSegment') : t('yoloDetect')}</Tag>
          </Space>
          {model.kind === 'finetuned' && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('trainFromOn', { base: model.baseName, dataset: model.datasetName })}
              {model.classes ? ` · ${model.classes.join(', ')}` : ''}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: 'mAP50',
      key: 'map',
      width: 90,
      render: (_, model) => (finalMap(model) == null ? '—' : finalMap(model).toFixed(3)),
    },
    {
      key: 'actions',
      width: 280,
      render: (_, model) => (
        <ModelActions model={model} area={area} busy={busyModelIds.has(model.id)} onTest={openTest} />
      ),
    },
  ];

  const datasetColumns = [
    { title: t('trainDataset'), dataIndex: 'name' },
    {
      title: t('yoloTask'),
      key: 'task',
      render: (_, item) => (item.complete ? <Tag>{item.task === 'segment' ? t('yoloSegment') : t('yoloDetect')}</Tag>
        : <Tag color="gold">{t('mlIncomplete')}</Tag>),
    },
    { title: t('mlImages'), key: 'images', render: (_, item) => `${item.labelled ?? 0} / ${item.fileCount ?? 0}` },
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
          <Alert type="info" showIcon message={t('yoloLicence')} />
          {!area.loading && !baseModels.length && (
            <Alert
              type="warning"
              showIcon
              message={t('trainNoBaseModels')}
              description={(
                <Paragraph style={{ margin: 0 }}>
                  {t('trainNoBaseModelsHelp')}
                  <pre style={{ ...MONO, margin: '8px 0 0' }}>
                    pip install -r backend/python/requirements.txt{'\n'}python backend/python/download_models.py yolo26n yolo26n-seg
                  </pre>
                </Paragraph>
              )}
            />
          )}
          {!ready.length && (
            <Alert type="info" showIcon icon={<UploadOutlined />} message={t('yoloNoServerDatasets')} />
          )}

          <Row gutter={[12, 12]}>
            <Col xs={24} md={8}>
              <Text type="secondary">{t('trainDataset')}</Text>
              <Select
                style={{ width: '100%' }}
                value={form.datasetId || undefined}
                placeholder={t('translationPickDataset')}
                onChange={(datasetId) => set({ datasetId })}
                options={ready.map((item) => ({
                  value: item.id,
                  label: `${item.name} (${item.task === 'segment' ? t('yoloSegment') : t('yoloDetect')}, ${item.labelled})`,
                }))}
              />
            </Col>
            <Col xs={24} md={8}>
              <Text type="secondary">{t('trainStartFrom')}</Text>
              <Select
                style={{ width: '100%' }}
                value={form.baseModelId || undefined}
                placeholder={t('trainPickModel')}
                onChange={(baseModelId) => set({ baseModelId })}
                options={candidates.map((model) => ({ value: model.id, label: model.name }))}
                notFoundContent={t('trainNoBaseModels')}
              />
            </Col>
            <Col xs={24} md={8}>
              <Text type="secondary">{t('trainModelName')}</Text>
              <Input
                value={form.name}
                maxLength={120}
                placeholder={dataset ? dataset.name : ''}
                onChange={(event) => set({ name: event.target.value })}
              />
            </Col>
            <Col xs={8} md={4}>
              <Text type="secondary">{t('trainEpochs')}</Text>
              <InputNumber style={{ width: '100%' }} min={1} max={1000} value={form.epochs} onChange={(epochs) => set({ epochs })} />
            </Col>
            <Col xs={8} md={4}>
              <Text type="secondary">{t('yoloImageSize')}</Text>
              <Select
                style={{ width: '100%' }}
                value={form.imgsz}
                onChange={(imgsz) => set({ imgsz })}
                options={IMAGE_SIZES.map((size) => ({ value: size, label: size }))}
              />
            </Col>
            <Col xs={8} md={4}>
              <Text type="secondary">{t('trainBatchSize')}</Text>
              <InputNumber style={{ width: '100%' }} min={1} max={128} value={form.batchSize} onChange={(batchSize) => set({ batchSize })} />
            </Col>
            <Col xs={24} md={6}>
              <Text type="secondary">{t('trainDevice')}</Text>
              <DeviceSelect base="/tools/yolo" value={form.device} onChange={(device) => set({ device })} />
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

          {latest && <JobView job={latest} onCancel={area.cancel} />}

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

      <TestCard
        ref={testRef}
        models={[...models.filter((model) => model.kind === 'finetuned'), ...baseModels]}
        value={testId}
        onChange={setTestId}
        describe={(model) => (taskOfModel(model) === 'segment' ? t('yoloSegment') : t('yoloDetect'))}
      >
        {(model) => <YoloTest model={model} area={area} />}
      </TestCard>

      <Card bordered={false} title={t('mlServerDatasets')}>
        <Table
          rowKey="id"
          size="small"
          columns={datasetColumns}
          dataSource={datasets}
          pagination={false}
          locale={{ emptyText: <Empty description={t('yoloNoServerDatasets')} /> }}
          scroll={{ x: 'max-content' }}
        />
      </Card>
    </Space>
  );
}

/** Pick an image, run the model on it, and draw what it found. */
function YoloTest({ model, area }) {
  const { t } = useLanguage();
  const [file, setFile] = useState(null);
  const [url, setUrl] = useState('');
  const [confidence, setConfidence] = useState(0.25);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setResult(null); }, [model?.id]);
  useEffect(() => {
    if (!file) {
      setUrl('');
      return undefined;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const run = async (chosen = file) => {
    if (!chosen) return;
    setBusy(true);
    const data = await area.test([chosen], { modelId: model.id, confidence });
    setResult(data?.results?.[0] || null);
    setBusy(false);
  };

  const detections = result?.detections || [];

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Space wrap>
        <Button icon={<UploadOutlined />} onClick={() => document.getElementById('yolo-test-input')?.click()}>
          {t('yoloChooseImage')}
        </Button>
        <input
          id="yolo-test-input"
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            event.target.value = '';
            if (!chosen) return;
            setFile(chosen);
            setResult(null);
            run(chosen);
          }}
        />
        <Text type="secondary">{t('yoloConfidence')}</Text>
        <Slider min={0.05} max={0.95} step={0.05} value={confidence} onChange={setConfidence} style={{ width: 160 }} />
        <Button type="primary" loading={busy} disabled={!file} onClick={() => run()}>{t('yoloDetectButton')}</Button>
      </Space>

      {url && (
        <div style={{ position: 'relative', width: '100%', maxWidth: 820, lineHeight: 0 }}>
          <img src={url} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
          {/* Detections are normalised 0..1, so a 1x1 viewBox lays them over the image at any size. */}
          <svg viewBox="0 0 1 1" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            {detections.map((detection, index) => {
              const [x1, y1, x2, y2] = detection.box;
              const color = colorForClass(detection.classId);
              return (
                <g key={index}>
                  {detection.polygon?.length ? (
                    <polygon
                      points={detection.polygon.map(([x, y]) => `${x},${y}`).join(' ')}
                      fill={color}
                      fillOpacity={0.25}
                      stroke={color}
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}
                  <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {result && (
        <Space wrap>
          {detections.length ? detections.map((detection, index) => (
            <Tag key={index} color={colorForClass(detection.classId)}>
              {`${detection.name} ${(detection.confidence * 100).toFixed(0)}%`}
            </Tag>
          )) : <Text type="secondary">{t('yoloNothingFound')}</Text>}
        </Space>
      )}
    </Space>
  );
}
