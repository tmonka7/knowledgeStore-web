import { useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Input, InputNumber, Row, Select, Space, Tabs, Typography, message } from 'antd';
import { CopyOutlined, DownloadOutlined, PictureOutlined, ToolOutlined } from '@ant-design/icons';

const { Paragraph, Text, Title } = Typography;

const rgb565FromPixel = (r, g, b) => ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);

const buildImageArray = (imageData, width, height, format) => {
  const bytes = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const r = imageData[index];
      const g = imageData[index + 1];
      const b = imageData[index + 2];
      const a = imageData[index + 3] ?? 255;

      if (format === 'argb8888') {
        const argb = ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
        bytes.push((argb >>> 0) & 0xff, (argb >>> 8) & 0xff, (argb >>> 16) & 0xff, (argb >>> 24) & 0xff);
      } else {
        const value = rgb565FromPixel(r, g, b);
        bytes.push(value & 0xff, (value >>> 8) & 0xff);
      }
    }
  }

  const hex = bytes.map((byte) => `0x${byte.toString(16).padStart(2, '0').toUpperCase()}`);
  return hex;
};

const buildFontArray = (text, size) => {
  const words = [...(text || 'LVGL')];
  const fontSize = Math.max(8, Number(size) || 12);
  const rows = [];

  words.forEach((char) => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = fontSize;
    canvas.height = fontSize;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000000';
    context.font = `700 ${fontSize}px sans-serif`;
    context.textBaseline = 'middle';
    context.fillText(char, 0, fontSize * 0.72, fontSize);

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const rowBytes = [];

    for (let y = 0; y < canvas.height; y += 1) {
      let bitRow = '';
      for (let x = 0; x < canvas.width; x += 1) {
        const index = (y * canvas.width + x) * 4;
        const alpha = imageData[index + 3] ?? 255;
        bitRow += alpha > 128 ? '1' : '0';
      }

      const padded = bitRow.padEnd(Math.ceil(bitRow.length / 8) * 8, '0');
      for (let i = 0; i < padded.length; i += 8) {
        const nextByte = padded.slice(i, i + 8);
        const value = parseInt(nextByte || '00000000', 2);
        rowBytes.push(value);
      }
    }

    rows.push(...rowBytes);
  });

  const hex = rows.map((value) => `0x${value.toString(16).padStart(2, '0').toUpperCase()}`);
  return {
    width: fontSize,
    height: fontSize,
    bytes: hex,
    preview: words.map((char) => `${char} `).join(''),
  };
};

const labelCase = (value) => value === 'rgb565' ? 'RGB565' : 'ARGB8888';

export default function LvglToolPage() {
  const [imageFormat, setImageFormat] = useState('rgb565');
  const [maxDimension, setMaxDimension] = useState(128);
  const [imageSource, setImageSource] = useState('');
  const [imageMeta, setImageMeta] = useState(null);
  const [imageCode, setImageCode] = useState('');
  const [fontText, setFontText] = useState('LVGL');
  const [fontSize, setFontSize] = useState(16);

  const fontPreview = useMemo(() => buildFontArray(fontText, fontSize), [fontText, fontSize]);
  const fontCode = useMemo(() => {
    const bytes = fontPreview.bytes;
    return [
      `/* Auto-generated LVGL bitmap font for: ${fontText || 'LVGL'} */`,
      'const uint8_t lvgl_font_bitmap[] = {',
      ...bytes.map((value, index) => `  ${value}${index < bytes.length - 1 ? ',' : ''}`),
      '};',
      '',
      `#define LVGL_FONT_WIDTH ${fontPreview.width}`,
      `#define LVGL_FONT_HEIGHT ${fontPreview.height}`,
      `#define LVGL_FONT_BYTES ${bytes.length}`,
    ].join('\n');
  }, [fontPreview, fontText]);

  const copyToClipboard = async (content, successText) => {
    try {
      await navigator.clipboard.writeText(content);
      message.success(successText);
    } catch (error) {
      message.error('Clipboard access is unavailable in this browser.');
    }
  };

  const handleImageUpload = (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxSide = Number(maxDimension) || 128;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        context.drawImage(img, 0, 0, width, height);

        const imageData = context.getImageData(0, 0, width, height).data;
        const code = buildImageArray(imageData, width, height, imageFormat);
        const lines = [
          `const uint8_t lvgl_image_data[] = {`,
          ...code.map((value, index) => `  ${value}${index < code.length - 1 ? ',' : ''}`),
          '};',
          '',
          `#define LVGL_IMG_WIDTH ${width}`,
          `#define LVGL_IMG_HEIGHT ${height}`,
          `#define LVGL_IMG_FORMAT ${labelCase(imageFormat)}`,
        ].join('\n');

        setImageSource(reader.result);
        setImageMeta({ width, height, format: imageFormat });
        setImageCode(lines);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="vision-page vision-stack">
      <div className="vision-page-header">
        <div>
          <h1 className="vision-page-title">Tools / LVGL image/font converter</h1>
          <p className="vision-page-subtitle">Create LVGL-ready C arrays for image assets and bitmap font data.</p>
        </div>
      </div>

      <Tabs
        items={[
          {
            key: 'image',
            label: (
              <span>
                <PictureOutlined /> Image converter
              </span>
            ),
            children: (
              <Row gutter={[16, 16]}>
                <Col span={24} lg={12}>
                  <Card title="Upload source image" bordered={false}>
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <label className="mail-file-picker" htmlFor="lvgl-image-upload" style={{ width: '100%' }}>
                        <DownloadOutlined />
                        <span>Select image</span>
                      </label>
                      <input
                        id="lvgl-image-upload"
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleImageUpload}
                        style={{ display: 'none' }}
                      />

                      <Select
                        value={imageFormat}
                        onChange={setImageFormat}
                        options={[
                          { value: 'rgb565', label: 'RGB565' },
                          { value: 'argb8888', label: 'ARGB8888' },
                        ]}
                        style={{ width: '100%' }}
                      />

                      <InputNumber
                        min={32}
                        max={512}
                        step={16}
                        value={maxDimension}
                        onChange={(value) => setMaxDimension(value || 128)}
                        style={{ width: '100%' }}
                        addonBefore="Max size"
                      />

                      <Button type="primary" onClick={() => copyToClipboard(imageCode, 'Image array copied to clipboard.')}>Copy C array</Button>
                    </Space>
                  </Card>
                </Col>

                <Col span={24} lg={12}>
                  <Card title="Preview" bordered={false}>
                    {imageSource ? (
                      <img src={imageSource} alt="LVGL preview" style={{ maxWidth: '100%', borderRadius: 12, border: '1px solid #e3ecf5', background: '#f8fbff' }} />
                    ) : (
                      <Alert type="info" showIcon message="Upload a PNG or JPG to generate LVGL-ready image data." />
                    )}
                    {imageMeta && (
                      <Paragraph style={{ marginTop: 16 }}>
                        <Text strong>{imageMeta.width}</Text> × <Text strong>{imageMeta.height}</Text> px · <Text strong>{labelCase(imageMeta.format)}</Text>
                      </Paragraph>
                    )}
                  </Card>
                </Col>

                <Col span={24}>
                  <Card title="Generated C code" bordered={false}>
                    <pre style={{ margin: 0, background: '#f6f8fb', borderRadius: 12, padding: 16, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                      {imageCode || 'No image data generated yet.'}
                    </pre>
                  </Card>
                </Col>
              </Row>
            ),
          },
          {
            key: 'font',
            label: (
              <span>
                <ToolOutlined /> Font converter
              </span>
            ),
            children: (
              <Row gutter={[16, 16]}>
                <Col span={24} lg={12}>
                  <Card title="Bitmap font generator" bordered={false}>
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <Input
                        value={fontText}
                        onChange={(event) => setFontText(event.target.value)}
                        placeholder="Enter characters for the bitmap font"
                      />

                      <InputNumber
                        min={8}
                        max={64}
                        step={2}
                        value={fontSize}
                        onChange={(value) => setFontSize(value || 16)}
                        style={{ width: '100%' }}
                        addonBefore="Font size"
                      />

                      <Button type="primary" onClick={() => copyToClipboard(fontCode, 'Font array copied to clipboard.') }>
                        Copy C array
                      </Button>
                    </Space>
                  </Card>
                </Col>

                <Col span={24} lg={12}>
                  <Card title="Preview" bordered={false}>
                    <div style={{ minHeight: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12, background: '#f8fbff', border: '1px solid #e3ecf5' }}>
                      <Title level={4} style={{ margin: 0, letterSpacing: 1 }}>{fontPreview.preview}</Title>
                    </div>
                  </Card>
                </Col>

                <Col span={24}>
                  <Card title="Generated font C code" bordered={false}>
                    <pre style={{ margin: 0, background: '#f6f8fb', borderRadius: 12, padding: 16, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                      {fontCode || 'No font data generated yet.'}
                    </pre>
                  </Card>
                </Col>
              </Row>
            ),
          },
        ]}
      />
    </div>
  );
}
