import { useEffect, useState } from 'react';
import { Alert, InputNumber, Slider, Space, Typography } from 'antd';
import { SoundOutlined, VideoCameraAddOutlined } from '@ant-design/icons';
import { formatBytes, formatClock } from './format';
import { useLanguage } from '../../i18n';

const { Text } = Typography;

/**
 * Choose the file to convert, and play it. The browser's player also gives the
 * length and picture size used for trimming and sizing — when it can decode
 * the file; ffmpeg reads far more formats, so a file the browser cannot play
 * is still accepted, just without those hints.
 *
 * `onChange(file, meta)`; meta is { duration, width, height } or null.
 */
export default function SourcePicker({ kind, file, meta, onChange, maxUploadMb }) {
  const { t } = useLanguage();
  const [url, setUrl] = useState('');
  const [unplayable, setUnplayable] = useState(false);

  useEffect(() => {
    setUnplayable(false);
    if (!file) {
      setUrl('');
      return undefined;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const tooBig = file && maxUploadMb && file.size > maxUploadMb * 1024 * 1024;
  const inputId = `convert-${kind}-upload`;
  const Player = kind === 'audio' && !file?.type.startsWith('video/') ? 'audio' : 'video';

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={8}>
      <label className="mail-file-picker" htmlFor={inputId} style={{ width: '100%' }}>
        {kind === 'video' ? <VideoCameraAddOutlined /> : <SoundOutlined />}
        <span>{file ? `${file.name} (${formatBytes(file.size)})` : t(kind === 'video' ? 'selectVideoFile' : 'convertSelectAudioFile')}</span>
      </label>
      <input
        id={inputId}
        type="file"
        // Audio can also be taken out of a video.
        accept={kind === 'video' ? 'video/*,.mkv,.avi,.mov,.flv,.wmv,.ts,.m2ts' : 'audio/*,video/*,.flac,.opus,.m4a,.wma,.aac'}
        className="mail-file-input"
        onChange={(event) => {
          const chosen = event.target.files?.[0] || null;
          event.target.value = '';
          if (chosen) onChange(chosen, null);
        }}
      />
      {tooBig && <Alert type="error" showIcon message={t('convertTooBig', { size: maxUploadMb })} />}

      {url && !unplayable && (
        <Player
          key={url}
          src={url}
          controls
          preload="metadata"
          style={Player === 'video' ? { width: '100%', maxHeight: 260, background: '#000' } : { width: '100%' }}
          onLoadedMetadata={(event) => {
            const element = event.currentTarget;
            onChange(file, {
              duration: Number.isFinite(element.duration) ? element.duration : null,
              width: element.videoWidth || null,
              height: element.videoHeight || null,
            });
          }}
          onError={() => setUnplayable(true)}
        />
      )}
      {unplayable && <Text type="secondary">{t('convertNoPreview')}</Text>}
      {meta && (
        <Text type="secondary">
          {[
            meta.duration ? formatClock(meta.duration) : null,
            meta.width ? `${meta.width}×${meta.height}` : null,
          ].filter(Boolean).join(' · ')}
        </Text>
      )}
    </Space>
  );
}

/**
 * Start and end in seconds. With the length known it is a range slider plus
 * exact boxes; without, just the boxes (blank end = to the end).
 */
export function TrimFields({ duration, start, end, onChange }) {
  const { t } = useLanguage();
  const top = duration ? Math.round(duration * 10) / 10 : null;
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={4}>
      {top ? (
        <Slider
          range
          min={0}
          max={top}
          step={0.1}
          value={[start || 0, end ?? top]}
          tooltip={{ formatter: formatClock }}
          onChange={([from, to]) => onChange({ start: from, end: to >= top ? null : to })}
        />
      ) : null}
      <Space wrap>
        <InputNumber
          addonBefore={t('convertStart')}
          addonAfter="s"
          min={0}
          max={top || undefined}
          step={0.1}
          value={start || 0}
          onChange={(value) => onChange({ start: value || 0, end })}
          style={{ width: 170 }}
        />
        <InputNumber
          addonBefore={t('convertEnd')}
          addonAfter="s"
          min={0}
          max={top || undefined}
          step={0.1}
          value={end}
          placeholder={t('convertToEnd')}
          onChange={(value) => onChange({ start, end: value ?? null })}
          style={{ width: 170 }}
        />
        <Text type="secondary">
          {t('convertOutputLength', {
            time: formatClock(((end ?? duration) ?? NaN) - (start || 0)),
          })}
        </Text>
      </Space>
    </Space>
  );
}
