import { useState } from 'react';
import { Alert, Button, Collapse, Form, Input, InputNumber, Select, Switch, message } from 'antd';
import { ApiOutlined } from '@ant-design/icons';
import api from '../../api';
import { useLanguage } from '../../i18n';

/*
 * PTZ configuration for one camera.
 *
 * Folded away by default because most cameras are fixed and none of this
 * applies to them — and because the optics settings underneath are the kind of
 * thing that should be changed on purpose rather than tabbed through.
 *
 * Detect is the important control. ONVIF cameras expose "profiles" (different
 * resolutions and stream settings), and moving one means naming which. Rather
 * than making somebody find the token in the camera's own web interface, the
 * server asks the camera and the answer fills the dropdown.
 */
export default function PtzSettings({ form, cameraId }) {
  const { t } = useLanguage();
  const [profiles, setProfiles] = useState(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState('');

  const detect = async () => {
    // Probing asks the SERVER to talk to the camera, so it needs a saved
    // camera to hang the request on. A camera being created has no id yet.
    if (!cameraId) {
      setProbeError(t('ptzSaveFirst'));
      return;
    }

    setProbing(true);
    setProbeError('');
    try {
      const values = form.getFieldValue('ptz') || {};
      const { data } = await api.post(`/cameras/${cameraId}/ptz/probe`, {
        deviceUrl: values.deviceUrl,
        username: values.username,
        // Blank means "use the stored password"; the form never receives it.
        password: values.password || '',
      });

      setProfiles(data.profiles);
      if (!data.movable) {
        setProbeError(t('ptzNoMovableProfile'));
        return;
      }

      // Preselect the first movable profile: it is the right answer often
      // enough that making the operator choose adds nothing.
      const current = values.profileToken;
      const movable = data.profiles.find((profile) => profile.hasPtz);
      if (!current && movable) {
        form.setFieldValue(['ptz', 'profileToken'], movable.token);
        form.setFieldValue(['ptz', 'profileName'], movable.name);
      }
      message.success(t('ptzDetected', { count: data.profiles.length }));
    } catch (error) {
      setProbeError(error.response?.data?.message || t('ptzProbeFailed'));
    } finally {
      setProbing(false);
    }
  };

  return (
    <Collapse
      ghost
      className="ptz-settings"
      items={[{
        key: 'ptz',
        label: t('ptzAndAttendance'),
        children: (
          <>
            <Form.Item name={['ptz', 'enabled']} label={t('ptzEnable')} valuePropName="checked">
              <Switch />
            </Form.Item>

            <Form.Item
              name={['ptz', 'deviceUrl']}
              label={t('ptzDeviceUrl')}
              extra={t('ptzDeviceUrlHint')}
            >
              <Input placeholder="http://192.168.1.20/onvif/device_service" />
            </Form.Item>

            <div className="ptz-settings-row">
              <Form.Item name={['ptz', 'username']} label={t('ptzUsername')}>
                <Input autoComplete="off" />
              </Form.Item>
              <Form.Item
                name={['ptz', 'password']}
                label={t('ptzPassword')}
                extra={t('ptzPasswordHint')}
              >
                <Input.Password autoComplete="new-password" placeholder="••••••••" />
              </Form.Item>
            </div>

            <div className="ptz-settings-row">
              <Form.Item name={['ptz', 'profileToken']} label={t('ptzProfile')}>
                <Select
                  allowClear
                  placeholder={t('ptzRunDetect')}
                  options={(profiles || []).map((profile) => ({
                    value: profile.token,
                    label: profile.hasPtz ? profile.name : `${profile.name} (${t('ptzFixed')})`,
                    disabled: !profile.hasPtz,
                  }))}
                />
              </Form.Item>
              <Button icon={<ApiOutlined />} loading={probing} onClick={detect} className="ptz-detect">
                {t('ptzDetect')}
              </Button>
            </div>

            {probeError && <Alert type="warning" showIcon message={probeError} className="face-modal-alert" />}

            <Form.Item
              name={['ptz', 'snapshotUrl']}
              label={t('ptzSnapshotUrl')}
              extra={t('ptzSnapshotUrlHint')}
            >
              <Input placeholder="http://192.168.1.20/onvif-http/snapshot" />
            </Form.Item>

            <p className="ptz-optics-note">{t('ptzOpticsNote')}</p>

            <div className="ptz-settings-row">
              <Form.Item
                name={['ptz', 'hfovDegrees']}
                label={t('ptzHfov')}
                extra={t('ptzHfovHint')}
              >
                <InputNumber min={1} max={180} step={1} />
              </Form.Item>
              <Form.Item name={['ptz', 'panRangeDegrees']} label={t('ptzPanRange')}>
                <InputNumber min={1} max={360} step={1} />
              </Form.Item>
            </div>

            <div className="ptz-settings-row">
              <Form.Item name={['ptz', 'maxZoomFactor']} label={t('ptzMaxZoom')}>
                <InputNumber min={1} max={60} step={1} />
              </Form.Item>
              <Form.Item
                name={['ptz', 'homeDegrees']}
                label={t('ptzHome')}
                extra={t('ptzHomeHint')}
              >
                <InputNumber min={-180} max={180} step={1} />
              </Form.Item>
            </div>

            <Form.Item
              name={['ptz', 'settleMs']}
              label={t('ptzSettle')}
              extra={t('ptzSettleHint')}
            >
              <InputNumber min={0} max={10000} step={100} />
            </Form.Item>
          </>
        ),
      }]}
    />
  );
}
