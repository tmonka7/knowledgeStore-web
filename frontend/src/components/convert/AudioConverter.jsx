import { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, Divider, InputNumber, Row, Select, Slider, Space, Switch, Typography,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import ConvertJobList from './ConvertJobList';
import SourcePicker, { TrimFields } from './SourcePicker';
import useConvertJobs from './useConvertJobs';
import useStoredSettings from './useStoredSettings';
import {
  AUDIO_BITRATES, ChannelSelect, Field, SampleRateSelect,
} from './VideoConverter';
import { formatBytes } from './format';
import { useLanguage } from '../../i18n';

const { Text } = Typography;

const DEFAULTS = {
  format: 'mp3',
  bitrate: 192,
  bitDepth: 16,
  compression: 5,
  sampleRate: '',
  channels: '',
  volume: 0,
  normalize: false,
  fadeIn: 0,
  fadeOut: 0,
};

/** Audio tab: convert audio, or take the sound out of a video, on the server. */
export default function AudioConverter({ caps }) {
  const { t } = useLanguage();
  const area = useConvertJobs('audio', t);
  const [file, setFile] = useState(null);
  const [meta, setMeta] = useState(null);
  const [trim, setTrim] = useState({ start: 0, end: null });
  const [settings, set, reset] = useStoredSettings('convert-audio-settings', DEFAULTS);

  const formats = caps?.available ? caps.audio.formats : [];
  const format = formats.find((item) => item.value === settings.format) || formats[0] || null;

  useEffect(() => {
    if (!format) return;
    const patch = {};
    if (format.value !== settings.format) patch.format = format.value;
    if (format.bitDepths && !format.bitDepths.includes(Number(settings.bitDepth))) patch.bitDepth = format.bitDepths[0];
    if (Object.keys(patch).length) set(patch);
  }, [format, settings.format, settings.bitDepth]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseFile = (chosen, info) => {
    if (chosen !== file) setTrim({ start: 0, end: null });
    setFile(chosen);
    setMeta(info);
  };

  const convert = () => area.start(file, { ...settings, start: trim.start, end: trim.end });

  if (caps && !caps.available) {
    return <Alert type="warning" showIcon message={t('videoConversionUnavailable')} description={caps.message} />;
  }

  const length = ((trim.end ?? meta?.duration) ?? NaN) - (trim.start || 0);
  const estimate = format?.bitrate && Number.isFinite(length) ? (settings.bitrate * 1000 * length) / 8 : null;
  const tooBig = file && caps?.maxUploadMb && file.size > caps.maxUploadMb * 1024 * 1024;

  return (
    <Row gutter={[16, 16]}>
      <Col span={24} lg={11}>
        <Card title={t('convertSourceAudio')} bordered={false}>
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <SourcePicker kind="audio" file={file} meta={meta} onChange={chooseFile} maxUploadMb={caps?.maxUploadMb} />
            <Text type="secondary" style={{ fontSize: 12 }}>{t('convertAudioFromVideo')}</Text>

            <Divider orientation="left" plain style={{ margin: '4px 0' }}>{t('convertOutput')}</Divider>
            <Row gutter={[12, 12]}>
              <Field label={t('convertFormat')}>
                <Select
                  style={{ width: '100%' }}
                  value={format?.value}
                  onChange={(value) => set({ format: value })}
                  options={formats.map(({ value, label }) => ({ value, label }))}
                  loading={!caps}
                />
              </Field>
              {format?.bitrate ? (
                <Field label={t('convertAudioBitrate')}>
                  <Select
                    style={{ width: '100%' }}
                    value={settings.bitrate}
                    onChange={(bitrate) => set({ bitrate })}
                    options={AUDIO_BITRATES.map((rate) => ({ value: rate, label: `${rate} kb/s` }))}
                  />
                </Field>
              ) : (
                <Field label={t('convertBitDepth')}>
                  <Select
                    style={{ width: '100%' }}
                    value={Number(settings.bitDepth)}
                    onChange={(bitDepth) => set({ bitDepth })}
                    options={(format?.bitDepths || []).map((depth) => ({
                      value: depth,
                      label: depth === 32 ? t('convertFloat32') : `${depth}-bit`,
                    }))}
                  />
                </Field>
              )}
              <Field label={t('convertSampleRate')}>
                <SampleRateSelect rates={format?.sampleRates} value={settings.sampleRate} onChange={(sampleRate) => set({ sampleRate })} />
              </Field>
              <Field label={t('convertChannels')}>
                <ChannelSelect value={settings.channels} onChange={(channels) => set({ channels })} />
              </Field>
              {format?.compression && (
                <Field label={t('convertCompression', { value: settings.compression })} span={24}>
                  <Slider
                    min={format.compression.min}
                    max={format.compression.max}
                    value={settings.compression}
                    onChange={(compression) => set({ compression })}
                    marks={{ [format.compression.min]: t('convertFaster'), [format.compression.max]: t('convertSmaller') }}
                  />
                </Field>
              )}
              {estimate != null && (
                <Col span={24}><Text type="secondary">{t('convertEstimate', { size: formatBytes(estimate) })}</Text></Col>
              )}
            </Row>

            <Divider orientation="left" plain style={{ margin: '4px 0' }}>{t('convertLevels')}</Divider>
            <Row gutter={[12, 12]}>
              <Field label={t('convertVolume', { value: `${settings.volume > 0 ? '+' : ''}${settings.volume || 0} dB` })} span={24}>
                <Slider min={-20} max={20} value={settings.volume || 0} onChange={(volume) => set({ volume })} marks={{ 0: '0' }} />
              </Field>
              <Col span={24}>
                <Space>
                  <Switch size="small" checked={settings.normalize} onChange={(normalize) => set({ normalize })} />
                  <Text>{t('convertNormalize')}</Text>
                </Space>
              </Col>
              <Field label={t('convertFadeIn')}>
                <InputNumber style={{ width: '100%' }} min={0} max={60} step={0.5} value={settings.fadeIn} onChange={(fadeIn) => set({ fadeIn: fadeIn || 0 })} addonAfter="s" />
              </Field>
              <Field label={t('convertFadeOut')}>
                <InputNumber style={{ width: '100%' }} min={0} max={60} step={0.5} value={settings.fadeOut} onChange={(fadeOut) => set({ fadeOut: fadeOut || 0 })} addonAfter="s" />
              </Field>
            </Row>

            <Divider orientation="left" plain style={{ margin: '4px 0' }}>{t('convertTrim')}</Divider>
            <TrimFields duration={meta?.duration} start={trim.start} end={trim.end} onChange={setTrim} />

            <Button
              type="primary"
              className="vision-btn-primary"
              size="large"
              block
              onClick={convert}
              disabled={!file || tooBig || !caps || Boolean(area.upload)}
              loading={Boolean(area.upload)}
            >
              {t('convertAudio')}
            </Button>
            <Button type="link" size="small" icon={<ReloadOutlined />} onClick={reset} style={{ padding: 0 }}>
              {t('convertResetSettings')}
            </Button>
          </Space>
        </Card>
      </Col>

      <Col span={24} lg={13}>
        <Card title={t('convertConversions')} bordered={false}>
          <ConvertJobList area={area} keepMinutes={caps?.keepMinutes} />
        </Card>
      </Col>
    </Row>
  );
}
