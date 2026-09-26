import {
  Alert, Button, Card, Collapse, Descriptions, Progress, Space, Table, Tag, Typography,
} from 'antd';
import { StopOutlined } from '@ant-design/icons';
import { useLanguage } from '../../i18n';

const { Text } = Typography;

export const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12 };

const STATUS_COLOR = { running: 'processing', succeeded: 'success', failed: 'error', cancelled: 'default' };

export const formatSeconds = (seconds) => {
  if (seconds == null) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours} h ${minutes} min`;
  return minutes ? `${minutes} min ${seconds % 60} s` : `${seconds} s`;
};

// How each per-epoch figure is labelled; anything unlisted shows its own key.
const METRIC_LABELS = { trainLoss: 'train', validationLoss: 'validation' };

/** "Epoch 3: train 0.412, validation 0.498" — or mAP figures for YOLO. */
const epochSummary = (t, entry) => {
  const values = Object.entries(entry)
    .filter(([key, value]) => key !== 'epoch' && value != null)
    .map(([key, value]) => `${METRIC_LABELS[key] || key} ${typeof value === 'number' ? value.toFixed(3) : value}`)
    .join(', ');
  return t('mlEpochSummary', { epoch: entry.epoch, values });
};

/**
 * One training or ONNX-export job: progress, per-epoch figures, sample
 * results, the export check and the log. Shared by the Transformers, YOLO and
 * Speech to Text training panels.
 */
export default function JobView({ job, onCancel, compact = false, sampleColumns }) {
  const { t } = useLanguage();
  const progress = job.progress;
  const percent = job.status === 'succeeded'
    ? 100
    : progress?.totalSteps ? Math.floor((progress.step / progress.totalSteps) * 100) : 0;
  const onnxCheck = job.kind === 'onnx' ? job.result?.check : null;

  return (
    <Card
      size="small"
      type="inner"
      title={(
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
            {job.history.map((entry) => <Tag key={entry.epoch}>{epochSummary(t, entry)}</Tag>)}
          </Space>
        )}

        {!compact && job.result?.final && Object.keys(job.result.final).length > 0 && (
          <Text>{t('mlFinalScore', { values: Object.entries(job.result.final).map(([key, value]) => `${key} ${value}`).join(', ') })}</Text>
        )}
        {!compact && job.result?.metric && job.result.errorAfter != null && (
          <Text>
            {t('mlErrorRate', {
              metric: job.result.metric,
              before: `${(job.result.errorBefore * 100).toFixed(1)}%`,
              after: `${(job.result.errorAfter * 100).toFixed(1)}%`,
            })}
          </Text>
        )}

        {!compact && job.samples?.length > 0 && (
          <Table
            rowKey="source"
            size="small"
            pagination={false}
            dataSource={job.samples}
            columns={sampleColumns || [
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
