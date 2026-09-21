import { useEffect, useRef, useState } from 'react';
import {
  Alert, Button, Card, Checkbox, Col, ColorPicker, Input, InputNumber, Row, Select, Space, Tabs, Tooltip, Typography, message,
} from 'antd';
import {
  CopyOutlined, DownloadOutlined, FontSizeOutlined, PictureOutlined,
} from '@ant-design/icons';
import api from '../api';
import {
  COLOR_FORMATS, FLATTENS_ALPHA, SUPPORTS_DITHER, buildImageC, safeCName,
} from '../lib/lvglImage';

// antd renders one <optgroup> per entry, keeping the long v9 format list
// readable: true colour, greyscale, alpha only, indexed.
const FORMAT_GROUPS = [...new Set(COLOR_FORMATS.map((option) => option.group))].map((group) => ({
  label: group,
  options: COLOR_FORMATS
    .filter((option) => option.group === group)
    .map(({ value, label }) => ({ value, label })),
}));

const { Paragraph, Text } = Typography;

// A full-size image can generate megabytes of C. Rendering all of it into a
// <pre> locks the tab up, so the preview is capped and the download carries
// the complete file.
const PREVIEW_LINES = 160;

const previewOf = (code) => {
  if (!code) return '';
  const lines = code.split('\n');
  if (lines.length <= PREVIEW_LINES) return code;
  return `${lines.slice(0, PREVIEW_LINES).join('\n')}\n\n/* ... ${lines.length - PREVIEW_LINES} more lines. Download the file for the full output. */`;
};

const downloadText = (filename, content) => {
  const blob = new Blob([content], { type: 'text/x-c;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const copyText = async (content) => {
  try {
    await navigator.clipboard.writeText(content);
    message.success('Copied to clipboard.');
  } catch {
    message.error('Clipboard access is unavailable in this browser.');
  }
};

const formatBytes = (bytes) => (bytes > 1024 * 1024
  ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
  : `${(bytes / 1024).toFixed(1)} KB`);

/** Result panel shared by both tabs. */
function OutputCard({ title, result, emptyText }) {
  if (!result) {
    return (
      <Card title={title} bordered={false}>
        <Alert type="info" showIcon message={emptyText} />
      </Card>
    );
  }

  return (
    <Card
      title={title}
      bordered={false}
      extra={(
        <Space>
          <Text type="secondary">
            {result.detail || `${result.filename} · ${formatBytes(result.bytes)}`}
          </Text>
          <Button icon={<CopyOutlined />} onClick={() => copyText(result.code)}>Copy</Button>
          <Button
            type="primary"
            className="vision-btn-primary"
            icon={<DownloadOutlined />}
            onClick={() => downloadText(result.filename, result.code)}
          >
            Download {result.filename.endsWith('.h') ? '.h' : '.c'}
          </Button>
        </Space>
      )}
    >
      <pre className="lvgl-code-preview">{previewOf(result.code)}</pre>
    </Card>
  );
}

/**
 * Font tab. The conversion runs on the API because it uses the real
 * lv_font_conv, which is a CommonJS package built around a FreeType WASM
 * build — see backend/src/controllers/lvglController.js.
 */
function FontConverter() {
  const [file, setFile] = useState(null);
  const [name, setName] = useState('lv_font_custom');
  const [size, setSize] = useState(16);
  const [bpp, setBpp] = useState(4);
  const [range, setRange] = useState('0x20-0x7F');
  const [symbols, setSymbols] = useState('');
  const [options, setOptions] = useState({ noCompress: false, noKerning: false, lcd: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const run = async () => {
    if (!file) {
      setError('Choose a .ttf, .otf or .woff file first.');
      return;
    }
    if (!range.trim() && !symbols) {
      setError('Provide a Unicode range, a symbol list, or both.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('font', file);
      form.append('name', name);
      form.append('size', String(size));
      form.append('bpp', String(bpp));
      form.append('range', range);
      form.append('symbols', symbols);
      form.append('noCompress', String(options.noCompress));
      form.append('noKerning', String(options.noKerning));
      form.append('lcd', String(options.lcd));

      const { data } = await api.post('/tools/lvgl/font', form);
      setResult(data);
      message.success(`${data.filename} generated.`);
    } catch (caught) {
      // The API returns a readable message for bad fonts and empty ranges.
      setError(caught?.response?.data?.message || 'The font could not be converted.');
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Row gutter={[16, 16]}>
      <Col span={24} lg={10}>
        <Card title="Source font" bordered={false}>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <label className="mail-file-picker" htmlFor="lvgl-font-upload" style={{ width: '100%' }}>
              <FontSizeOutlined />
              <span>{file ? file.name : 'Select .ttf / .otf / .woff'}</span>
            </label>
            <input
              id="lvgl-font-upload"
              type="file"
              accept=".ttf,.otf,.woff,font/ttf,font/otf,font/woff"
              className="mail-file-input"
              onChange={(event) => {
                const chosen = event.target.files?.[0] || null;
                setFile(chosen);
                if (chosen && name === 'lv_font_custom') {
                  setName(safeCName(chosen.name.replace(/\.[^.]+$/, ''), 'lv_font_custom'));
                }
              }}
            />

            <Input addonBefore="Name" value={name} onChange={(event) => setName(event.target.value)} />

            <Space style={{ width: '100%' }}>
              <InputNumber
                min={6}
                max={200}
                value={size}
                onChange={(value) => setSize(value || 16)}
                addonBefore="Size"
                addonAfter="px"
              />
              <Select
                value={bpp}
                onChange={setBpp}
                style={{ width: 130 }}
                options={[1, 2, 3, 4, 8].map((value) => ({ value, label: `${value} bpp` }))}
              />
            </Space>

            <Tooltip title="Examples: 0x20-0x7F, 32-127, 0x1F450, 0x1F450=>0xF005">
              <Input
                addonBefore="Range"
                value={range}
                onChange={(event) => setRange(event.target.value)}
                placeholder="0x20-0x7F"
              />
            </Tooltip>

            <Input
              addonBefore="Symbols"
              value={symbols}
              onChange={(event) => setSymbols(event.target.value)}
              placeholder="Optional, e.g. abc0123"
            />

            <Space direction="vertical">
              <Checkbox
                checked={options.noCompress}
                onChange={(event) => setOptions({ ...options, noCompress: event.target.checked })}
              >
                Disable RLE compression
              </Checkbox>
              <Checkbox
                checked={options.noKerning}
                onChange={(event) => setOptions({ ...options, noKerning: event.target.checked })}
              >
                Drop kerning data
              </Checkbox>
              <Checkbox
                checked={options.lcd}
                onChange={(event) => setOptions({ ...options, lcd: event.target.checked })}
              >
                Subpixel rendering (horizontal)
              </Checkbox>
            </Space>

            <Button type="primary" className="vision-btn-primary" loading={busy} onClick={run} block>
              Convert font
            </Button>

            {error && <Alert type="error" showIcon message={error} />}
          </Space>
        </Card>
      </Col>

      <Col span={24} lg={14}>
        <OutputCard
          title="Generated lv_font_conv output"
          result={result}
          emptyText="Upload a font and convert to generate an LVGL font .c file."
        />
      </Col>
    </Row>
  );
}

/** Image tab. Runs entirely in the browser — see lib/lvglImage.js. */
function ImageConverter() {
  const [source, setSource] = useState(null); // { url, width, height, data }
  const [name, setName] = useState('img_asset');
  const [cf, setCf] = useState('ARGB8888');
  const [dither, setDither] = useState(false);
  const [background, setBackground] = useState('#000000');
  const [width, setWidth] = useState(null);
  const [height, setHeight] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const objectUrl = useRef(null);

  // The preview <img> holds an object URL; it must not outlive the component
  // or the next upload.
  useEffect(() => () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);

  const loadImage = (file) => {
    if (!file) return;
    setError('');

    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    const url = URL.createObjectURL(file);
    objectUrl.current = url;

    const image = new Image();
    image.onload = () => {
      setSource({ url, width: image.naturalWidth, height: image.naturalHeight, element: image });
      setWidth(image.naturalWidth);
      setHeight(image.naturalHeight);
      setName((current) => (current === 'img_asset'
        ? safeCName(file.name.replace(/\.[^.]+$/, ''), 'img_asset')
        : current));
      setResult(null);
    };
    image.onerror = () => setError('That file could not be decoded as an image.');
    image.src = url;
  };

  const run = async () => {
    if (!source) {
      setError('Choose a PNG, JPG or WebP first.');
      return;
    }

    const outWidth = Math.max(1, Number(width) || source.width);
    const outHeight = Math.max(1, Number(height) || source.height);

    setError('');
    setBusy(true);
    try {
      // Re-rasterise at the requested size; this is also what gives us the
      // RGBA bytes the converter packs.
      const canvas = document.createElement('canvas');
      canvas.width = outWidth;
      canvas.height = outHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.clearRect(0, 0, outWidth, outHeight);
      context.drawImage(source.element, 0, 0, outWidth, outHeight);
      const { data } = context.getImageData(0, 0, outWidth, outHeight);

      const outName = safeCName(name, 'img_asset');
      const { code, stride, dataSize } = await buildImageC({
        imageData: data,
        width: outWidth,
        height: outHeight,
        format: cf,
        outName,
        // ColorPicker gives '#rrggbb'; the packer wants a 24-bit integer.
        background: parseInt(background.replace('#', ''), 16) || 0,
        dither,
      });

      setResult({
        filename: `${outName}.c`,
        code,
        bytes: new Blob([code]).size,
        detail: `${outWidth}×${outHeight} · ${cf} · stride ${stride} B · ${dataSize} B of data`,
      });
      message.success(`${outName}.c generated.`);
    } catch (caught) {
      setError(caught?.message || 'That image could not be converted.');
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const selectedFormat = COLOR_FORMATS.find((option) => option.value === cf);

  return (
    <Row gutter={[16, 16]}>
      <Col span={24} lg={10}>
        <Card title="Source image" bordered={false}>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <label className="mail-file-picker" htmlFor="lvgl-image-upload" style={{ width: '100%' }}>
              <PictureOutlined />
              <span>{source ? `${source.width} × ${source.height}` : 'Select PNG / JPG / WebP'}</span>
            </label>
            <input
              id="lvgl-image-upload"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="mail-file-input"
              onChange={(event) => loadImage(event.target.files?.[0])}
            />

            <Input addonBefore="Name" value={name} onChange={(event) => setName(event.target.value)} />

            <Select
              value={cf}
              onChange={setCf}
              style={{ width: '100%' }}
              options={FORMAT_GROUPS}
            />
            {selectedFormat && <Text type="secondary">{selectedFormat.hint}</Text>}

            <Space style={{ width: '100%' }}>
              <InputNumber
                min={1}
                max={4096}
                value={width}
                onChange={setWidth}
                addonBefore="W"
                disabled={!source}
              />
              <InputNumber
                min={1}
                max={4096}
                value={height}
                onChange={setHeight}
                addonBefore="H"
                disabled={!source}
              />
            </Space>

            {SUPPORTS_DITHER.has(cf) && (
              <Checkbox checked={dither} onChange={(event) => setDither(event.target.checked)}>
                Ordered dithering (RGB565)
              </Checkbox>
            )}

            {FLATTENS_ALPHA.has(cf) && (
              <Space>
                <Text type="secondary">Background</Text>
                <ColorPicker value={background} onChange={(value) => setBackground(value.toHexString())} showText />
                <Text type="secondary">— this format has no alpha</Text>
              </Space>
            )}

            <Button
              type="primary"
              className="vision-btn-primary"
              onClick={run}
              loading={busy}
              block
              disabled={!source}
            >
              Convert image
            </Button>

            {error && <Alert type="error" showIcon message={error} />}
          </Space>
        </Card>

        {source && (
          <Card title="Preview" bordered={false} style={{ marginTop: 16 }}>
            <img src={source.url} alt="Source preview" className="lvgl-image-preview" />
            <Paragraph style={{ marginTop: 12, marginBottom: 0 }}>
              <Text type="secondary">Source {source.width} × {source.height} px</Text>
            </Paragraph>
          </Card>
        )}
      </Col>

      <Col span={24} lg={14}>
        <OutputCard
          title="Generated lv_img_conv output"
          result={result}
          emptyText="Upload an image and convert to generate an LVGL image .c file."
        />
      </Col>
    </Row>
  );
}

export default function LvglToolPage() {
  return (
    <div className="vision-page vision-stack">
      <div className="vision-page-header">
        <div>
          <h1 className="vision-page-title">Tools / LVGL</h1>
          <p className="vision-page-subtitle">
            Convert fonts and images into LVGL-ready C source, using the lv_font_conv and
            lv_img_conv formats.
          </p>
        </div>
      </div>

      <Tabs
        items={[
          {
            key: 'font',
            label: <span><FontSizeOutlined /> Font converter</span>,
            children: <FontConverter />,
          },
          {
            key: 'image',
            label: <span><PictureOutlined /> Image converter</span>,
            children: <ImageConverter />,
          },
        ]}
      />
    </div>
  );
}
