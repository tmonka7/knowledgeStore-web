import {
  Alert, Button, Card, Empty, Progress, Space, Steps, Tag, Tooltip, Typography,
} from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined, CloseOutlined, DeleteOutlined, DownloadOutlined, LoadingOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { ACTIVE, fileUrl } from './useConvertJobs';
import { formatBytes, formatClock } from './format';
import { useLanguage } from '../../i18n';

const { Text } = Typography;

const STEP = { upload: 0, queued: 1, running: 2, done: 3, failed: 2, cancelled: 2 };

const STATUS_TAG = {
  queued: { color: 'default', icon: <LoadingOutlined /> },
  running: { color: 'processing', icon: <LoadingOutlined /> },
  done: { color: 'success', icon: <CheckCircleOutlined /> },
  failed: { color: 'error', icon: <CloseCircleOutlined /> },
  cancelled: { color: 'default', icon: <StopOutlined /> },
};

/** Upload → wait → convert → done, with the current step highlighted. */
function JobSteps({ status }) {
  const { t } = useLanguage();
  const current = STEP[status];
  const stepStatus = status === 'failed' ? 'error' : status === 'done' ? 'finish' : 'process';
  return (
    <Steps
      size="small"
      current={current}
      status={status === 'cancelled' ? 'wait' : stepStatus}
      items={[
        { title: t('convertStepUpload') },
        { title: t('convertStepQueue') },
        { title: t('convertStepConvert') },
        { title: t('convertStepDone') },
      ]}
    />
  );
}

/** The finished file, playable in the page: judge the settings before downloading. */
function Preview({ job }) {
  const src = fileUrl(job);
  if (job.mime?.startsWith('image/')) return <img src={src} alt={job.outputName} style={{ maxWidth: '100%', maxHeight: 360 }} />;
  if (job.kind === 'video') return <video controls preload="metadata" src={src} style={{ width: '100%', maxHeight: 360, background: '#000' }} />;
  return <audio controls preload="metadata" src={src} style={{ width: '100%' }} />;
}

function JobCard({ job, onCancel, onRemove }) {
  const { t } = useLanguage();
  const running = job.status === 'running';
  const known = job.duration > 0;
  const tag = STATUS_TAG[job.status];

  // What ffmpeg reports while it works; each part only once it is known.
  const stats = running ? [
    known ? `${formatClock(job.processed)} / ${formatClock(job.duration)}` : formatClock(job.processed),
    job.speed ? `${job.speed.toFixed(2)}×` : null,
    job.fps ? `${Math.round(job.fps)} fps` : null,
    job.outputBytes ? t('convertSoFar', { size: formatBytes(job.outputBytes) }) : null,
    job.eta != null && known ? t('convertEta', { time: formatClock(job.eta) }) : null,
  ].filter(Boolean).join(' · ') : '';

  const ratio = job.status === 'done' && job.inputBytes ? job.outputBytes / job.inputBytes : null;

  return (
    <Card size="small">
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }} align="start" wrap>
          <Space direction="vertical" size={0}>
            <Space wrap size={6}>
              <Text strong>{job.fileName}</Text>
              {job.outputName && <Text type="secondary">→ {job.outputName}</Text>}
              <Tag color={tag.color} icon={tag.icon}>{t(`convertStatus_${job.status}`)}</Tag>
            </Space>
            {job.summary && <Text type="secondary" style={{ fontSize: 12 }}>{job.summary}</Text>}
          </Space>
          <Space>
            {ACTIVE.has(job.status) && (
              <Button size="small" danger icon={<StopOutlined />} onClick={() => onCancel(job)}>{t('convertCancel')}</Button>
            )}
            {job.status === 'done' && (
              <Button
                size="small"
                type="primary"
                icon={<DownloadOutlined />}
                href={fileUrl(job, true)}
              >
                {`${t('download')} (${formatBytes(job.outputBytes)})`}
              </Button>
            )}
            {!ACTIVE.has(job.status) && (
              <Tooltip title={t('convertRemove')}>
                <Button size="small" icon={<DeleteOutlined />} onClick={() => onRemove(job)} />
              </Tooltip>
            )}
          </Space>
        </Space>

        {job.status !== 'done' && <JobSteps status={job.status} />}

        {job.status === 'queued' && (
          <Text type="secondary">{t('convertQueued', { position: job.queuePosition || 1 })}</Text>
        )}
        {running && (
          <div>
            {/* Without a known length there is no percentage, only that it is moving. */}
            <Progress percent={known ? Math.floor(job.percent * 10) / 10 : 100} status="active" showInfo={known} strokeColor={known ? undefined : '#bfbfbf'} />
            <Text type="secondary" style={{ fontSize: 12 }}>{stats || t('convertStarting')}</Text>
          </div>
        )}
        {job.status === 'failed' && <Alert type="error" showIcon message={t('convertFailed')} description={job.error} />}

        {job.status === 'done' && (
          <>
            <Preview job={job} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('convertDoneStats', {
                before: formatBytes(job.inputBytes),
                after: formatBytes(job.outputBytes),
                percent: ratio == null ? '—' : `${Math.round(ratio * 100)}%`,
                time: formatClock((new Date(job.finishedAt) - new Date(job.startedAt)) / 1000),
              })}
            </Text>
          </>
        )}
      </Space>
    </Card>
  );
}

/** The upload that is creating a job: step one of four, with its own progress. */
function UploadCard({ upload, onCancel }) {
  const { t } = useLanguage();
  return (
    <Card size="small">
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
          <Space>
            <Text strong>{upload.fileName}</Text>
            <Tag color="processing" icon={<LoadingOutlined />}>{t('uploading')}</Tag>
          </Space>
          <Button size="small" danger icon={<CloseOutlined />} onClick={onCancel}>{t('convertCancel')}</Button>
        </Space>
        <JobSteps status="upload" />
        <div>
          <Progress percent={Math.floor(upload.percent)} status="active" />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {`${formatBytes((upload.bytes * upload.percent) / 100)} / ${formatBytes(upload.bytes)}`}
          </Text>
        </div>
      </Space>
    </Card>
  );
}

/** Conversions of one kind, newest first, with the upload in flight on top. */
export default function ConvertJobList({ area, keepMinutes }) {
  const { t } = useLanguage();
  const { jobs, upload } = area;
  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {upload && <UploadCard upload={upload} onCancel={area.cancelUpload} />}
      {jobs.map((job) => <JobCard key={job.id} job={job} onCancel={area.cancel} onRemove={area.remove} />)}
      {!upload && !jobs.length && <Empty description={t('convertNoJobs')} />}
      {(upload || jobs.length > 0) && keepMinutes ? (
        <Text type="secondary" style={{ fontSize: 12 }}>{t('convertKeptFor', { minutes: keepMinutes })}</Text>
      ) : null}
    </Space>
  );
}
