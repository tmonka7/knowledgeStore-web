import {
  Card, Collapse, Empty, Space, Table, Tag, Typography,
} from 'antd';
import JobView from '../ml/JobView';
import ModelActions from '../ml/ModelActions';
import useMlArea from '../ml/useMlArea';
import { formatBytes } from '../../lib/mlUpload';
import { useLanguage } from '../../i18n';

const { Text, Paragraph } = Typography;

/**
 * The speaker models on the server, and their ONNX export: one graph from
 * 16 kHz audio to the 192-number voiceprint, checked against PyTorch on one of
 * your voice samples, then downloadable as a zip with a README.
 */
export default function ModelsPanel() {
  const { t } = useLanguage();
  const area = useMlArea('speaker', t, { datasets: false });
  const { models, jobs } = area;
  const exporting = new Set(jobs.filter((job) => job.status === 'running').map((job) => job.modelId));

  const columns = [
    {
      title: t('mlTestModel'),
      key: 'name',
      render: (_, model) => (
        <Space wrap size={4}>
          <Tag color={model.kind === 'base' ? 'default' : 'purple'}>{model.kind === 'base' ? t('trainBase') : t('trainFinetuned')}</Tag>
          <Text strong>{model.name}</Text>
        </Space>
      ),
    },
    { title: t('speakerArchitecture'), key: 'architecture', render: (_, model) => model.architecture || 'ECAPA-TDNN' },
    {
      title: t('speakerModelSize'),
      key: 'size',
      render: (_, model) => formatBytes(Object.values(model.files || {}).reduce((sum, size) => sum + size, 0)),
    },
    {
      title: '',
      key: 'actions',
      render: (_, model) => <ModelActions model={model} area={area} busy={exporting.has(model.id)} deletable={false} />,
    },
  ];

  const [latest, ...older] = jobs;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card bordered={false} title={t('speakerModelsTitle')}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Paragraph type="secondary" style={{ margin: 0 }}>{t('speakerOnnxHelp')}</Paragraph>
          <Table
            rowKey="id"
            size="small"
            loading={area.loading}
            columns={columns}
            dataSource={models}
            pagination={false}
            locale={{ emptyText: <Empty description={t('speakerNoModel')} /> }}
            scroll={{ x: 'max-content' }}
          />
        </Space>
      </Card>

      {latest && (
        <Card bordered={false} title={t('speakerExports')}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <JobView job={latest} onCancel={area.cancel} />
            {older.length > 0 && (
              <Collapse
                size="small"
                items={[{
                  key: 'older',
                  label: t('trainEarlierJobs', { count: older.length }),
                  children: (
                    <Space direction="vertical" style={{ width: '100%' }}>
                      {older.map((job) => <JobView key={job.id} job={job} onCancel={area.cancel} compact />)}
                    </Space>
                  ),
                }]}
              />
            )}
          </Space>
        </Card>
      )}
    </Space>
  );
}
