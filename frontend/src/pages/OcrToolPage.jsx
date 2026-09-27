import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, Empty, Row, Segmented, Select, Slider, Space, Switch, Tag, Tooltip, Typography, message,
} from 'antd';
import {
  CopyOutlined, DownloadOutlined, FileImageOutlined, ReloadOutlined, ScanOutlined,
} from '@ant-design/icons';
import api from '../api';
import { MONO } from '../components/ml/JobView';
import { useLanguage } from '../i18n';

const { Paragraph, Text } = Typography;

// Each language in its own script, as a language picker shows them.
const LANGUAGE_LABELS = { en: 'English', zh: '中文', ko: '한국어', ja: '日本語', ru: 'Русский' };
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const NONE = [];

const lineColor = (score) => (score >= 0.9 ? '#52c41a' : score >= 0.7 ? '#faad14' : '#ff4d4f');

/**
 * Read the text in an image with PaddleOCR (PP-OCRv5) on the server, in
 * English, Chinese, Korean, Japanese or Russian. The image is sent, read and
 * deleted on the server within the request; nothing is kept.
 */
export default function OcrToolPage() {
  const { t } = useLanguage();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [language, setLanguage] = useState('en');
  const [recognitionId, setRecognitionId] = useState('');
  const [detectionId, setDetectionId] = useState('');
  const [rotated, setRotated] = useState(false);
  const [file, setFile] = useState(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [minScore, setMinScore] = useState(0.5);
  const [hovered, setHovered] = useState(-1);
  const [dragging, setDragging] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/tools/ocr/status');
      setStatus(data);
    } catch (error) {
      message.error(error.response?.data?.message || error.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!file) {
      setUrl('');
      return undefined;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const languages = status?.languages || NONE;
  const current = languages.find((item) => item.code === language);
  const readers = (status?.recognition || []).filter((model) => current?.models.includes(model.id))
    .sort((a, b) => current.models.indexOf(a.id) - current.models.indexOf(b.id));
  const ready = Boolean(status?.installed && status.engine?.ok);

  // The first language the server has a model for, when the chosen one has none.
  useEffect(() => {
    if (languages.length && !current?.default) {
      const available = languages.find((item) => item.default);
      if (available) setLanguage(available.code);
    }
  }, [languages, current?.default]);
  useEffect(() => { setRecognitionId(''); }, [language]);

  const run = async (chosen = file) => {
    if (!chosen) return;
    setBusy(true);
    setHovered(-1);
    const form = new FormData();
    form.append('image', chosen);
    form.append('language', language);
    if (recognitionId) form.append('recognitionId', recognitionId);
    if (detectionId) form.append('detectionId', detectionId);
    form.append('rotated', rotated ? 'true' : 'false');
    try {
      const { data } = await api.post('/tools/ocr/recognize', form, { timeout: 330000 });
      setResult(data);
    } catch (error) {
      setResult(null);
      message.error(error.response?.data?.message || t('ocrFailed'));
    } finally {
      setBusy(false);
    }
  };

  const choose = (chosen) => {
    if (!chosen) return;
    if (!String(chosen.type).startsWith('image/')) {
      message.error(t('ocrNotImage'));
      return;
    }
    if (chosen.size > MAX_IMAGE_BYTES) {
      message.error(t('ocrTooLarge', { mb: MAX_IMAGE_BYTES / 1024 / 1024 }));
      return;
    }
    setFile(chosen);
    setResult(null);
    if (ready) run(chosen);
  };

  // A screenshot pasted anywhere on the page is read like a chosen file.
  useEffect(() => {
    const onPaste = (event) => {
      const item = [...(event.clipboardData?.items || [])].find((entry) => entry.type.startsWith('image/'));
      if (!item) return;
      const blob = item.getAsFile();
      if (blob) choose(new File([blob], `pasted.${blob.type.split('/')[1] || 'png'}`, { type: blob.type }));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const shown = useMemo(
    () => (result?.lines || []).map((line, index) => ({ ...line, index })).filter((line) => line.score >= minScore),
    [result, minScore],
  );
  const text = shown.map((line) => line.text).join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      message.success(t('ocrCopied'));
    } catch {
      message.error(t('ocrCopyFailed'));
    }
  };

  const download = () => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${(file?.name || 'ocr').replace(/\.[^.]+$/, '')}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  return (
    <div className="vision-page vision-stack">
      <div className="vision-page-header">
        <div>
          <h1 className="vision-page-title">{t('ocrTitle')}</h1>
          <p className="vision-page-subtitle">{t('ocrSubtitle')}</p>
        </div>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>{t('translationReload')}</Button>
      </div>

      {status && !status.installed && (
        <Alert
          type="warning"
          showIcon
          message={t('ocrNoModels')}
          description={(
            <Paragraph style={{ margin: 0 }}>
              {t('ocrNoModelsHelp')}
              <pre style={{ ...MONO, margin: '8px 0 0' }}>
                pip install paddlepaddle paddleocr{'\n'}python backend/python/download_models.py paddleocr
              </pre>
            </Paragraph>
          )}
        />
      )}
      {status?.installed && !status.engine.ok && (
        <Alert type="error" showIcon message={t('ocrEngineFailed')} description={status.engine.message} />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={9}>
          <Card bordered={false} title={t('ocrSettings')}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <div>
                <Text type="secondary">{t('ocrLanguage')}</Text>
                <Segmented
                  block
                  value={language}
                  onChange={(value) => { setLanguage(value); setResult(null); }}
                  options={(languages.length ? languages : Object.keys(LANGUAGE_LABELS).map((code) => ({ code })))
                    .map((item) => ({
                      value: item.code,
                      label: (
                        <Tooltip title={item.default === null ? t('ocrLanguageMissing') : ''}>
                          <span>{LANGUAGE_LABELS[item.code] || item.code}</span>
                        </Tooltip>
                      ),
                      disabled: item.default === null,
                    }))}
                />
              </div>

              {readers.length > 1 && (
                <div>
                  <Text type="secondary">{t('ocrRecognitionModel')}</Text>
                  <Select
                    style={{ width: '100%' }}
                    value={recognitionId || current?.default}
                    onChange={(value) => { setRecognitionId(value); setResult(null); }}
                    options={readers.map((model) => ({
                      value: model.id,
                      label: `${model.name} · ${model.languages.map((code) => LANGUAGE_LABELS[code] || code).join(', ')}`,
                    }))}
                  />
                </div>
              )}
              {(status?.detection || []).length > 1 && (
                <div>
                  <Text type="secondary">{t('ocrDetectionModel')}</Text>
                  <Select
                    style={{ width: '100%' }}
                    value={detectionId || status.detection[0].id}
                    onChange={(value) => { setDetectionId(value); setResult(null); }}
                    options={status.detection.map((model) => ({ value: model.id, label: model.name }))}
                  />
                </div>
              )}
              {(status?.textline || []).length > 0 && (
                <Space align="start">
                  <Switch checked={rotated} onChange={(value) => { setRotated(value); setResult(null); }} />
                  <div>
                    <Text>{t('ocrRotated')}</Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: 12 }}>{t('ocrRotatedHelp')}</Text>
                  </div>
                </Space>
              )}

              <label
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  choose(event.dataTransfer.files?.[0]);
                }}
                style={{
                  display: 'block',
                  padding: '24px 16px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  borderRadius: 8,
                  border: `1px dashed ${dragging ? '#1677ff' : '#d9d9d9'}`,
                  background: dragging ? 'rgba(22, 119, 255, 0.06)' : 'transparent',
                }}
              >
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(event) => {
                    const chosen = event.target.files?.[0];
                    event.target.value = '';
                    choose(chosen);
                  }}
                />
                <FileImageOutlined style={{ fontSize: 28, color: '#1677ff' }} />
                <div style={{ marginTop: 8 }}><Text strong>{t('ocrChooseImage')}</Text></div>
                <Text type="secondary" style={{ fontSize: 12 }}>{t('ocrDropHint')}</Text>
                {file && <div style={{ marginTop: 8 }}><Tag>{file.name}</Tag></div>}
              </label>

              <Button type="primary" block icon={<ScanOutlined />} loading={busy} disabled={!file || !ready} onClick={() => run()}>
                {t('ocrRead')}
              </Button>
              {busy && <Text type="secondary" style={{ fontSize: 12 }}>{t('ocrFirstSlow')}</Text>}
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={15}>
          <Card
            bordered={false}
            title={t('result')}
            extra={result && (
              <Space wrap>
                <Tooltip title={t('ocrCopy')}>
                  <Button icon={<CopyOutlined />} disabled={!text} onClick={copy} />
                </Tooltip>
                <Tooltip title={t('ocrDownload')}>
                  <Button icon={<DownloadOutlined />} disabled={!text} onClick={download} />
                </Tooltip>
              </Space>
            )}
          >
            {!url ? (
              <Empty description={t('ocrNoResult')} />
            ) : (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <OcrImage url={url} result={result} lines={shown} hovered={hovered} onHover={setHovered} />
                {result && (
                  <>
                    <Space wrap size={[8, 4]}>
                      <Tag>{t('ocrLineCount', { count: shown.length, total: result.lines.length })}</Tag>
                      <Tag>{t('ocrTook', { seconds: result.took?.toFixed(2) })}</Tag>
                      <Tag>{result.models.recognition}</Tag>
                    </Space>
                    <div>
                      <Text type="secondary">{t('ocrMinScore', { value: minScore.toFixed(2) })}</Text>
                      <Slider min={0} max={0.95} step={0.05} value={minScore} onChange={setMinScore} />
                    </div>
                    {shown.length ? (
                      <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                        {shown.map((line) => (
                          <div
                            key={line.index}
                            onMouseEnter={() => setHovered(line.index)}
                            onMouseLeave={() => setHovered(-1)}
                            style={{
                              display: 'flex',
                              gap: 8,
                              alignItems: 'baseline',
                              padding: '4px 8px',
                              borderRadius: 4,
                              background: hovered === line.index ? 'rgba(22, 119, 255, 0.08)' : 'transparent',
                            }}
                          >
                            <Text copyable style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{line.text}</Text>
                            <Text style={{ color: lineColor(line.score), fontSize: 12 }}>{(line.score * 100).toFixed(0)}%</Text>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Text type="secondary">{t('ocrNothingFound')}</Text>
                    )}
                  </>
                )}
              </Space>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}

/**
 * The image with each line's box over it. Boxes are in the image's pixels as
 * the server read it (after any EXIF rotation, as the browser shows it), so
 * the overlay uses those pixels as its viewBox.
 */
function OcrImage({ url, result, lines, hovered, onHover }) {
  const [natural, setNatural] = useState(null);
  const width = result?.width || natural?.width;
  const height = result?.height || natural?.height;
  return (
    <div style={{ position: 'relative', width: '100%', lineHeight: 0 }}>
      <img
        src={url}
        alt=""
        onLoad={(event) => setNatural({ width: event.target.naturalWidth, height: event.target.naturalHeight })}
        style={{ width: '100%', height: 'auto', display: 'block', maxHeight: 640, objectFit: 'contain' }}
      />
      {result && width && height && (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        >
          {lines.map((line) => (
            <polygon
              key={line.index}
              points={line.box.map(([x, y]) => `${x},${y}`).join(' ')}
              fill={lineColor(line.score)}
              fillOpacity={hovered === line.index ? 0.35 : 0.12}
              stroke={lineColor(line.score)}
              strokeWidth={hovered === line.index ? 3 : 1.5}
              vectorEffect="non-scaling-stroke"
              onMouseEnter={() => onHover(line.index)}
              onMouseLeave={() => onHover(-1)}
            >
              <title>{line.text}</title>
            </polygon>
          ))}
        </svg>
      )}
    </div>
  );
}
