import { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Empty, Form, Input, List, Modal, Popconfirm, Progress, Space, Table, Tag, Tooltip, Typography,
} from 'antd';
import {
  DeleteOutlined, EditOutlined, PauseCircleOutlined, PlayCircleOutlined, PlusOutlined, UserAddOutlined,
} from '@ant-design/icons';
import ClipRecorder from './ClipRecorder';
import OwnerTag from '../ml/OwnerTag';
import { speakerColor } from './useSpeakers';
import { useLanguage } from '../../i18n';

const { Text } = Typography;

// How much speech makes a dependable voiceprint: ECAPA is usable from a few
// seconds, and gets steadier with more — and with more than one recording.
const GOOD_SECONDS = 20;

/**
 * Enrolled speakers: add, rename, delete, and give each a few voice samples.
 * Speakers are shared: anyone adds samples; renaming and deleting a speaker
 * is for whoever created it (or an administrator).
 */
export default function SpeakersPanel({ area }) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(null); // speaker, or {} for a new one
  const [enrolling, setEnrolling] = useState(null);

  const columns = [
    {
      title: t('speakerName'),
      key: 'name',
      render: (_, speaker) => (
        <Space direction="vertical" size={0}>
          <Space>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: speakerColor(speaker.id) }} />
            <Text strong>{speaker.name}</Text>
            <OwnerTag item={speaker} />
          </Space>
          {speaker.note && <Text type="secondary" style={{ fontSize: 12 }}>{speaker.note}</Text>}
        </Space>
      ),
    },
    {
      title: t('speakerVoice'),
      key: 'voice',
      width: 240,
      render: (_, speaker) => {
        const usable = speaker.samples.filter((sample) => sample.current);
        const seconds = usable.reduce((sum, sample) => sum + sample.speechSeconds, 0);
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Progress
              percent={Math.min(100, Math.round((seconds / GOOD_SECONDS) * 100))}
              size="small"
              status={usable.length ? 'normal' : 'exception'}
              format={() => `${seconds.toFixed(0)} s`}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {usable.length
                ? t('speakerSamplesCount', { count: usable.length })
                : t('speakerNotEnrolled')}
              {usable.length > 0 && (seconds < GOOD_SECONDS || usable.length < 3) ? ` · ${t('speakerAddMore')}` : ''}
            </Text>
          </Space>
        );
      },
    },
    {
      key: 'actions',
      width: 240,
      render: (_, speaker) => (
        <Space wrap>
          <Button size="small" type="primary" icon={<PlusOutlined />} disabled={!area.ready} onClick={() => setEnrolling(speaker)}>
            {t('speakerAddSample')}
          </Button>
          {speaker.canManage && (
            <>
              <Tooltip title={t('speakerEdit')}>
                <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(speaker)} />
              </Tooltip>
              <Popconfirm title={t('speakerDeleteConfirm', { name: speaker.name })} onConfirm={() => area.remove(speaker)} okButtonProps={{ danger: true }}>
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card
      bordered={false}
      title={t('speakerSpeakers')}
      extra={<Button type="primary" icon={<UserAddOutlined />} onClick={() => setEditing({})}>{t('speakerNew')}</Button>}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert type="info" showIcon message={t('speakerEnrollHelp')} />
        <Table
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={area.speakers}
          loading={area.loading}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: <Empty description={t('speakerNone')} /> }}
          expandable={{
            rowExpandable: (speaker) => speaker.samples.length > 0,
            expandedRowRender: (speaker) => <SampleList speaker={speaker} area={area} />,
          }}
        />
      </Space>

      <SpeakerForm speaker={editing} area={area} onClose={() => setEditing(null)} onCreated={setEnrolling} />
      <EnrollModal speaker={enrolling} area={area} onClose={() => setEnrolling(null)} />
    </Card>
  );
}

function SpeakerForm({ speaker, area, onClose, onCreated }) {
  const { t } = useLanguage();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const isNew = speaker && !speaker.id;

  useEffect(() => {
    if (speaker) form.setFieldsValue({ name: speaker.name || '', note: speaker.note || '' });
  }, [speaker, form]);

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    if (isNew) {
      const created = await area.create(values);
      setSaving(false);
      if (created) {
        onClose();
        onCreated(created); // straight on to recording the first sample
      }
    } else {
      await area.update(speaker, values);
      setSaving(false);
      onClose();
    }
  };

  return (
    <Modal
      open={Boolean(speaker)}
      title={isNew ? t('speakerNew') : t('speakerEdit')}
      onCancel={onClose}
      onOk={save}
      okText={isNew ? t('speakerCreateAndRecord') : t('save')}
      confirmLoading={saving}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label={t('speakerName')} rules={[{ required: true, whitespace: true, message: t('speakerNameRequired') }]}>
          <Input maxLength={120} autoFocus />
        </Form.Item>
        <Form.Item name="note" label={t('speakerNote')}>
          <Input maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** Record or upload voice samples for one speaker, one after another. */
function EnrollModal({ speaker, area, onClose }) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const current = area.speakers.find((item) => item.id === speaker?.id) || speaker;

  const add = async (clip, source) => {
    setBusy(true);
    await area.addSample(current, clip, source);
    setBusy(false);
  };

  const usable = current?.samples?.filter((sample) => sample.current) || [];
  return (
    <Modal open={Boolean(speaker)} title={current ? t('speakerEnrollTitle', { name: current.name }) : ''} onCancel={onClose} footer={<Button onClick={onClose}>{t('done')}</Button>} destroyOnClose>
      {current && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Text>{t('speakerEnrollSteps')}</Text>
          <ClipRecorder onClip={add} busy={busy} disabled={!area.ready || busy} maxSeconds={15} hint={t('speakerEnrollHint')} />
          <Text type="secondary">
            {t('speakerEnrolledSoFar', {
              count: usable.length,
              seconds: usable.reduce((sum, sample) => sum + sample.speechSeconds, 0).toFixed(0),
            })}
          </Text>
          {usable.length > 0 && <SampleList speaker={current} area={area} />}
        </Space>
      )}
    </Modal>
  );
}

/** A speaker's samples, each playable and removable. */
function SampleList({ speaker, area }) {
  const { t } = useLanguage();
  const [playing, setPlaying] = useState(null); // { id, audio, url }

  const stop = () => {
    if (!playing) return;
    playing.audio.pause();
    URL.revokeObjectURL(playing.url);
    setPlaying(null);
  };
  useEffect(() => () => {
    if (playing) {
      playing.audio.pause();
      URL.revokeObjectURL(playing.url);
    }
  }, [playing]);

  const play = async (sample) => {
    stop();
    try {
      const url = await area.sampleUrl(sample);
      const audio = new Audio(url);
      audio.onended = () => setPlaying((current) => (current?.id === sample.id ? null : current));
      setPlaying({ id: sample.id, audio, url });
      await audio.play();
    } catch {
      // The file is gone; the row stays so it can be deleted.
    }
  };

  return (
    <List
      size="small"
      dataSource={speaker.samples}
      renderItem={(sample) => (
        <List.Item
          actions={[
            playing?.id === sample.id
              ? <Button key="stop" size="small" icon={<PauseCircleOutlined />} onClick={stop} />
              : <Button key="play" size="small" icon={<PlayCircleOutlined />} onClick={() => play(sample)} />,
            sample.canDelete && (
              <Popconfirm key="delete" title={t('speakerDeleteSample')} onConfirm={() => area.removeSample(speaker, sample)} okButtonProps={{ danger: true }}>
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            ),
          ].filter(Boolean)}
        >
          <Space wrap size={6}>
            <Text>{new Date(sample.createdAt).toLocaleString()}</Text>
            <Tag>{t('speakerSpeechSeconds', { seconds: sample.speechSeconds.toFixed(1) })}</Tag>
            {sample.source && <Text type="secondary" style={{ fontSize: 12 }}>{sample.source}</Text>}
            {!sample.current && <Tag color="gold">{t('speakerOldModel')}</Tag>}
          </Space>
        </List.Item>
      )}
    />
  );
}
