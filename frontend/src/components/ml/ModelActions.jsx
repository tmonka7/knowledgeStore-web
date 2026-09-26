import { Button, Popconfirm, Space, Tooltip } from 'antd';
import {
  CloudDownloadOutlined, DeleteOutlined, ExperimentOutlined, ExportOutlined,
} from '@ant-design/icons';
import { useLanguage } from '../../i18n';
import { formatBytes } from '../../lib/mlUpload';

/** Test / ONNX export and download / delete, for one row of a models table. */
export default function ModelActions({ model, area, busy, onTest }) {
  const { t } = useLanguage();
  const exporting = busy || area.running;

  return (
    <Space wrap>
      <Button size="small" icon={<ExperimentOutlined />} onClick={() => onTest(model)}>{t('trainTest')}</Button>
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
      {model.kind === 'finetuned' && (
        <Popconfirm title={t('trainDeleteModel')} onConfirm={() => area.removeModel(model)} okButtonProps={{ danger: true }}>
          <Button size="small" danger icon={<DeleteOutlined />} disabled={busy} />
        </Popconfirm>
      )}
    </Space>
  );
}
