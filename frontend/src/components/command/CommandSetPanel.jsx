import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Badge, Button, Card, Col, Empty, Input, List, Modal, Popconfirm, Row, Segmented, Select, Space, Table, Tag,
  Tooltip, Typography, message,
} from 'antd';
import {
  DeleteOutlined, FolderOpenOutlined, PlusOutlined, ReloadOutlined, SoundOutlined,
} from '@ant-design/icons';
import api from '../../api';
import ClipRecorder from '../speaker/ClipRecorder';
import OwnerTag from '../ml/OwnerTag';
import { useLanguage } from '../../i18n';
import {
  COMMAND_LANGUAGES, STARTER_SETS, commandLanguageLabel, newCommandId, splitPhrases,
} from '../../lib/commandSets';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

const BASE = '/tools/command/datasets';
const MAX_CLIP_SECONDS = 8;
// Enough recordings of each command for training to help; it works with fewer.
const GOOD_PER_COMMAND = 10;

const clock = (seconds) => {
  const total = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const errorMessage = (error, fallback) => error.response?.data?.message || fallback;

/**
 * Commands (Speech to Command): command sets — commands, each with the
 * phrases that say it — and recordings of people saying them, made here with
 * the microphone or from files. Recognising commands needs only the set;
 * the recordings are what Train fine-tunes Moonshine on. Every recording is
 * sent to the server as soon as it is made.
 */
export default function CommandSetPanel({ onChanged }) {
  const { t } = useLanguage();
  const [sets, setSets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(BASE);
      setSets(data.datasets || []);
    } catch (error) {
      message.error(errorMessage(error, t('mlDatasetsLoadFailed')));
    } finally {
      setLoading(false);
    }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const changed = () => {
    load();
    onChanged?.();
  };

  const remove = async (item) => {
    try {
      await api.delete(`${BASE}/${item.id}`);
      if (openId === item.id) setOpenId('');
      changed();
    } catch (error) {
      message.error(errorMessage(error, t('cmdSaveFailed')));
    }
  };

  const columns = [
    {
      title: t('cmdSet'),
      dataIndex: 'name',
      render: (name, item) => <Space size={6} wrap><a onClick={() => setOpenId(item.id)}>{name}</a><OwnerTag item={item} /></Space>,
    },
    { title: t('mlSpokenLanguage'), dataIndex: 'language', render: (language) => <Tag>{language}</Tag> },
    { title: t('cmdCommands'), dataIndex: 'commandCount' },
    { title: t('cmdRecordings'), key: 'recorded', render: (_, item) => `${item.recorded || 0} · ${clock(item.seconds)}` },
    {
      title: '',
      key: 'actions',
      render: (_, item) => (
        <Space>
          <Button size="small" icon={<FolderOpenOutlined />} onClick={() => setOpenId(item.id)}>{t('voiceDsOpen')}</Button>
          {item.canManage && (
            <Popconfirm title={t('cmdDeleteSetConfirm', { name: item.name })} onConfirm={() => remove(item)} okButtonProps={{ danger: true }}>
              <Button size="small" danger icon={<DeleteOutlined />} aria-label={t('delete')} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        bordered={false}
        title={t('cmdSetsTitle')}
        extra={(
          <Space>
            <Tooltip title={t('translationReload')}>
              <Button icon={<ReloadOutlined />} loading={loading} onClick={load} />
            </Tooltip>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>{t('cmdNewSet')}</Button>
          </Space>
        )}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Paragraph type="secondary" style={{ margin: 0 }}>{t('cmdSetsHelp')}</Paragraph>
          <Table
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={sets}
            loading={loading}
            pagination={false}
            rowClassName={(item) => (item.id === openId ? 'ant-table-row-selected' : '')}
            locale={{ emptyText: <Empty description={t('cmdNoSets')} /> }}
            scroll={{ x: 'max-content' }}
          />
        </Space>
      </Card>

      {openId && <SetEditor key={openId} id={openId} onClose={() => setOpenId('')} onChanged={changed} />}

      <CreateModal
        open={creating}
        onCancel={() => setCreating(false)}
        onCreated={(item) => {
          setCreating(false);
          setOpenId(item.id);
          changed();
        }}
      />
    </Space>
  );
}

/** New command set: a name, the language, and the starter commands for it or none. */
function CreateModal({ open, onCancel, onCreated }) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('en');
  const [start, setStart] = useState('starter');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setLanguage('en');
    setStart('starter');
  }, [open]);

  const starter = STARTER_SETS[language] || [];
  const create = async () => {
    setSaving(true);
    try {
      const { data } = await api.post(BASE, {
        name: name.trim() || t('cmdUntitled'),
        language,
        commands: start === 'starter' ? starter : [],
      });
      onCreated(data.dataset);
    } catch (error) {
      message.error(errorMessage(error, t('cmdSaveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t('cmdNewSet')}
      onCancel={onCancel}
      onOk={create}
      okText={t('cmdCreate')}
      okButtonProps={{ loading: saving }}
      destroyOnClose
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <div>
          <Text type="secondary">{t('cmdSetName')}</Text>
          <Input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder={t('cmdUntitled')} />
        </div>
        <div>
          <Text type="secondary">{t('mlSpokenLanguage')}</Text>
          <Select
            style={{ width: '100%' }}
            value={language}
            onChange={setLanguage}
            options={COMMAND_LANGUAGES.map(([code]) => ({ value: code, label: commandLanguageLabel(code) }))}
          />
        </div>
        <Segmented
          value={starter.length ? start : 'empty'}
          onChange={setStart}
          options={[
            { value: 'starter', label: t('cmdStartExamples'), disabled: !starter.length },
            { value: 'empty', label: t('cmdStartEmpty') },
          ]}
        />
        {start === 'starter' && starter.length > 0 && (
          <Text type="secondary" style={{ fontSize: 12 }}>{starter.map((command) => command.name).join(' · ')}</Text>
        )}
      </Space>
    </Modal>
  );
}

/**
 * One command set: its commands on the left, the chosen command on the
 * right — its name and phrases, and its recordings, with a recorder that
 * moves through the phrases so each gets said.
 */
function SetEditor({ id, onClose, onChanged }) {
  const { t } = useLanguage();
  const [set, setSet] = useState(null);
  const [commandId, setCommandId] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ name: '', phrases: '' });
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [playing, setPlaying] = useState({ id: '', url: '' });

  const commands = set?.commands || [];
  const command = commands.find((item) => item.id === commandId) || null;
  const clips = (set?.clips || []).filter((clip) => clip.command === commandId);
  const countOf = (idOf) => (set?.clips || []).filter((clip) => clip.command === idOf).length;

  useEffect(() => {
    let alive = true;
    api.get(`${BASE}/${id}`)
      .then(({ data }) => {
        if (!alive) return;
        setSet(data.dataset);
        setCommandId(data.dataset.commands[0]?.id || '');
      })
      .catch((error) => {
        message.error(errorMessage(error, t('cmdLoadFailed')));
        onClose();
      });
    return () => { alive = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setDraft({ name: command?.name || '', phrases: (command?.phrases || []).join('\n') });
    setPhraseIndex(0);
  }, [command?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The object URL of the recording being played, released when another is played or the editor goes.
  useEffect(() => () => { if (playing.url) URL.revokeObjectURL(playing.url); }, [playing.url]);

  const saveCommands = async (next) => {
    setBusy(true);
    try {
      const { data } = await api.put(`${BASE}/${id}`, { commands: next });
      setSet(data.dataset);
      onChanged();
      return data.dataset;
    } catch (error) {
      message.error(errorMessage(error, t('cmdSaveFailed')));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = () => {
    if (!command) return;
    const phrases = splitPhrases(draft.phrases);
    const name = draft.name.replace(/\s+/g, ' ').trim() || command.name;
    if (name === command.name && phrases.join('\n') === command.phrases.join('\n')) return;
    saveCommands(commands.map((item) => (item.id === command.id ? { ...item, name, phrases: phrases.length ? phrases : [name] } : item)));
  };

  const addCommand = async () => {
    const created = { id: newCommandId(), name: t('cmdNewCommandName', { number: commands.length + 1 }), phrases: [] };
    const next = await saveCommands([...commands, { ...created, phrases: [created.name] }]);
    if (next) setCommandId(created.id);
  };

  const removeCommand = async () => {
    const next = await saveCommands(commands.filter((item) => item.id !== command.id));
    if (next) setCommandId(next.commands[0]?.id || '');
  };

  const phrases = command?.phrases?.length ? command.phrases : [command?.name || ''];
  const phrase = phrases[phraseIndex % phrases.length];

  const record = async (clip) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('audio', clip.blob, 'clip.wav');
      form.append('command', command.id);
      form.append('text', phrase);
      const { data } = await api.post(`${BASE}/${id}/clips`, form);
      setSet(data.dataset);
      setPhraseIndex((value) => value + 1);
      onChanged();
    } catch (error) {
      message.error(errorMessage(error, t('cmdSaveFailed')));
    } finally {
      setBusy(false);
    }
  };

  const removeClip = async (clip) => {
    try {
      const { data } = await api.delete(`${BASE}/${id}/clips/${clip.id}`);
      setSet(data.dataset);
      onChanged();
    } catch (error) {
      message.error(errorMessage(error, t('cmdSaveFailed')));
    }
  };

  const play = async (clip) => {
    try {
      const { data } = await api.get(`${BASE}/${id}/clips/${clip.id}`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      setPlaying({ id: clip.id, url });
      new Audio(url).play().catch(() => {});
    } catch (error) {
      message.error(errorMessage(error, t('cmdLoadFailed')));
    }
  };

  if (!set) return <Card bordered={false} loading />;

  const thin = commands.filter((item) => countOf(item.id) < GOOD_PER_COMMAND).length;
  // Shared sets: the commands are the creator's (or an administrator's) to
  // change; anyone adds recordings, and deletes their own.
  const manage = Boolean(set.canManage);

  return (
    <Card
      bordered={false}
      title={(
        <Space wrap>
          <span>{set.name}</span>
          <Tag color="blue">{commandLanguageLabel(set.language)}</Tag>
          <OwnerTag item={set} />
        </Space>
      )}
      extra={<Button onClick={onClose}>{t('close')}</Button>}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Row gutter={[16, 8]} align="middle">
          <Col xs={24} md={12}>
            <Text type="secondary">
              {t('cmdProgress', { commands: commands.length, recordings: set.clips.length, duration: clock(set.seconds) })}
            </Text>
          </Col>
          <Col xs={24} md={12}>
            {commands.length > 0 && (thin
              ? <Alert type="info" showIcon message={t('cmdAim', { count: GOOD_PER_COMMAND, thin })} />
              : <Alert type="success" showIcon message={t('cmdEnough')} />)}
          </Col>
        </Row>

        {!manage && <Alert type="info" showIcon message={t('cmdSharedNote', { name: set.ownerName || t('unknownPerson') })} />}

        <Row gutter={[16, 16]}>
          <Col xs={24} lg={8}>
            <List
              size="small"
              bordered
              className="voice-ds-lines"
              dataSource={commands}
              locale={{ emptyText: t('cmdNoCommands') }}
              renderItem={(item) => (
                <List.Item
                  onClick={() => setCommandId(item.id)}
                  className={item.id === commandId ? 'is-current' : ''}
                  style={{ cursor: 'pointer' }}
                >
                  <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                    <Text strong={item.id === commandId}>{item.name}</Text>
                    <Badge
                      count={countOf(item.id)}
                      showZero
                      color={countOf(item.id) >= GOOD_PER_COMMAND ? '#52c41a' : countOf(item.id) ? '#faad14' : '#bfbfbf'}
                    />
                  </Space>
                </List.Item>
              )}
            />
            {manage && (
              <Button block type="dashed" icon={<PlusOutlined />} style={{ marginTop: 8 }} onClick={addCommand} disabled={busy}>
                {t('cmdAddCommand')}
              </Button>
            )}
          </Col>

          <Col xs={24} lg={16}>
            {command ? (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Row gutter={12}>
                  <Col xs={24} md={9}>
                    <Text type="secondary">{t('cmdCommandName')}</Text>
                    <Input
                      value={draft.name}
                      maxLength={80}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      onBlur={manage ? saveDraft : undefined}
                      readOnly={!manage}
                    />
                  </Col>
                  <Col xs={24} md={15}>
                    <Text type="secondary">{t('cmdPhrases')}</Text>
                    <TextArea
                      autoSize={{ minRows: 2, maxRows: 6 }}
                      value={draft.phrases}
                      onChange={(event) => setDraft({ ...draft, phrases: event.target.value })}
                      onBlur={manage ? saveDraft : undefined}
                      readOnly={!manage}
                      placeholder={t('cmdPhrasesPlaceholder')}
                    />
                  </Col>
                </Row>

                <div className="cmd-say">
                  <Text type="secondary">{t('cmdSayThis', { number: clips.length + 1 })}</Text>
                  <div className="voice-ds-sentence cmd-say-phrase">{phrase}</div>
                </div>
                <ClipRecorder
                  onClip={record}
                  busy={busy}
                  maxSeconds={MAX_CLIP_SECONDS}
                  allowFile
                  hint={t('cmdRecordHint', { seconds: MAX_CLIP_SECONDS })}
                />

                <List
                  size="small"
                  header={<Text strong>{t('cmdRecordingsOf', { count: clips.length })}</Text>}
                  dataSource={[...clips].reverse()}
                  locale={{ emptyText: t('cmdNoRecordings') }}
                  renderItem={(clip) => (
                    <List.Item
                      actions={[
                        <Button
                          key="play"
                          size="small"
                          type={playing.id === clip.id ? 'primary' : 'default'}
                          icon={<SoundOutlined />}
                          onClick={() => play(clip)}
                          aria-label={t('cmdPlay')}
                        />,
                        clip.canDelete && (
                          <Button key="delete" size="small" danger icon={<DeleteOutlined />} onClick={() => removeClip(clip)} aria-label={t('delete')} />
                        ),
                      ].filter(Boolean)}
                    >
                      <Space wrap>
                        <Text>{clip.text}</Text>
                        <Text type="secondary">{`${(clip.seconds || 0).toFixed(1)} s`}</Text>
                        {clip.byName && <Text type="secondary">{t('datasetBy', { name: clip.byName })}</Text>}
                      </Space>
                    </List.Item>
                  )}
                />

                {manage && (
                  <Popconfirm title={t('cmdRemoveCommandConfirm', { count: clips.length })} onConfirm={removeCommand} okButtonProps={{ danger: true }}>
                    <Button type="link" danger size="small" style={{ padding: 0 }} disabled={busy}>{t('cmdRemoveCommand')}</Button>
                  </Popconfirm>
                )}
              </Space>
            ) : (
              <Empty description={t('cmdNoCommands')} />
            )}
          </Col>
        </Row>
      </Space>
    </Card>
  );
}
