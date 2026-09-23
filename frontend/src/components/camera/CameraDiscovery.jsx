import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Empty, Input, List, Modal, Space, Spin, Tag } from 'antd';
import { RadarChartOutlined } from '@ant-design/icons';
import api from '../../api';
import { useLanguage } from '../../i18n';

/*
 * "Which cameras are on this network?"
 *
 * The server does the looking — a browser cannot send a multicast probe or
 * knock on 254 addresses, and neither is something a page should be doing to
 * an operator's own network without being asked. This dialog asks, shows what
 * answered, and hands one of them to the ordinary Add form.
 *
 * Nothing here creates a camera. A discovered device becomes a camera only
 * once a person has given it a name, a place and a password, which is also why
 * the result rows offer "add" rather than saving in place: the search knows
 * the two fields a person cannot easily find out, and a person knows the
 * three the network cannot tell us.
 */

/* The PTZ defaults a new camera gets, matching the blank Add form's. */
const PTZ_DEFAULTS = {
  enabled: true,
  username: '',
  password: '',
  panRangeDegrees: 360,
  hfovDegrees: 65,
  maxZoomFactor: 20,
  homeDegrees: 0,
  settleMs: 900,
};

export default function CameraDiscovery({ open, onClose, onSelect }) {
  const { t } = useLanguage();
  const [searching, setSearching] = useState(false);
  // null until a search has run, so "nothing found" is only said once it is
  // actually true rather than on an untouched dialog.
  const [found, setFound] = useState(null);
  const [error, setError] = useState('');
  const [deep, setDeep] = useState(false);
  const [subnet, setSubnet] = useState('');
  const [sweptSubnet, setSweptSubnet] = useState('');

  const search = useCallback(async (withSweep) => {
    setSearching(true);
    setError('');
    try {
      const { data } = await api.post('/cameras/discover', {
        sweep: Boolean(withSweep),
        subnet: subnet.trim(),
      });
      setFound(data.cameras || []);
      setSweptSubnet(data.sweptSubnet || '');
      // The subnet the server would sweep, shown in the box so the slow search
      // is one click rather than a guess about the network's addressing.
      if (!subnet && data.defaultSubnet) setSubnet(data.defaultSubnet);
    } catch (requestFailed) {
      setError(requestFailed.response?.data?.message || t('cameraScanFailed'));
      setFound([]);
    } finally {
      setSearching(false);
    }
  }, [subnet, t]);

  /*
   * The quick search runs as the dialog opens. It is a couple of UDP packets
   * and a few seconds of listening, and an operator who opened a dialog called
   * "search the network" has already said what they want. The subnet sweep is
   * never automatic — it is hundreds of connections to other people's devices,
   * and that is a button somebody presses.
   */
  useEffect(() => {
    if (!open) return;
    setFound(null);
    setError('');
    setDeep(false);
    setSweptSubnet('');
    search(false);
    // Only on opening: `search` changes with the subnet box, and refiring on
    // every keystroke would search the network while somebody is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const addCamera = (camera) => {
    onSelect({
      name: camera.name || '',
      location: camera.location || '',
      // The stream address is the one thing discovery cannot know: ONVIF
      // reports a control channel, not a video URL. The camera's address is
      // the honest starting point, and it is what the frame proxy falls back
      // to anyway.
      address: camera.address,
      status: 'online',
      notes: camera.hardware ? `${camera.hardware}` : '',
      ptz: { ...PTZ_DEFAULTS, deviceUrl: camera.deviceUrl },
    });
  };

  const rowTags = (camera) => (
    <Space size={4} wrap>
      {camera.existing && <Tag color="default">{t('cameraScanAlreadyAdded')}</Tag>}
      {camera.source === 'sweep' && <Tag color="blue">{t('cameraScanFoundBySweep')}</Tag>}
      {camera.needsCredentials && <Tag color="orange">{t('cameraScanNeedsLogin')}</Tag>}
    </Space>
  );

  return (
    <Modal
      title={t('cameraScanTitle')}
      open={open}
      onCancel={onClose}
      footer={<Button onClick={onClose}>{t('close')}</Button>}
      width={640}
    >
      <p>{t('cameraScanNote')}</p>

      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Checkbox checked={deep} onChange={(event) => setDeep(event.target.checked)} disabled={searching}>
          {t('cameraScanDeep')}
        </Checkbox>

        {deep && (
          <Input
            value={subnet}
            onChange={(event) => setSubnet(event.target.value)}
            placeholder={t('cameraScanSubnetPlaceholder')}
            disabled={searching}
          />
        )}

        <Button
          type="primary"
          className="vision-btn-primary"
          icon={<RadarChartOutlined />}
          loading={searching}
          onClick={() => search(deep)}
        >
          {found === null ? t('cameraScanStart') : t('cameraScanAgain')}
        </Button>
      </Space>

      {error && <Alert type="error" showIcon message={error} className="face-modal-alert" />}

      {searching && (
        <div style={{ padding: '24px 0', textAlign: 'center' }}>
          <Spin tip={deep ? t('cameraScanSweeping') : t('cameraScanListening')}>
            <div style={{ padding: 12 }} />
          </Spin>
        </div>
      )}

      {!searching && found !== null && (
        found.length ? (
          <>
            <List
              itemLayout="horizontal"
              dataSource={found}
              renderItem={(camera) => (
                <List.Item
                  actions={[
                    <Button
                      key="add"
                      type="link"
                      disabled={camera.existing}
                      onClick={() => addCamera(camera)}
                    >
                      {t('add')}
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    title={(
                      <Space size={8} wrap>
                        <span>{camera.name || camera.address}</span>
                        {rowTags(camera)}
                      </Space>
                    )}
                    description={camera.name ? `${camera.address} — ${camera.deviceUrl}` : camera.deviceUrl}
                  />
                </List.Item>
              )}
            />
            <p>{t('cameraScanAddHint')}</p>
          </>
        ) : (
          <Empty
            description={
              /*
               * Two different silences. A quick search finding nothing usually
               * means multicast was dropped rather than that the network is
               * empty, and saying so points at the sweep; a sweep finding
               * nothing on a subnet really is an empty subnet.
               */
              sweptSubnet ? t('cameraScanNothingFound') : t('cameraScanNothingDiscovered')
            }
          />
        )
      )}
    </Modal>
  );
}
