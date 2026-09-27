import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, DatePicker, Empty, Popconfirm, Select, Space, Table, Tag, Tooltip, Typography, message,
} from 'antd';
import {
  DeleteOutlined, DownloadOutlined, LeftOutlined, PlayCircleOutlined, ReloadOutlined, RightOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../api';
import { can } from '../../permissions';
import { useLanguage } from '../../i18n';

const { Text } = Typography;

const formatBytes = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB`
  : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);

const formatDuration = (seconds) => {
  const total = Math.max(0, Math.round(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
};

/** A short-lived URL for one segment: <video src> cannot send the sign-in header. */
const linkFor = async (recording, download = false) => {
  const { data } = await api.post(`/cameras/recordings/${recording.id}/link`);
  return `${api.defaults.baseURL.replace(/\/$/, '')}${data.path}${download ? '?download=1' : ''}`;
};

/**
 * Recorded footage: pick a camera and a time range, play a segment (the next
 * one of the same camera follows on by itself), download or delete it.
 * `cameraId` fixes the camera (the single-camera view); otherwise every
 * camera the account can see is offered, plus footage of deleted cameras.
 */
export default function RecordingsBrowser({ cameras = [], cameraId: fixedCamera = '', user, compact = false }) {
  const { t } = useLanguage();
  const [cameraId, setCameraId] = useState(fixedCamera);
  const [range, setRange] = useState(null);
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(null); // { recording, url }

  const nameOf = useCallback((id) => cameras.find((camera) => camera.id === id)?.name || t('recDeletedCamera'), [cameras, t]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        ...(cameraId ? { cameraId } : {}),
        ...(range?.[0] ? { from: range[0].startOf('day').toISOString() } : {}),
        ...(range?.[1] ? { to: range[1].endOf('day').toISOString() } : {}),
        ...(compact ? { limit: 50 } : {}),
      };
      const { data } = await api.get('/cameras/recordings', { params });
      setRecordings(data.recordings || []);
    } catch (error) {
      message.error(error.response?.data?.message || t('recLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [cameraId, range, compact, t]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setCameraId(fixedCamera); }, [fixedCamera]);

  const play = async (recording) => {
    try {
      setPlaying({ recording, url: await linkFor(recording) });
    } catch (error) {
      message.error(error.response?.data?.message || t('recLoadFailed'));
    }
  };

  const download = async (recording) => {
    try {
      const link = document.createElement('a');
      link.href = await linkFor(recording, true);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      message.error(error.response?.data?.message || t('recLoadFailed'));
    }
  };

  const remove = async (recording) => {
    try {
      await api.delete(`/cameras/recordings/${recording.id}`);
      if (playing?.recording.id === recording.id) setPlaying(null);
      setRecordings((current) => current.filter((item) => item.id !== recording.id));
    } catch (error) {
      message.error(error.response?.data?.message || t('recDeleteFailed'));
    }
  };

  // The same camera's segments, oldest first, for previous / next.
  const sameCamera = useMemo(() => (playing
    ? recordings.filter((item) => item.cameraId === playing.recording.cameraId)
      .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt))
    : []), [playing, recordings]);
  const position = playing ? sameCamera.findIndex((item) => item.id === playing.recording.id) : -1;
  const previous = position > 0 ? sameCamera[position - 1] : null;
  const next = position >= 0 && position < sameCamera.length - 1 ? sameCamera[position + 1] : null;

  const canDelete = can(user, 'cameras', 'delete');

  const columns = [
    ...(fixedCamera ? [] : [{ title: t('recCamera'), key: 'camera', render: (_, row) => nameOf(row.cameraId) }]),
    {
      title: t('recStartedAt'),
      key: 'start',
      render: (_, row) => (
        <Space size={6}>
          {dayjs(row.startedAt).format('YYYY-MM-DD HH:mm:ss')}
          {row.recording && <Tag color="red">● {t('recRecording')}</Tag>}
        </Space>
      ),
    },
    { title: t('recLength'), key: 'length', render: (_, row) => formatDuration(row.seconds) },
    { title: t('recSize'), key: 'size', render: (_, row) => formatBytes(row.bytes) },
    {
      title: '',
      key: 'actions',
      render: (_, row) => (
        <Space size={4}>
          <Button
            size="small"
            type={playing?.recording.id === row.id ? 'primary' : 'default'}
            icon={<PlayCircleOutlined />}
            onClick={() => play(row)}
          >
            {t('recPlay')}
          </Button>
          <Tooltip title={t('recDownload')}>
            <Button size="small" icon={<DownloadOutlined />} onClick={() => download(row)} />
          </Tooltip>
          {canDelete && (
            <Popconfirm title={t('recDeleteQuestion')} onConfirm={() => remove(row)} okButtonProps={{ danger: true }} disabled={row.recording}>
              <Tooltip title={row.recording ? t('recStillRecording') : t('recDelete')}>
                <Button size="small" danger icon={<DeleteOutlined />} disabled={row.recording} />
              </Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space wrap>
        {!fixedCamera && (
          <Select
            showSearch
            optionFilterProp="label"
            className="vision-filter-select"
            style={{ minWidth: 220 }}
            value={cameraId}
            onChange={setCameraId}
            options={[
              { value: '', label: t('recAllCameras') },
              ...cameras.map((camera) => ({ value: camera.id, label: camera.name })),
            ]}
          />
        )}
        <DatePicker.RangePicker value={range} onChange={setRange} allowEmpty={[true, true]} />
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>{t('refresh')}</Button>
      </Space>

      {playing && (
        <div className="camera-recording-player">
          <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
            <Text strong>
              {`${nameOf(playing.recording.cameraId)} · ${dayjs(playing.recording.startedAt).format('YYYY-MM-DD HH:mm:ss')}`}
            </Text>
            <Space>
              <Button size="small" icon={<LeftOutlined />} disabled={!previous} onClick={() => play(previous)}>{t('recEarlier')}</Button>
              <Button size="small" disabled={!next} onClick={() => play(next)}>{t('recLater')} <RightOutlined /></Button>
              <Button size="small" onClick={() => setPlaying(null)}>{t('close')}</Button>
            </Space>
          </Space>
          {/* The next segment follows on, so an hour plays as an hour. */}
          <video
            key={playing.url}
            src={playing.url}
            controls
            autoPlay
            playsInline
            onEnded={() => { if (next) play(next); }}
          />
        </div>
      )}

      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={recordings}
        pagination={compact ? { pageSize: 8 } : { pageSize: 20, showSizeChanger: false }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('recNone')} /> }}
        scroll={{ x: 'max-content' }}
      />
    </Space>
  );
}
