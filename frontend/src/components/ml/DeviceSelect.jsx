import { useCallback, useEffect, useState } from 'react';
import { Button, Select, Space, Tooltip, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import api from '../../api';
import { useLanguage } from '../../i18n';

const { Text } = Typography;

/**
 * Where to train: automatic, the CPU, or a particular GPU — as the server's
 * PyTorch sees them (GET <base>/devices). When no GPU is usable the reason is
 * shown, since "PyTorch was installed without CUDA" is fixed very differently
 * from "there is no NVIDIA driver".
 */
export default function DeviceSelect({ base, value, onChange }) {
  const { t } = useLanguage();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const { data } = await api.get(`${base}/devices`, { params: refresh ? { refresh: 1 } : {}, timeout: 0 });
      setInfo(data);
    } catch (error) {
      setInfo({ devices: [], mps: false, reason: error.response?.data?.message || error.message });
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => { load(); }, [load]);

  const gpus = info?.devices || [];
  const hasGpu = gpus.length > 0 || info?.mps;

  // A GPU chosen earlier that has since gone (or a fresh page) falls back to auto.
  useEffect(() => {
    if (!info) return;
    const known = ['auto', 'cpu', ...gpus.map((gpu) => gpu.id), ...(info.mps ? ['mps'] : [])];
    if (!known.includes(value)) onChange('auto');
  }, [info]); // eslint-disable-line react-hooks/exhaustive-deps

  const options = [
    {
      value: 'auto',
      label: gpus.length ? t('deviceAutoGpu', { name: gpus[0].name })
        : info?.mps ? t('deviceAutoMps') : t('deviceAutoCpu'),
    },
    { value: 'cpu', label: t('deviceCpu') },
    ...gpus.map((gpu, index) => ({
      value: gpu.id,
      label: `${t('deviceGpu', { index })} · ${gpu.name} · ${gpu.memoryGb} GB`,
    })),
    ...(info?.mps ? [{ value: 'mps', label: t('deviceMps') }] : []),
    ...(info && !hasGpu ? [{ value: 'none', label: t('deviceNoGpu'), disabled: true }] : []),
  ];

  return (
    <Space direction="vertical" size={2} style={{ width: '100%' }}>
      <Space.Compact style={{ width: '100%' }}>
        <Select style={{ width: '100%' }} value={value} onChange={onChange} options={options} loading={loading} />
        <Tooltip title={t('deviceCheckAgain')}>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => load(true)} />
        </Tooltip>
      </Space.Compact>
      {info && !hasGpu && info.reason && (
        <Text type="secondary" style={{ fontSize: 12 }}>{info.reason}</Text>
      )}
    </Space>
  );
}
