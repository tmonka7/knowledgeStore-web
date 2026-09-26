import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Checkbox, Col, Divider, InputNumber, Radio, Row, Segmented, Select, Slider, Space, Switch,
  Typography,
} from 'antd';
import { ReloadOutlined, SwapOutlined } from '@ant-design/icons';
import ConvertJobList from './ConvertJobList';
import SourcePicker, { TrimFields } from './SourcePicker';
import useConvertJobs from './useConvertJobs';
import useStoredSettings from './useStoredSettings';
import { formatBytes } from './format';
import { useLanguage } from '../../i18n';

const { Text } = Typography;

const FRAME_RATES = [60, 50, 30, 25, 24, 15, 12, 10, 5];
export const AUDIO_BITRATES = [32, 48, 64, 96, 128, 160, 192, 256, 320];

const DEFAULTS = {
  format: 'mp4',
  videoCodec: 'h264',
  rateMode: 'crf',
  crf: 23,
  videoBitrate: 4000,
  speed: 'medium',
  resolution: 'original',
  width: null,
  height: null,
  fps: '',
  rotate: 0,
  flipH: false,
  flipV: false,
  removeAudio: false,
  audioCodec: 'aac',
  audioBitrate: 192,
  sampleRate: '',
  channels: '',
  volume: 0,
};

/** A labelled control in the settings grid. */
export function Field({ label, children, span = 12 }) {
  return (
    <Col xs={24} sm={span}>
      <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>{label}</Text>
      {children}
    </Col>
  );
}

/** Video tab: upload to the server, which converts with ffmpeg as a job. */
export default function VideoConverter({ caps }) {
  const { t } = useLanguage();
  const area = useConvertJobs('video', t);
  const [file, setFile] = useState(null);
  const [meta, setMeta] = useState(null);
  const [trim, setTrim] = useState({ start: 0, end: null });
  const [settings, set, reset] = useStoredSettings('convert-video-settings', DEFAULTS);

  const video = caps?.available ? caps.video : null;
  const format = video?.formats.find((item) => item.value === settings.format) || video?.formats[0] || null;
  const codecs = useMemo(() => Object.fromEntries((video?.codecs || []).map((codec) => [codec.id, codec])), [video]);
  const audioCodecs = useMemo(() => Object.fromEntries((video?.audioCodecs || []).map((codec) => [codec.id, codec])), [video]);
  const codec = codecs[settings.videoCodec] || null;
  const audioCodec = audioCodecs[settings.audioCodec] || null;
  const isGif = format?.value === 'gif';
  const hasAudio = Boolean(format?.audioCodecs.length) && !settings.removeAudio;

  // A container limits its codecs: keep the choice valid when either changes.
  useEffect(() => {
    if (!format) return;
    const patch = {};
    if (format.value !== settings.format) patch.format = format.value;
    if (!format.videoCodecs.includes(settings.videoCodec)) {
      const next = codecs[format.videoCodecs[0]];
      Object.assign(patch, { videoCodec: next.id, crf: next.crf?.default ?? null, videoBitrate: next.bitrate || settings.videoBitrate });
    }
    if (format.audioCodecs.length && !format.audioCodecs.includes(settings.audioCodec)) {
      patch.audioCodec = format.audioCodecs[0];
    }
    if (Object.keys(patch).length) set(patch);
  }, [format, settings.format, settings.videoCodec, settings.audioCodec]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseFile = (chosen, info) => {
    if (chosen !== file) setTrim({ start: 0, end: null });
    setFile(chosen);
    setMeta(info);
  };

  const convert = () => area.start(file, { ...settings, start: trim.start, end: trim.end });

  const length = ((trim.end ?? meta?.duration) ?? NaN) - (trim.start || 0);
  const estimate = settings.rateMode === 'bitrate' && !isGif && Number.isFinite(length)
    ? ((settings.videoBitrate + (hasAudio && audioCodec?.bitrate ? settings.audioBitrate : 0)) * 1000 * length) / 8
    : null;
  const tooBig = file && caps?.maxUploadMb && file.size > caps.maxUploadMb * 1024 * 1024;

  if (caps && !caps.available) {
    return <Alert type="warning" showIcon message={t('videoConversionUnavailable')} description={caps.message} />;
  }

  const resolutionOptions = [
    { value: 'original', label: meta?.width ? t('convertOriginalSize', { size: `${meta.width}×${meta.height}` }) : t('convertOriginal') },
    ...(caps?.resolutions || []).map((height) => ({ value: String(height), label: `${height}p` })),
    { value: 'custom', label: t('convertCustom') },
  ];

  return (
    <Row gutter={[16, 16]}>
      <Col span={24} lg={11}>
        <Card title={t('sourceVideo')} bordered={false}>
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <SourcePicker kind="video" file={file} meta={meta} onChange={chooseFile} maxUploadMb={caps?.maxUploadMb} />

            <Divider orientation="left" plain style={{ margin: '4px 0' }}>{t('convertOutput')}</Divider>
            <Row gutter={[12, 12]}>
              <Field label={t('convertFormat')}>
                <Select
                  style={{ width: '100%' }}
                  value={format?.value}
                  onChange={(value) => set({ format: value })}
                  options={(video?.formats || []).map(({ value, label }) => ({ value, label }))}
                  loading={!caps}
                />
              </Field>
              <Field label={t('convertVideoCodec')}>
                <Select
                  style={{ width: '100%' }}
                  value={codec?.id}
                  disabled={isGif}
                  onChange={(value) => set({ videoCodec: value, crf: codecs[value].crf?.default ?? null, videoBitrate: codecs[value].bitrate || settings.videoBitrate })}
                  options={(format?.videoCodecs || []).map((id) => ({ value: id, label: codecs[id]?.label || id }))}
                />
              </Field>
              <Field label={t('convertResolution')}>
                <Select
                  style={{ width: '100%' }}
                  value={settings.resolution}
                  onChange={(value) => set({ resolution: value })}
                  options={resolutionOptions}
                />
              </Field>
              <Field label={t('convertFrameRate')}>
                <Select
                  style={{ width: '100%' }}
                  value={settings.fps === '' || settings.fps == null ? '' : Number(settings.fps)}
                  onChange={(value) => set({ fps: value })}
                  options={[
                    { value: '', label: isGif ? t('convertGifDefaultFps') : t('convertOriginal') },
                    ...FRAME_RATES.map((rate) => ({ value: rate, label: `${rate} fps` })),
                  ]}
                />
              </Field>
              {settings.resolution === 'custom' && (
                <Col span={24}>
                  <Space wrap>
                    <InputNumber addonBefore="W" min={16} max={7680} value={settings.width} placeholder={t('convertAuto')} onChange={(width) => set({ width })} />
                    <InputNumber addonBefore="H" min={16} max={4320} value={settings.height} placeholder={t('convertAuto')} onChange={(height) => set({ height })} />
                    <Text type="secondary">{t('convertCustomHelp')}</Text>
                  </Space>
                </Col>
              )}
              {isGif && <Col span={24}><Alert type="info" showIcon message={t('convertGifHelp')} /></Col>}

              {!isGif && codec?.crf && (
                <Col span={24}>
                  <Radio.Group
                    value={settings.rateMode}
                    onChange={(event) => set({ rateMode: event.target.value })}
                    optionType="button"
                    size="small"
                    options={[
                      { value: 'crf', label: t('convertConstantQuality') },
                      { value: 'bitrate', label: t('convertTargetBitrate') },
                    ]}
                  />
                  {settings.rateMode === 'bitrate' ? (
                    <Space style={{ marginTop: 8 }} wrap>
                      <InputNumber
                        min={100}
                        max={100000}
                        step={100}
                        value={settings.videoBitrate}
                        onChange={(videoBitrate) => set({ videoBitrate: videoBitrate || codec.bitrate })}
                        addonAfter="kb/s"
                      />
                      {estimate != null && <Text type="secondary">{t('convertEstimate', { size: formatBytes(estimate) })}</Text>}
                    </Space>
                  ) : (
                    <div style={{ marginTop: 4 }}>
                      <Slider
                        min={codec.crf.min}
                        max={codec.crf.max}
                        value={settings.crf ?? codec.crf.default}
                        onChange={(crf) => set({ crf })}
                        marks={{
                          [codec.crf.min]: t('convertBetter'),
                          [codec.crf.default]: String(codec.crf.default),
                          [codec.crf.max]: t('convertSmaller'),
                        }}
                      />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {t('convertCrfHelp', { value: settings.crf ?? codec.crf.default })}
                      </Text>
                    </div>
                  )}
                </Col>
              )}
              {!isGif && codec?.speeds && (
                <Field label={t('convertSpeed')} span={24}>
                  <Segmented
                    block
                    value={settings.speed}
                    onChange={(speed) => set({ speed })}
                    options={(caps?.speeds || []).map((speed) => ({ value: speed, label: t(`convertSpeed_${speed}`) }))}
                  />
                </Field>
              )}
              <Field label={t('convertRotate')}>
                <Select
                  style={{ width: '100%' }}
                  value={Number(settings.rotate) || 0}
                  onChange={(rotate) => set({ rotate })}
                  options={[0, 90, 180, 270].map((degrees) => ({ value: degrees, label: degrees ? `${degrees}°` : t('convertNone') }))}
                />
              </Field>
              <Field label={t('convertFlip')}>
                <Space style={{ height: 32 }}>
                  <Checkbox checked={settings.flipH} onChange={(event) => set({ flipH: event.target.checked })}>
                    <SwapOutlined /> {t('convertFlipH')}
                  </Checkbox>
                  <Checkbox checked={settings.flipV} onChange={(event) => set({ flipV: event.target.checked })}>
                    <SwapOutlined rotate={90} /> {t('convertFlipV')}
                  </Checkbox>
                </Space>
              </Field>
            </Row>

            {format?.audioCodecs.length > 0 && (
              <>
                <Divider orientation="left" plain style={{ margin: '4px 0' }}>
                  <Space>
                    {t('convertSound')}
                    <Switch size="small" checked={!settings.removeAudio} onChange={(on) => set({ removeAudio: !on })} />
                  </Space>
                </Divider>
                {hasAudio && <AudioFields settings={settings} set={set} codecIds={format.audioCodecs} codecs={audioCodecs} />}
              </>
            )}

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
              {t('convertVideo')}
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

/** Codec, bitrate, channels, sample rate and volume — the sound of a video. */
function AudioFields({ settings, set, codecIds, codecs }) {
  const { t } = useLanguage();
  const codec = codecs[settings.audioCodec];
  return (
    <Row gutter={[12, 12]}>
      <Field label={t('convertAudioCodec')}>
        <Select
          style={{ width: '100%' }}
          value={codec?.id}
          onChange={(audioCodec) => set({ audioCodec, sampleRate: '' })}
          options={codecIds.map((id) => ({ value: id, label: codecs[id]?.label || id }))}
        />
      </Field>
      <Field label={t('convertAudioBitrate')}>
        <Select
          style={{ width: '100%' }}
          value={codec?.bitrate ? settings.audioBitrate : 'lossless'}
          disabled={!codec?.bitrate}
          onChange={(audioBitrate) => set({ audioBitrate })}
          options={codec?.bitrate
            ? AUDIO_BITRATES.map((rate) => ({ value: rate, label: `${rate} kb/s` }))
            : [{ value: 'lossless', label: t('convertLossless') }]}
        />
      </Field>
      <Field label={t('convertChannels')}>
        <ChannelSelect value={settings.channels} onChange={(channels) => set({ channels })} />
      </Field>
      <Field label={t('convertSampleRate')}>
        <SampleRateSelect rates={codec?.sampleRates} value={settings.sampleRate} onChange={(sampleRate) => set({ sampleRate })} />
      </Field>
      <Field label={t('convertVolume', { value: `${settings.volume > 0 ? '+' : ''}${settings.volume || 0} dB` })} span={24}>
        <Slider min={-20} max={20} value={settings.volume || 0} onChange={(volume) => set({ volume })} marks={{ 0: '0' }} />
      </Field>
    </Row>
  );
}

export function ChannelSelect({ value, onChange }) {
  const { t } = useLanguage();
  return (
    <Select
      style={{ width: '100%' }}
      value={value || ''}
      onChange={onChange}
      options={[
        { value: '', label: t('convertOriginal') },
        { value: '1', label: t('convertMono') },
        { value: '2', label: t('convertStereo') },
      ]}
    />
  );
}

export function SampleRateSelect({ rates = [], value, onChange }) {
  const { t } = useLanguage();
  // A rate the new codec cannot take goes back to "original".
  const current = rates.includes(Number(value)) ? Number(value) : '';
  return (
    <Select
      style={{ width: '100%' }}
      value={current}
      onChange={onChange}
      options={[
        { value: '', label: t('convertOriginal') },
        ...rates.map((rate) => ({ value: rate, label: `${(rate / 1000).toLocaleString()} kHz` })),
      ]}
    />
  );
}
