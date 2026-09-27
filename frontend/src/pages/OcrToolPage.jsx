import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Alert, Button, Card, Dropdown, Empty, Progress, Segmented, Select, Space, Spin, Switch, Tag, Tooltip,
  Typography, message,
} from 'antd';
import {
  CopyOutlined, DownloadOutlined, FileImageOutlined, FilePdfOutlined, ReloadOutlined, ScanOutlined, StopOutlined,
} from '@ant-design/icons';
import api from '../api';
import { MONO } from '../components/ml/JobView';
import { useLanguage } from '../i18n';
import {
  lineHeight, linePoints, lineWidth, pageText, preparePage,
} from '../lib/ocrDocument';

const { Paragraph, Text } = Typography;

// Each language in its own script, as a language picker shows them.
const LANGUAGE_LABELS = { en: 'English', zh: '中文', ko: '조선어', ja: '日本語', ru: 'Русский' };
// Mirrors the upload limit on /tools/ocr/recognize.
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const POLL_MS = 700;
const NONE = [];
const PANE_HEIGHT = 'max(480px, calc(100vh - 330px))';

/*
 * Fonts for the recognised text. "Automatic" follows the language, with a
 * font that has its script; the others are common fonts, each shown in the
 * list in itself. A font the computer lacks falls back to the next one.
 */
const AUTO_FONTS = {
  en: 'Arial, Helvetica, sans-serif',
  ru: 'Arial, "Segoe UI", sans-serif',
  zh: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", "Noto Sans CJK SC", sans-serif',
  ja: '"Yu Gothic", Meiryo, "Hiragino Sans", "Noto Sans JP", "Noto Sans CJK JP", sans-serif',
  ko: '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", sans-serif',
};
const FONT_GROUPS = [
  {
    key: 'ocrFontSans',
    fonts: [['Arial', 'Arial, sans-serif'], ['Helvetica', 'Helvetica, Arial, sans-serif'], ['Segoe UI', '"Segoe UI", sans-serif'],
      ['Verdana', 'Verdana, sans-serif'], ['Tahoma', 'Tahoma, sans-serif']],
  },
  { key: 'ocrFontSerif', fonts: [['Times New Roman', '"Times New Roman", Times, serif'], ['Georgia', 'Georgia, serif'], ['Cambria', 'Cambria, serif']] },
  { key: 'ocrFontMono', fonts: [['Courier New', '"Courier New", monospace'], ['Consolas', 'Consolas, monospace']] },
  {
    key: 'ocrFontCjk',
    fonts: [
      ['微软雅黑 Microsoft YaHei', '"Microsoft YaHei", sans-serif'], ['宋体 SimSun', 'SimSun, serif'], ['黑体 SimHei', 'SimHei, sans-serif'],
      ['楷体 KaiTi', 'KaiTi, serif'], ['맑은 고딕 Malgun Gothic', '"Malgun Gothic", sans-serif'], ['바탕 Batang', 'Batang, serif'],
      ['굴림 Gulim', 'Gulim, sans-serif'], ['游ゴシック Yu Gothic', '"Yu Gothic", sans-serif'], ['ＭＳ 明朝 MS Mincho', '"MS Mincho", serif'],
      ['メイリオ Meiryo', 'Meiryo, sans-serif'],
    ],
  },
];

const TABLE_CSS = `
.ocr-table table { border-collapse: collapse; width: 100%; height: 100%; table-layout: fixed; }
.ocr-table td, .ocr-table th { border: 1px solid #555; padding: 0.15em 0.35em; vertical-align: middle; overflow: hidden; word-break: break-word; color: #000; }
`;

const isPdf = (file) => file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name || '');
const lineKey = (page, index) => `${page}:${index}`;
const blockKey = (page, index) => `${page}:b${index}`;
const LINE_COLOR = '#1677ff';
/** The printed size of a line: points on a PDF page (its resolution is known), pixels in an image. */
const fontSizeLabel = (page, line) => (page.dpi
  ? `${Math.round(linePoints(page, line))} pt`
  : `${Math.round(lineHeight(line.box) * 0.75)} px`);

/**
 * Read the text in an image, or in each page of a PDF, with PaddleOCR
 * (PP-OCRv5) on the server, in English, Chinese, Korean, Japanese or Russian.
 * The original is on the left and what was read on the right — laid out as
 * the page was, with its titles, tables and figures, or as plain text — and
 * the two sides scroll and point together. A file is read as a job whose
 * pages appear as they are read.
 */
export default function OcrToolPage() {
  const { t } = useLanguage();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [language, setLanguage] = useState('en');
  const [rotated, setRotated] = useState(false);
  const [withLayout, setWithLayout] = useState(true);
  const [file, setFile] = useState(null);
  const [url, setUrl] = useState('');
  const [job, setJob] = useState(null); // { id, status, done, total, pageCount, error, took }
  const [pages, setPages] = useState(NONE);
  const [starting, setStarting] = useState(false);
  const [view, setView] = useState('layout');
  const [font, setFont] = useState('auto');
  const [hovered, setHovered] = useState(null); // { key, from: 'left' | 'right' }
  const [currentPage, setCurrentPage] = useState(1);
  const [dragging, setDragging] = useState(false);
  const pollRef = useRef(null);
  const jobRef = useRef(null);
  const pagesRef = useRef(NONE);
  const leftRef = useRef(null);
  const rightRef = useRef(null);
  const syncing = useRef({ pane: null, until: 0 });
  const inputRef = useRef(null);

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
    if (!file || isPdf(file)) {
      setUrl('');
      return undefined;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const languages = status?.languages || NONE;
  const current = languages.find((item) => item.code === language);
  const ready = Boolean(status?.installed && status.engine?.ok);
  const hasLayout = Boolean(status?.layout?.length);
  const running = job?.status === 'running';

  // The first language the server has a model for, when the chosen one has none.
  useEffect(() => {
    if (languages.length && !current?.default) {
      const available = languages.find((item) => item.default);
      if (available) setLanguage(available.code);
    }
  }, [languages, current?.default]);

  /* ------------------------------------------------------------ the job */

  const stopPolling = () => {
    clearTimeout(pollRef.current);
    pollRef.current = null;
  };

  const poll = useCallback(async (id) => {
    try {
      const { data } = await api.get(`/tools/ocr/jobs/${id}`, { params: { from: pagesRef.current.length } });
      if (jobRef.current !== id) return;
      const next = data.job;
      if (next.pages.length) {
        pagesRef.current = [...pagesRef.current, ...next.pages];
        setPages(pagesRef.current);
      }
      setJob(next);
      if (next.status === 'running') pollRef.current = setTimeout(() => poll(id), POLL_MS);
    } catch (error) {
      if (jobRef.current !== id) return;
      setJob((before) => ({ ...before, status: 'failed', error: error.response?.data?.message || error.message }));
    }
  }, []);

  const cancel = async () => {
    const id = jobRef.current;
    stopPolling();
    if (!id) return;
    try {
      const { data } = await api.post(`/tools/ocr/jobs/${id}/cancel`);
      if (jobRef.current === id) setJob(data.job);
    } catch {
      /* Already finished or gone: nothing to stop. */
    }
  };

  const run = async (chosen = file) => {
    if (!chosen) return;
    if (running) await cancel();
    stopPolling();
    setStarting(true);
    setHovered(null);
    setCurrentPage(1);
    pagesRef.current = NONE;
    setPages(NONE);
    setJob(null);
    jobRef.current = null;
    const form = new FormData();
    form.append('image', chosen);
    form.append('language', language);
    form.append('rotated', rotated ? 'true' : 'false');
    form.append('layout', withLayout ? 'true' : 'false');
    try {
      const { data } = await api.post('/tools/ocr/recognize', form, { timeout: 0 });
      jobRef.current = data.job.id;
      setJob(data.job);
      leftRef.current?.scrollTo({ top: 0 });
      rightRef.current?.scrollTo({ top: 0 });
      poll(data.job.id);
    } catch (error) {
      message.error(error.response?.data?.message || t('ocrFailed'));
    } finally {
      setStarting(false);
    }
  };

  // Leaving the page stops a job still reading.
  useEffect(() => () => {
    stopPolling();
    if (jobRef.current) api.post(`/tools/ocr/jobs/${jobRef.current}/cancel`).catch(() => {});
  }, []);

  const choose = (chosen) => {
    if (!chosen) return;
    if (!String(chosen.type).startsWith('image/') && !isPdf(chosen)) {
      message.error(t('ocrNotImage'));
      return;
    }
    if (chosen.size > MAX_FILE_BYTES) {
      message.error(t('ocrTooLarge', { mb: MAX_FILE_BYTES / 1024 / 1024 }));
      return;
    }
    setFile(chosen);
    if (ready) {
      run(chosen);
    } else {
      pagesRef.current = NONE;
      setPages(NONE);
      setJob(null);
    }
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

  /* ------------------------------------------------------------ the pages */

  const prepared = useMemo(() => pages.map((page) => preparePage(page)), [pages]);
  // Tables and figures are found only with the layout models; say so when
  // they are missing rather than showing a page that silently lacks them.
  const layoutMissing = Boolean(status?.installed) && !hasLayout;
  const fontFamily = font === 'auto' ? AUTO_FONTS[language] || AUTO_FONTS.en : font;
  // A slot for every page, read or still to come, so the thumbnails and both
  // panes hold the whole document from the start.
  const total = job?.total || (file && !isPdf(file) ? 1 : 0);
  const slots = useMemo(
    () => Array.from({ length: Math.max(total, prepared.length) }, (_, index) => prepared[index] || null),
    [total, prepared],
  );
  const aspect = prepared[0] ? prepared[0].height / prepared[0].width : 1.414;

  const text = useMemo(() => prepared.map((page) => {
    const body = pageText(page);
    return prepared.length > 1 ? `--- ${t('ocrPage', { page: page.page })} ---\n${body}` : body;
  }).join('\n\n').trim(), [prepared, t]);

  /* ----------------------------------------------- scrolling in step */

  // A pane scrolled to follow the other must not be followed back.
  const hold = (pane) => { syncing.current = { pane, until: Date.now() + 150 }; };
  const held = (pane) => syncing.current.pane === pane && Date.now() < syncing.current.until;

  /** The page a pane is at, and how far down it (0..1). */
  const position = (pane) => {
    const sections = [...pane.querySelectorAll('[data-page]')];
    if (!sections.length) return null;
    let at = sections[0];
    for (const section of sections) {
      if (section.offsetTop <= pane.scrollTop + 1) at = section;
      else break;
    }
    const fraction = Math.min(1, Math.max(0, (pane.scrollTop - at.offsetTop) / Math.max(1, at.offsetHeight)));
    return { page: Number(at.dataset.page), fraction };
  };

  const follow = (from, to) => {
    if (!from || !to) return;
    const at = position(from);
    if (!at) return;
    setCurrentPage(at.page);
    if (held(from)) return;
    const target = to.querySelector(`[data-page="${at.page}"]`);
    if (!target) return;
    hold(to);
    to.scrollTop = target.offsetTop + at.fraction * target.offsetHeight;
  };

  /** Scroll a pane just enough to bring an element into the middle, when it is out of view. */
  const reveal = (pane, key) => {
    const element = pane?.querySelector(`[data-key="${key}"]`);
    if (!element) return;
    const box = pane.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    if (rect.top >= box.top && rect.bottom <= box.bottom) return;
    hold(pane);
    pane.scrollTop += rect.top - box.top - box.height / 2 + rect.height / 2;
  };

  // Pointing at a line on one side shows it on the other.
  useEffect(() => {
    if (hovered) reveal(hovered.from === 'left' ? rightRef.current : leftRef.current, hovered.key);
  }, [hovered]); // eslint-disable-line react-hooks/exhaustive-deps -- reveal reads only refs

  const pointLeft = useCallback((key) => setHovered(key ? { key, from: 'left' } : null), []);
  const pointRight = useCallback((key) => setHovered(key ? { key, from: 'right' } : null), []);
  const hoveredKey = hovered?.key || null;

  const goToPage = (number) => {
    const target = leftRef.current?.querySelector(`[data-page="${number}"]`);
    if (target) leftRef.current.scrollTo({ top: target.offsetTop, behavior: 'smooth' });
  };

  /* ------------------------------------------------------------ output */

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      message.success(t('ocrCopied'));
    } catch {
      message.error(t('ocrCopyFailed'));
    }
  };

  const save = (content, type, extension) => {
    const blob = new Blob([content], { type });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${baseName}.${extension}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  const baseName = (file?.name || 'ocr').replace(/\.[^.]+$/, '');
  const [exporting, setExporting] = useState('');
  const exportAs = async (kind) => {
    if (kind === 'html') {
      saveHtml();
      return;
    }
    if (kind === 'txt') {
      save(text, 'text/plain;charset=utf-8', 'txt');
      return;
    }
    setExporting(kind);
    try {
      const { toDocx, toXlsx } = await import('../lib/ocrExport');
      const blob = kind === 'docx'
        ? await toDocx(prepared, { fontFamily, title: baseName })
        : await toXlsx(prepared, {
          sheetName: (page) => t('ocrPage', { page: page.page }),
          figureLabel: (number) => t('ocrFigure', { number }),
        });
      save(blob, blob.type, kind);
    } catch (error) {
      message.error(t('ocrExportFailed', { reason: error.message }));
    } finally {
      setExporting('');
    }
  };

  // The laid-out pages as one HTML file: the same drawing as the right pane, in the chosen font.
  const saveHtml = () => {
    const body = prepared.map((page) => renderToStaticMarkup(
      <div className="page"><PageLayout page={page} fontFamily={fontFamily} /></div>,
    )).join('\n');
    const title = (file?.name || 'OCR').replace(/[<>&"]/g, '');
    save(`<!DOCTYPE html>
<html lang="${language}"><head><meta charset="utf-8"><title>${title}</title>
<style>
body { margin: 0; padding: 24px; background: #eee; }
.page { max-width: 900px; margin: 0 auto 24px; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.2); }
.page svg { display: block; width: 100%; height: auto; }
${TABLE_CSS}
</style></head><body>
${body}
</body></html>
`, 'text/html;charset=utf-8', 'html');
  };

  /* ------------------------------------------------------------ view */

  const progress = job?.total ? Math.round((job.done / job.total) * 100) : 0;
  const dropHint = t('ocrDropHint', { mb: MAX_FILE_BYTES / 1024 / 1024, pages: status?.maxPages || 30 });
  const fontOptions = [
    { value: 'auto', label: t('ocrFontAuto'), name: t('ocrFontAuto') },
    ...FONT_GROUPS.map((group) => ({
      label: t(group.key),
      options: group.fonts.map(([name, family]) => ({ value: family, label: <span style={{ fontFamily: family }}>{name}</span>, name })),
    })),
  ];
  const pending = (index) => (
    <PendingPage aspect={aspect} reading={running && index === prepared.length} label={t('ocrPageReading', { page: index + 1 })} />
  );

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

      <Card bordered={false} styles={{ body: { padding: 16 } }}>
        <Space wrap size={[20, 12]} align="end" style={{ width: '100%' }}>
          <Space direction="vertical" size={2}>
            <Text type="secondary" style={{ fontSize: 12 }}>{t('ocrLanguage')}</Text>
            <Segmented
              value={language}
              onChange={setLanguage}
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
          </Space>
          {hasLayout && (
            <Tooltip title={t('ocrLayoutHelp')}>
              <Space size={6}>
                <Switch size="small" checked={withLayout} onChange={setWithLayout} />
                <Text>{t('ocrLayoutSwitch')}</Text>
              </Space>
            </Tooltip>
          )}
          {(status?.textline || NONE).length > 0 && (
            <Tooltip title={t('ocrRotatedHelp')}>
              <Space size={6}>
                <Switch size="small" checked={rotated} onChange={setRotated} />
                <Text>{t('ocrRotated')}</Text>
              </Space>
            </Tooltip>
          )}
          <Space wrap>
            <input
              ref={inputRef}
              type="file"
              accept="image/*,application/pdf,.pdf"
              style={{ display: 'none' }}
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                event.target.value = '';
                choose(chosen);
              }}
            />
            <Tooltip title={dropHint}>
              <Button icon={<FileImageOutlined />} onClick={() => inputRef.current?.click()}>{t('ocrChooseImage')}</Button>
            </Tooltip>
            {running ? (
              <Button danger icon={<StopOutlined />} onClick={cancel}>{t('ocrCancel')}</Button>
            ) : (
              <Button type="primary" icon={<ScanOutlined />} loading={starting} disabled={!file || !ready} onClick={() => run()}>
                {t('ocrRead')}
              </Button>
            )}
            {file && <Tag icon={isPdf(file) ? <FilePdfOutlined /> : <FileImageOutlined />}>{file.name}</Tag>}
          </Space>
        </Space>

        {(running || starting) && (
          <div style={{ marginTop: 12 }}>
            <Progress percent={progress} status="active" size="small" showInfo={Boolean(job?.total)} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {job?.total
                ? t('ocrProgress', { done: job.done, total: job.total, page: Math.min(job.done + 1, job.total) })
                : t('ocrOpening')}
              {!job?.done ? ` ${t('ocrFirstSlow')}` : ''}
            </Text>
          </div>
        )}
        {layoutMissing && (
          <Alert
            style={{ marginTop: 12 }}
            type="warning"
            showIcon
            message={t('ocrLayoutMissing')}
            description={<pre style={{ ...MONO, margin: 0 }}>python backend/python/download_models.py paddleocr</pre>}
          />
        )}
        {job?.status === 'cancelled' && (
          <Alert style={{ marginTop: 12 }} type="info" showIcon message={t('ocrCancelled', { done: job.done, total: job.total || '?' })} />
        )}
        {job?.status === 'failed' && <Alert style={{ marginTop: 12 }} type="error" showIcon message={job.error || t('ocrFailed')} />}
        {job?.status === 'succeeded' && job.pageCount > (job.total || 0) && (
          <Alert style={{ marginTop: 12 }} type="info" showIcon message={t('ocrPdfTruncated', { read: job.total, count: job.pageCount })} />
        )}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
        {/* ------------------------------------------------ the original */}
        <Card
          bordered={false}
          title={t('ocrOriginal')}
          styles={{ body: { padding: 0 } }}
          extra={slots.length > 1 && <Text type="secondary">{t('ocrPageOf', { page: currentPage, total: slots.length })}</Text>}
        >
          <div
            style={{ display: 'flex', height: PANE_HEIGHT }}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              choose(event.dataTransfer.files?.[0]);
            }}
          >
            {slots.length > 1 && (
              <div style={{ width: 92, flex: 'none', overflowY: 'auto', padding: 8, borderRight: '1px solid rgba(128,128,128,0.2)' }}>
                {slots.map((page, index) => (
                  <button
                    type="button"
                    // eslint-disable-next-line react/no-array-index-key
                    key={index}
                    onClick={() => goToPage(index + 1)}
                    title={t('ocrPage', { page: index + 1 })}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: 2,
                      marginBottom: 8,
                      cursor: 'pointer',
                      background: 'transparent',
                      borderRadius: 4,
                      border: `2px solid ${currentPage === index + 1 ? '#1677ff' : 'transparent'}`,
                    }}
                  >
                    {page?.image ? (
                      <img src={page.image} alt="" style={{ width: '100%', display: 'block', boxShadow: '0 0 2px rgba(0,0,0,0.3)' }} />
                    ) : (
                      <div style={{ aspectRatio: `1 / ${aspect}`, display: 'grid', placeItems: 'center', background: 'rgba(128,128,128,0.12)' }}>
                        {running && index === prepared.length ? <Spin size="small" /> : null}
                      </div>
                    )}
                    <Text type="secondary" style={{ fontSize: 11 }}>{index + 1}</Text>
                  </button>
                ))}
              </div>
            )}
            <div
              ref={leftRef}
              onScroll={() => follow(leftRef.current, rightRef.current)}
              style={{
                flex: 1,
                overflowY: 'auto',
                position: 'relative',
                padding: 12,
                background: dragging ? 'rgba(22, 119, 255, 0.06)' : 'rgba(128,128,128,0.06)',
                outline: dragging ? '2px dashed #1677ff' : 'none',
              }}
            >
              {!file ? (
                <Empty
                  style={{ marginTop: 80 }}
                  image={<FileImageOutlined style={{ fontSize: 48, color: '#1677ff' }} />}
                  description={(
                    <Space direction="vertical" size={4}>
                      <Text>{t('ocrNoResult')}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>{dropHint}</Text>
                    </Space>
                  )}
                />
              ) : slots.length === 0 ? (
                <div style={{ padding: 48, textAlign: 'center' }}>
                  {running || starting ? <Spin /> : <FilePdfOutlined style={{ fontSize: 48, color: '#ff4d4f' }} />}
                  <div style={{ marginTop: 12 }}><Text type="secondary">{file.name}</Text></div>
                </div>
              ) : slots.map((page, index) => (
                // eslint-disable-next-line react/no-array-index-key
                <section key={index} data-page={index + 1} style={{ marginBottom: 12 }}>
                  {page || url
                    ? <OriginalPage url={page?.image || url} page={page} hoveredKey={hoveredKey} onPoint={pointLeft} />
                    : pending(index)}
                </section>
              ))}
            </div>
          </div>
        </Card>

        {/* ------------------------------------------------ what was read */}
        <Card
          bordered={false}
          title={t('ocrRecognised')}
          styles={{ body: { padding: 0 } }}
          extra={(
            <Space wrap size={8}>
              <Segmented
                size="small"
                value={view}
                onChange={setView}
                options={[{ value: 'layout', label: t('ocrViewLayout') }, { value: 'text', label: t('ocrViewText') }]}
              />
              <Tooltip title={t('ocrFont')}>
                <Select
                  size="small"
                  showSearch
                  value={font}
                  onChange={setFont}
                  options={fontOptions}
                  filterOption={(input, option) => String(option?.name || '').toLowerCase().includes(input.toLowerCase())}
                  style={{ width: 190 }}
                  popupMatchSelectWidth={240}
                  aria-label={t('ocrFont')}
                />
              </Tooltip>
              <Tooltip title={t('ocrCopy')}>
                <Button size="small" icon={<CopyOutlined />} disabled={!text} onClick={copy} />
              </Tooltip>
              <Dropdown
                disabled={!prepared.length}
                menu={{
                  items: [
                    { key: 'docx', label: t('ocrDownloadDocx') },
                    { key: 'xlsx', label: t('ocrDownloadXlsx') },
                    { key: 'html', label: t('ocrDownloadHtml') },
                    { key: 'txt', label: t('ocrDownloadTxt') },
                  ],
                  onClick: ({ key }) => exportAs(key),
                }}
              >
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  loading={Boolean(exporting)}
                  disabled={!prepared.length}
                  aria-label={t('ocrDownload')}
                >
                  {t('ocrExport')}
                </Button>
              </Dropdown>
            </Space>
          )}
        >
          <div
            ref={rightRef}
            onScroll={() => follow(rightRef.current, leftRef.current)}
            style={{ height: PANE_HEIGHT, overflowY: 'auto', position: 'relative', padding: 12, background: 'rgba(128,128,128,0.06)' }}
          >
            {!slots.length || (!prepared.length && !running && !starting) ? (
              <Empty style={{ marginTop: 80 }} description={job?.status === 'failed' ? t('ocrFailed') : t('ocrNoResult')} />
            ) : slots.map((page, index) => (
              // eslint-disable-next-line react/no-array-index-key
              <section key={index} data-page={index + 1} style={{ marginBottom: 12 }}>
                {!page ? pending(index) : view === 'layout' ? (
                  <div style={{ background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }}>
                    <PageLayout page={page} fontFamily={fontFamily} hoveredKey={hoveredKey} onPoint={pointRight} interactive />
                  </div>
                ) : (
                  <PageText page={page} fontFamily={fontFamily} hoveredKey={hoveredKey} onPoint={pointRight} multi={slots.length > 1} t={t} />
                )}
              </section>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

/** A page not read yet: its place, at the proportions of the first page. */
function PendingPage({ aspect, reading, label }) {
  return (
    <div style={{ aspectRatio: `1 / ${aspect}`, display: 'grid', placeItems: 'center', background: 'rgba(128,128,128,0.12)' }}>
      {reading ? <Space direction="vertical" align="center"><Spin /><Text type="secondary">{label}</Text></Space> : null}
    </div>
  );
}

/**
 * The original, with a box round each line read and each table and figure
 * found. Boxes are in the pixels the server read (after any EXIF rotation, as
 * the browser shows it; for a PDF, the page as rendered, which its preview
 * keeps the proportions of).
 */
function OriginalPage({ url, page, hoveredKey, onPoint }) {
  const [natural, setNatural] = useState(null);
  const width = page?.width || natural?.width;
  const height = page?.height || natural?.height;
  return (
    <div style={{ position: 'relative', lineHeight: 0, boxShadow: '0 1px 4px rgba(0,0,0,0.2)', background: '#fff' }}>
      <img
        src={url}
        alt=""
        onLoad={(event) => setNatural({ width: event.target.naturalWidth, height: event.target.naturalHeight })}
        style={{ width: '100%', height: 'auto', display: 'block' }}
      />
      {page && width && height && (
        <svg viewBox={`0 0 ${width} ${height}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          {page.blocks.map((block) => {
            const [x1, y1, x2, y2] = block.box;
            const key = blockKey(page.page, block.index);
            const color = block.type === 'table' ? '#1677ff' : '#722ed1';
            return (
              <rect
                key={key}
                data-key={key}
                x={x1}
                y={y1}
                width={x2 - x1}
                height={y2 - y1}
                fill={color}
                fillOpacity={hoveredKey === key ? 0.15 : 0.03}
                stroke={color}
                strokeDasharray="6 4"
                strokeWidth={hoveredKey === key ? 3 : 1.5}
                vectorEffect="non-scaling-stroke"
                onMouseEnter={() => onPoint(key)}
                onMouseLeave={() => onPoint(null)}
              />
            );
          })}
          {page.lines.map((line) => {
            const own = lineKey(page.page, line.index);
            // A line in a table or figure points at it; the right side draws it whole.
            const target = line.block === null ? own : blockKey(page.page, line.block);
            const lit = hoveredKey === own || (line.block === null && hoveredKey === target);
            return (
              <polygon
                key={own}
                data-key={own}
                points={line.box.map(([x, y]) => `${x},${y}`).join(' ')}
                fill={LINE_COLOR}
                fillOpacity={lit ? 0.3 : 0.06}
                stroke={LINE_COLOR}
                strokeWidth={lit ? 3 : 1}
                vectorEffect="non-scaling-stroke"
                onMouseEnter={() => onPoint(target)}
                onMouseLeave={() => onPoint(null)}
              >
                <title>{`${line.text} — ${fontSizeLabel(page, line)}`}</title>
              </polygon>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/**
 * A page as it was laid out: each line where it stood, at its size (bold if
 * a title, grey if a header or footer), each table rebuilt, each figure cut
 * from the page. Drawn in the page's own pixels, so it scales with the pane.
 * Also rendered to static markup for the HTML download, with `interactive` off.
 */
function PageLayout({
  page, fontFamily, hoveredKey = null, onPoint = () => {}, interactive = false,
}) {
  const tableSize = (block) => {
    const heights = page.lines.filter((line) => line.block === block.index).map((line) => lineHeight(line.box)).sort((a, b) => a - b);
    return (heights[Math.floor(heights.length / 2)] || 24) * 0.72;
  };
  const events = (key) => (interactive ? { onMouseEnter: () => onPoint(key), onMouseLeave: () => onPoint(null) } : {});
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${page.width} ${page.height}`}
      style={{ display: 'block', width: '100%', height: 'auto', fontFamily }}
    >
      {interactive && <style>{TABLE_CSS}</style>}
      <rect x={0} y={0} width={page.width} height={page.height} fill="#fff" />
      {page.blocks.map((block) => {
        const [x1, y1, x2, y2] = block.box;
        const key = blockKey(page.page, block.index);
        const lit = hoveredKey === key;
        const outline = lit && (
          <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} fill="#1677ff" fillOpacity={0.08} stroke="#1677ff" strokeWidth={3} vectorEffect="non-scaling-stroke" />
        );
        return block.type === 'figure' ? (
          <g key={key} data-key={interactive ? key : undefined} {...events(key)}>
            <image href={block.image} x={x1} y={y1} width={x2 - x1} height={y2 - y1} preserveAspectRatio="none" />
            {outline}
          </g>
        ) : (
          <g key={key} data-key={interactive ? key : undefined} {...events(key)}>
            <foreignObject x={x1} y={y1} width={x2 - x1} height={y2 - y1} style={{ overflow: 'visible' }}>
              <div
                className="ocr-table"
                style={{
                  width: '100%', height: '100%', fontFamily, fontSize: tableSize(block), lineHeight: 1.2,
                }}
                // The server's table, reduced to table markup by cleanTable.
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: block.html }}
              />
            </foreignObject>
            {outline}
          </g>
        );
      })}
      {page.lines.filter((line) => line.block === null).map((line) => {
        const key = lineKey(page.page, line.index);
        const [left, top] = line.box[0];
        const height = lineHeight(line.box);
        const width = lineWidth(line.box);
        const angle = (Math.atan2(line.box[1][1] - line.box[0][1], line.box[1][0] - line.box[0][0]) * 180) / Math.PI;
        const lit = hoveredKey === key;
        return (
          <g
            key={key}
            data-key={interactive ? key : undefined}
            transform={Math.abs(angle) > 1 ? `rotate(${angle.toFixed(2)} ${left} ${top})` : undefined}
            {...events(key)}
          >
            {interactive && <rect x={left} y={top} width={width} height={height} fill="#1677ff" fillOpacity={lit ? 0.15 : 0} />}
            <text
              x={left}
              y={top + height * 0.8}
              fontSize={height * 0.78}
              fontWeight={line.bold ? 700 : 400}
              fill={line.color || '#000'}
              textLength={width}
              lengthAdjust="spacingAndGlyphs"
            >
              {line.text}
              {interactive && <title>{`${line.text} — ${fontSizeLabel(page, line)}`}</title>}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** A page as plain lines, each in its colour and weight, with its size. */
function PageText({
  page, fontFamily, hoveredKey, onPoint, multi, t,
}) {
  return (
    <div style={{ background: '#fff', padding: '8px 4px', boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }}>
      {multi && <div style={{ padding: '0 8px 6px' }}><Tag color="blue">{t('ocrPage', { page: page.page })}</Tag></div>}
      {page.lines.length ? page.lines.map((line) => {
        const own = lineKey(page.page, line.index);
        const target = line.block === null ? own : blockKey(page.page, line.block);
        return (
          <div
            key={own}
            data-key={own}
            onMouseEnter={() => onPoint(own)}
            onMouseLeave={() => onPoint(null)}
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'baseline',
              padding: '3px 8px',
              borderRadius: 4,
              background: hoveredKey === own || hoveredKey === target ? 'rgba(22, 119, 255, 0.1)' : 'transparent',
            }}
          >
            <Text copyable style={{ flex: 1, whiteSpace: 'pre-wrap', fontFamily, fontWeight: line.bold ? 700 : 400, color: line.color || '#000' }}>
              {line.text}
            </Text>
            <Text type="secondary" style={{ fontSize: 11 }}>{fontSizeLabel(page, line)}</Text>
          </div>
        );
      }) : <Text type="secondary" style={{ padding: 8 }}>{t('ocrNothingFound')}</Text>}
    </div>
  );
}
