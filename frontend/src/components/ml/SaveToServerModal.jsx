import { useEffect, useRef, useState } from 'react';
import {
  Alert, Input, Modal, Progress, Radio, Select, Space, Typography, message,
} from 'antd';
import api from '../../api';
import { useLanguage } from '../../i18n';
import { formatBytes, saveDatasetToServer } from '../../lib/mlUpload';

const { Text } = Typography;

/**
 * "Save to server" for the YOLO and Speech to Text tools: pick or name a
 * server dataset, then upload what it lacks, with progress.
 *
 * `prepare()` is called when the upload starts and returns { files, finish }
 * (see saveDatasetToServer), so the page's current state is what gets sent.
 * `extra` renders above the progress — the speech tool's language picker.
 */
export default function SaveToServerModal({
  open, onClose, area, defaultName, prepare, extra, canSave = true, onSaved,
}) {
  const { t } = useLanguage();
  const [datasets, setDatasets] = useState([]);
  const [mode, setMode] = useState('new');
  const [targetId, setTargetId] = useState(null);
  const [name, setName] = useState('');
  const [progress, setProgress] = useState(null);
  const [busy, setBusy] = useState(false);
  const signal = useRef({ cancelled: false });

  useEffect(() => {
    if (!open) return;
    setProgress(null);
    setName(defaultName || '');
    api.get(`/tools/${area}/datasets`).then(({ data }) => {
      setDatasets(data.datasets || []);
      // Saving the same folder again is the common case: offer to update it.
      const same = (data.datasets || []).find((dataset) => dataset.name === defaultName);
      setMode(same ? 'update' : 'new');
      setTargetId(same?.id || data.datasets?.[0]?.id || null);
    }).catch(() => setDatasets([]));
  }, [open, area, defaultName]);

  const save = async () => {
    if (mode === 'new' && !name.trim()) {
      message.warning(t('mlDatasetNameRequired'));
      return;
    }
    const prepared = prepare();
    if (!prepared) return;
    setBusy(true);
    signal.current = { cancelled: false };
    try {
      const result = await saveDatasetToServer({
        area,
        datasetId: mode === 'update' ? targetId : null,
        name: name.trim(),
        files: prepared.files,
        finish: prepared.finish,
        onProgress: setProgress,
        signal: signal.current,
      });
      message.success(t('mlSavedToServer', { uploaded: result.uploaded, skipped: result.skipped }));
      onSaved?.(result.dataset);
      onClose();
    } catch (error) {
      if (error.message !== 'cancelled') message.error(error.response?.data?.message || t('mlSaveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    if (busy) {
      signal.current.cancelled = true;
      return;
    }
    onClose();
  };

  const percent = progress?.bytesTotal ? Math.floor((progress.bytesDone / progress.bytesTotal) * 100)
    : progress?.phase === 'finishing' ? 100 : 0;

  return (
    <Modal
      open={open}
      title={t('mlSaveToServer')}
      onOk={save}
      onCancel={cancel}
      okText={t('mlSaveToServer')}
      cancelText={busy ? t('mlStopUpload') : t('cancel')}
      okButtonProps={{ loading: busy, disabled: !canSave }}
      maskClosable={!busy}
      closable={!busy}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Text type="secondary">{t('mlSaveToServerHelp')}</Text>
        <Radio.Group value={mode} onChange={(event) => setMode(event.target.value)} disabled={busy}>
          <Radio.Button value="new">{t('mlNewDataset')}</Radio.Button>
          <Radio.Button value="update" disabled={!datasets.length}>{t('mlUpdateDataset')}</Radio.Button>
        </Radio.Group>
        {mode === 'new' ? (
          <Input
            value={name}
            maxLength={120}
            placeholder={t('translationDatasetName')}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
          />
        ) : (
          <Select
            style={{ width: '100%' }}
            value={targetId}
            onChange={setTargetId}
            disabled={busy}
            options={datasets.map((dataset) => ({
              value: dataset.id,
              label: `${dataset.name} (${dataset.fileCount} · ${formatBytes(dataset.bytes || 0)})`,
            }))}
          />
        )}
        {extra}
        {progress && (
          <Space direction="vertical" style={{ width: '100%' }} size={4}>
            <Progress percent={percent} status={busy ? 'active' : undefined} />
            <Text type="secondary">
              {progress.phase === 'checking' && t('mlUploadChecking')}
              {progress.phase === 'uploading' && t('mlUploadProgress', {
                done: progress.done,
                total: progress.total,
                size: `${formatBytes(progress.bytesDone)} / ${formatBytes(progress.bytesTotal)}`,
              })}
              {progress.phase === 'finishing' && t('mlUploadFinishing')}
            </Text>
          </Space>
        )}
        {!canSave && <Alert type="warning" showIcon message={t('mlNothingToSave')} />}
      </Space>
    </Modal>
  );
}
