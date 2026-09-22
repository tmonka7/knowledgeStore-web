import { useEffect, useRef, useState } from 'react';
import {
  Alert, Button, Card, Col, ColorPicker, InputNumber, Progress, Row, Select, Slider, Space, Tabs, Typography, message,
} from 'antd';
import { DownloadOutlined, FileImageOutlined, SwapOutlined, VideoCameraAddOutlined } from '@ant-design/icons';
import api from '../api';
import { IMAGE_FORMATS, convertImage, loadImageFile } from '../lib/imageConvert';
import { useLanguage } from '../i18n';

const { Text } = Typography;

const formatBytes = (bytes) => {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
};

const downloadBlob = (filename, blob) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const baseName = (name = '') => name.replace(/\.[^.]+$/, '') || 'converted';

/** Image tab — runs in the browser, see lib/imageConvert.js. */
function ImageConverter() {
  const { t } = useLanguage();
  const [source, setSource] = useState(null); // { image, url, width, height, name }
  const [format, setFormat] = useState('png');
  const [width, setWidth] = useState(null);
  const [height, setHeight] = useState(null);
  const [lockRatio, setLockRatio] = useState(true);
  const [quality, setQuality] = useState(92);
  const [background, setBackground] = useState('#ffffff');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const currentUrl = useRef(null);

  useEffect(() => () => {
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
  }, []);

  const pickFile = async (file) => {
    if (!file) return;
    setError('');
    setResult(null);

    try {
      const loaded = await loadImageFile(file);
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
      currentUrl.current = loaded.url;

      setSource({ ...loaded, name: file.name });
      setWidth(loaded.width);
      setHeight(loaded.height);
    } catch (caught) {
      setError(caught.message);
    }
  };

  // Ratio locking is one-directional per edit, so typing in either box works.
  const changeWidth = (value) => {
    setWidth(value);
    if (lockRatio && source && value) {
      setHeight(Math.max(1, Math.round(value * (source.height / source.width))));
    }
  };

  const changeHeight = (value) => {
    setHeight(value);
    if (lockRatio && source && value) {
      setWidth(Math.max(1, Math.round(value * (source.width / source.height))));
    }
  };

  const run = async () => {
    if (!source) {
      setError(t('chooseImageFirst'));
      return;
    }

    setBusy(true);
    setError('');
    try {
      const chosen = IMAGE_FORMATS.find((option) => option.value === format);
      const blob = await convertImage({
        image: source.image,
        // Present only for SVG. With it, the output is drawn from the vector at
        // the requested size instead of being scaled up from the preview, so
        // enlarging an icon gains detail rather than blur.
        renderAt: source.renderAt,
        format,
        width: width || source.width,
        height: height || source.height,
        quality: quality / 100,
        // PNG and GIF keep transparency; only JPG is always flattened.
        background: format === 'jpg' ? background : null,
      });

      setResult({ blob, filename: `${baseName(source.name)}.${chosen.extension}`, size: blob.size });
      message.success(t('convertedToFormat', { format: chosen.label }));
    } catch (caught) {
      setError(caught?.message || 'That image could not be converted.');
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const selected = IMAGE_FORMATS.find((option) => option.value === format);

  return (
    <Row gutter={[16, 16]}>
      <Col span={24} lg={10}>
        <Card title={t('sourceImage')} bordered={false}>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <label className="mail-file-picker" htmlFor="convert-image-upload" style={{ width: '100%' }}>
              <FileImageOutlined />
              <span>{source ? source.name : t('selectImageFile')}</span>
            </label>
            <input
              id="convert-image-upload"
              type="file"
              accept="image/*"
              className="mail-file-input"
              onChange={(event) => pickFile(event.target.files?.[0])}
            />

            <Select
              value={format}
              onChange={setFormat}
              style={{ width: '100%' }}
              options={IMAGE_FORMATS.map(({ value, label }) => ({ value, label }))}
            />
            {selected && <Text type="secondary">{selected.hint}</Text>}

            {format !== 'ico' && (
              <Space>
                <InputNumber min={1} max={8192} value={width} onChange={changeWidth} addonBefore="W" disabled={!source} />
                <InputNumber min={1} max={8192} value={height} onChange={changeHeight} addonBefore="H" disabled={!source} />
                <Button
                  type={lockRatio ? 'primary' : 'default'}
                  icon={<SwapOutlined />}
                  onClick={() => setLockRatio(!lockRatio)}
                  title={t('lockAspectRatio')}
                />
              </Space>
            )}

            {format === 'ico' && (
              <InputNumber
                min={16}
                max={256}
                value={Math.min(width || 256, 256)}
                onChange={changeWidth}
                addonBefore="Max size"
                addonAfter="px"
                style={{ width: '100%' }}
                disabled={!source}
              />
            )}

            {format === 'jpg' && (
              <>
                <div>
                  <Text type="secondary">{t('qualityPercent', { percent: quality })}</Text>
                  <Slider min={10} max={100} value={quality} onChange={setQuality} />
                </div>
                <Space>
                  <Text type="secondary">{t('background')}</Text>
                  <ColorPicker
                    value={background}
                    onChange={(value) => setBackground(value.toHexString())}
                    showText
                  />
                </Space>
              </>
            )}

            <Button type="primary" className="vision-btn-primary" onClick={run} loading={busy} disabled={!source} block>
              {t('convertImage')}
            </Button>

            {error && <Alert type="error" showIcon message={error} />}
          </Space>
        </Card>
      </Col>

      <Col span={24} lg={14}>
        <Card
          title={t('result')}
          bordered={false}
          extra={result && (
            <Space>
              <Text type="secondary">{formatBytes(result.size)}</Text>
              <Button
                type="primary"
                className="vision-btn-primary"
                icon={<DownloadOutlined />}
                onClick={() => downloadBlob(result.filename, result.blob)}
              >
                {t('download')}
              </Button>
            </Space>
          )}
        >
          {source ? (
            <>
              <img src={source.url} alt={t('sourcePreview')} className="convert-preview" />
              <Text type="secondary">
                {t('sourceDimensions', { width: source.width, height: source.height, name: source.name })}
              </Text>
              {/* An SVG has no true size, so the figures above are only where
                  the output starts. Saying so is what stops the width box from
                  looking like a limit it is not. */}
              {source.vector && (
                <>
                  <br />
                  <Text type="secondary">{t('vectorSourceNote')}</Text>
                </>
              )}
            </>
          ) : (
            <Alert type="info" showIcon message={t('uploadImageToConvert')} />
          )}
        </Card>
      </Col>
    </Row>
  );
}

/** Video tab — uploads to the API, which runs ffmpeg. */
function VideoConverter() {
  const { t } = useLanguage();
  const [file, setFile] = useState(null);
  const [format, setFormat] = useState('mp4');
  const [capabilities, setCapabilities] = useState(null);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.get('/tools/convert/capabilities')
      .then(({ data }) => { if (!cancelled) setCapabilities(data); })
      .catch(() => { if (!cancelled) setCapabilities({ video: false, formats: [], message: 'Could not reach the conversion API.' }); });
    return () => { cancelled = true; };
  }, []);

  const run = async () => {
    if (!file) {
      setError(t('chooseVideoFirst'));
      return;
    }

    setBusy(true);
    setError('');
    setUploadPercent(0);
    try {
      const form = new FormData();
      form.append('video', file);
      form.append('format', format);

      const response = await api.post('/tools/convert/video', form, {
        responseType: 'blob',
        onUploadProgress: (event) => {
          if (event.total) setUploadPercent(Math.round((event.loaded / event.total) * 100));
        },
      });

      const extension = format;
      downloadBlob(`${baseName(file.name)}.${extension}`, response.data);
      message.success(t('conversionFinished'));
    } catch (caught) {
      // responseType blob means an error body arrives as a Blob, not JSON.
      let text = 'That video could not be converted.';
      const payload = caught?.response?.data;
      if (payload instanceof Blob) {
        try {
          const parsed = JSON.parse(await payload.text());
          if (parsed?.message) text = parsed.message;
        } catch {
          // Leave the default message when the body is not JSON.
        }
      } else if (payload?.message) {
        text = payload.message;
      }
      setError(text);
    } finally {
      setBusy(false);
      setUploadPercent(0);
    }
  };

  const unavailable = capabilities && !capabilities.video;
  const formatOptions = capabilities?.formats?.length
    ? capabilities.formats
    : [{ value: 'mp4', label: 'MP4' }, { value: 'avi', label: 'AVI' }];

  return (
    <Row gutter={[16, 16]}>
      <Col span={24} lg={10}>
        <Card title={t('sourceVideo')} bordered={false}>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            {unavailable && (
              <Alert type="warning" showIcon message={t('videoConversionUnavailable')} description={capabilities.message} />
            )}

            <label className="mail-file-picker" htmlFor="convert-video-upload" style={{ width: '100%' }}>
              <VideoCameraAddOutlined />
              <span>{file ? `${file.name} (${formatBytes(file.size)})` : t('selectVideoFile')}</span>
            </label>
            <input
              id="convert-video-upload"
              type="file"
              accept="video/*"
              className="mail-file-input"
              onChange={(event) => {
                setFile(event.target.files?.[0] || null);
                setError('');
              }}
            />

            <Select value={format} onChange={setFormat} style={{ width: '100%' }} options={formatOptions} />

            <Button
              type="primary"
              className="vision-btn-primary"
              onClick={run}
              loading={busy}
              disabled={!file || unavailable}
              block
            >
              {t('convertVideo')}
            </Button>

            {busy && (
              <div>
                <Progress percent={uploadPercent} status={uploadPercent < 100 ? 'active' : 'normal'} />
                <Text type="secondary">
                  {uploadPercent < 100
                    ? t('uploading')
                    : t('transcodingOnServer')}
                </Text>
              </div>
            )}

            {error && <Alert type="error" showIcon message={error} />}
          </Space>
        </Card>
      </Col>

      <Col span={24} lg={14}>
        <Card title={t('howThisWorks')} bordered={false}>
          <Space direction="vertical" size="middle">
            <Text>
              {t('videoConversionDescription')}
            </Text>
            <Alert
              type="info"
              showIcon
              message={t('limits')}
              description={t('conversionLimits')}
            />
          </Space>
        </Card>
      </Col>
    </Row>
  );
}

export default function ConvertToolPage() {
  const { t } = useLanguage();
  return (
    <div className="vision-page vision-stack">
      <div className="vision-page-header">
        <div>
          <h1 className="vision-page-title">{t('toolsConverting')}</h1>
          <p className="vision-page-subtitle">
            {t('convertingSubtitle')}
          </p>
        </div>
      </div>

      <Tabs
        items={[
          { key: 'image', label: <span><FileImageOutlined /> {t('image')}</span>, children: <ImageConverter /> },
          { key: 'video', label: <span><VideoCameraAddOutlined /> {t('video')}</span>, children: <VideoConverter /> },
        ]}
      />
    </div>
  );
}
