import { Button, Popconfirm, Space, Tooltip } from 'antd';
import {
  CloudDownloadOutlined, DeleteOutlined, ExperimentOutlined, ExportOutlined, MobileOutlined,
} from '@ant-design/icons';
import { useLanguage } from '../../i18n';
import { formatBytes } from '../../lib/mlUpload';

/**
 * Test / ONNX and TFLite export and download / delete, for one row of a models table.
 * `extra` goes before the delete button (Speech to Text puts GGML there).
 * Without `onTest` there is no Test button; `deletable={false}` hides Delete.
 */
export default function ModelActions({
  model, area, busy, onTest, extra = null, deletable = true,
}) {
  const { t } = useLanguage();
  const exporting = busy || area.running;

  return (
    <Space wrap>
      {onTest && <Button size="small" icon={<ExperimentOutlined />} onClick={() => onTest(model)}>{t('trainTest')}</Button>}
      {model.onnxBytes ? (
        <Tooltip title={formatBytes(model.onnxBytes)}>
          <Button size="small" icon={<CloudDownloadOutlined />} onClick={() => area.downloadOnnx(model)}>ONNX</Button>
        </Tooltip>
      ) : null}
      <Tooltip title={model.onnxBytes ? t('onnxExportAgain') : t('onnxExport')}>
        <Button size="small" icon={<ExportOutlined />} disabled={exporting} onClick={() => area.exportOnnx(model)}>
          {model.onnxBytes ? '' : t('onnxExport')}
        </Button>
      </Tooltip>
      {model.tfliteBytes ? (
        <Tooltip title={formatBytes(model.tfliteBytes)}>
          <Button size="small" icon={<CloudDownloadOutlined />} onClick={() => area.downloadTflite(model)}>TFLite</Button>
        </Tooltip>
      ) : null}
      <Tooltip title={model.tfliteBytes ? t('tfliteExportAgain') : t('tfliteExportHelp')}>
        <Button size="small" icon={<MobileOutlined />} disabled={exporting} onClick={() => area.exportTflite(model)}>
          {model.tfliteBytes ? '' : 'TFLite'}
        </Button>
      </Tooltip>
      {extra}
      {deletable && model.kind === 'finetuned' && (
        <Popconfirm title={t('trainDeleteModel')} onConfirm={() => area.removeModel(model)} okButtonProps={{ danger: true }}>
          <Button size="small" danger icon={<DeleteOutlined />} disabled={busy} />
        </Popconfirm>
      )}
    </Space>
  );
}
