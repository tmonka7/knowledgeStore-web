import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, Empty, Input, List, Modal, Popconfirm, Progress, Row, Select, Space, Table, Tag, Tooltip,
  Typography, message,
} from 'antd';
import {
  CheckCircleFilled, DeleteOutlined, EditOutlined, FolderOpenOutlined, LeftOutlined, PlusOutlined, ReloadOutlined,
  RightOutlined, WarningOutlined,
} from '@ant-design/icons';
import api from '../../api';
import ClipRecorder from '../speaker/ClipRecorder';
import { useLanguage } from '../../i18n';
import {
  DEFAULT_SCRIPTS, TTS_LANGUAGES, languageLabel, newLineId, rebuildScript, splitScript,
} from '../../lib/voiceScripts';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

const BASE = '/tools/voice/datasets';
const MAX_CLIP_SECONDS = 30;
// Enough speech for a voice to be learned well; training accepts less.
const GOOD_SECONDS = 180;

const clock = (seconds) => {
  const total = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const errorMessage = (error, fallback) => error.response?.data?.message || fallback;

/**
 * A recording that is much shorter than its sentence was probably cut off;
 * one much longer has long silences or extra speech. Rough, per character, so
 * it works for every language (CJK characters carry more per character).
 */
const clipWarning = (line, t) => {
  if (!line?.seconds || !line.text) return '';
  const cjk = /[぀-ヿ㐀-鿿가-힯]/.test(line.text);
  const perChar = cjk ? 0.12 : 0.045;
  const expected = line.text.length * perChar;
  if (line.seconds < expected * 0.45) return t('voiceDsClipShort');
  if (line.seconds > expected * 2.5 + 3) return t('voiceDsClipLong');
  return '';
};

/**
 * Datasets (Text to Speech): voice datasets recorded on the page. A dataset
 * is a script — sentences to read, built in or your own — and a recording of
 * each line, made with the microphone or chosen from a file. Every recording
 * is sent to the server as soon as it is made, so closing the page loses
 * nothing. Train voice learns a voice from them.
 */
export default function VoiceDatasetPanel({ onChanged }) {
  const { t } = useLanguage();
  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(BASE);
      setDatasets(data.datasets || []);
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

  const remove = async (dataset) => {
    try {
      await api.delete(`${BASE}/${dataset.id}`);
      if (openId === dataset.id) setOpenId('');
      message.success(t('voiceDsDeleted', { name: dataset.name }));
      changed();
    } catch (error) {
      message.error(errorMessage(error, t('voiceDsSaveFailed')));
    }
  };

  const columns = [
    { title: t('trainDataset'), dataIndex: 'name', render: (name, item) => <a onClick={() => setOpenId(item.id)}>{name}</a> },
    { title: t('voiceDsSpeaker'), dataIndex: 'speaker', render: (speaker) => speaker || '—' },
    { title: t('mlSpokenLanguage'), dataIndex: 'language', render: (language) => <Tag>{language}</Tag> },
    {
      title: t('voiceDsRecorded'),
      key: 'recorded',
      render: (_, item) => (
        <Space size={8}>
          <Progress
            type="circle"
            size={28}
            percent={item.lines ? Math.round(((item.recorded || 0) / item.lines) * 100) : 0}
            showInfo={false}
          />
          <Text>{`${item.recorded || 0} / ${item.lines || 0}`}</Text>
        </Space>
      ),
    },
    { title: t('voiceDsDuration'), key: 'seconds', render: (_, item) => clock(item.seconds) },
    {
      title: '',
      key: 'actions',
      render: (_, item) => (
        <Space>
          <Button size="small" icon={<FolderOpenOutlined />} onClick={() => setOpenId(item.id)}>{t('voiceDsOpen')}</Button>
          <Popconfirm title={t('voiceDsDeleteConfirm', { name: item.name })} onConfirm={() => remove(item)}>
            <Button size="small" danger icon={<DeleteOutlined />} aria-label={t('delete')} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        bordered={false}
        title={t('voiceDsTitle')}
        extra={(
          <Space>
            <Tooltip title={t('translationReload')}>
              <Button icon={<ReloadOutlined />} loading={loading} onClick={load} />
            </Tooltip>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>{t('voiceDsNew')}</Button>
          </Space>
        )}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Paragraph type="secondary" style={{ margin: 0 }}>{t('voiceDsHelp')}</Paragraph>
          <Table
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={datasets}
            loading={loading}
            pagination={false}
            rowClassName={(item) => (item.id === openId ? 'ant-table-row-selected' : '')}
            locale={{ emptyText: <Empty description={t('voiceDsNone')} /> }}
            scroll={{ x: 'max-content' }}
          />
        </Space>
      </Card>

      {openId && (
        <Studio key={openId} id={openId} onClose={() => setOpenId('')} onChanged={changed} />
      )}

      <CreateModal
        open={creating}
        onCancel={() => setCreating(false)}
        onCreated={(dataset) => {
          setCreating(false);
          setOpenId(dataset.id);
          changed();
        }}
      />
    </Space>
  );
}

/** New dataset: name, speaker, language, and the script to read — built in or pasted. */
function CreateModal({ open, onCancel, onCreated }) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [speaker, setSpeaker] = useState('');
  const [language, setLanguage] = useState('en');
  const [text, setText] = useState('');
  const [edited, setEdited] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setSpeaker('');
    setLanguage('en');
    setText((DEFAULT_SCRIPTS.en || []).join('\n'));
    setEdited(false);
  }, [open]);

  // The built-in sentences follow the language until the script is edited.
  const pickLanguage = (code) => {
    setLanguage(code);
    if (!edited) setText((DEFAULT_SCRIPTS[code] || []).join('\n'));
  };

  const lines = splitScript(text);
  const create = async () => {
    setSaving(true);
    try {
      const { data } = await api.post(BASE, {
        name: name.trim() || speaker.trim() || t('voiceDsUntitled'),
        speaker,
        language,
        script: lines.map((line) => ({ id: newLineId(), text: line })),
      });
      onCreated(data.dataset);
    } catch (error) {
      message.error(errorMessage(error, t('voiceDsSaveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t('voiceDsNew')}
      onCancel={onCancel}
      onOk={create}
      okText={t('voiceDsCreate')}
      okButtonProps={{ disabled: !lines.length, loading: saving }}
      width={720}
      destroyOnClose
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Row gutter={[12, 12]}>
          <Col xs={24} md={8}>
            <Text type="secondary">{t('voiceDsName')}</Text>
            <Input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder={speaker || t('voiceDsUntitled')} />
          </Col>
          <Col xs={24} md={8}>
            <Text type="secondary">{t('voiceDsSpeaker')}</Text>
            <Input value={speaker} maxLength={120} onChange={(event) => setSpeaker(event.target.value)} placeholder={t('voiceDsSpeakerPlaceholder')} />
          </Col>
          <Col xs={24} md={8}>
            <Text type="secondary">{t('mlSpokenLanguage')}</Text>
            <Select
              style={{ width: '100%' }}
              showSearch
              optionFilterProp="label"
              value={language}
              onChange={pickLanguage}
              options={TTS_LANGUAGES.map((code) => ({ value: code, label: languageLabel(code) }))}
            />
          </Col>
        </Row>
        <div>
          <Text type="secondary">{t('voiceDsScript')}</Text>
          <TextArea
            rows={12}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setEdited(true);
            }}
            placeholder={t('voiceDsScriptPlaceholder')}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {DEFAULT_SCRIPTS[language] ? t('voiceDsScriptHelp', { count: lines.length }) : t('voiceDsScriptOwn', { count: lines.length })}
          </Text>
        </div>
      </Space>
    </Modal>
  );
}

/**
 * One dataset open for recording: the lines on the left, the current line on
 * the right with its recording. Recording a line moves on to the next one
 * that has none.
 */
function Studio({ id, onClose, onChanged }) {
  const { t } = useLanguage();
  const [dataset, setDataset] = useState(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const [editing, setEditing] = useState(false);
  const [lineText, setLineText] = useState('');

  const script = dataset?.script || [];
  const line = script[index] || null;

  const apply = (next, moveOn = false) => {
    setDataset(next);
    if (moveOn) {
      const after = next.script.findIndex((item, position) => position > index && !item.seconds);
      const first = next.script.findIndex((item) => !item.seconds);
      if (after >= 0) setIndex(after);
      else if (first >= 0) setIndex(first);
    }
  };

  useEffect(() => {
    let alive = true;
    api.get(`${BASE}/${id}`)
      .then(({ data }) => {
        if (!alive) return;
        setDataset(data.dataset);
        const first = data.dataset.script.findIndex((item) => !item.seconds);
        setIndex(first >= 0 ? first : 0);
      })
      .catch((error) => {
        message.error(errorMessage(error, t('voiceDsLoadFailed')));
        onClose();
      });
    return () => { alive = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setLineText(line?.text || ''); }, [line?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The current line's recording, fetched with the session's token.
  useEffect(() => {
    if (!line?.seconds) {
      setAudioUrl('');
      return undefined;
    }
    let url = '';
    let alive = true;
    api.get(`${BASE}/${id}/clips/${line.id}`, { responseType: 'blob' })
      .then(({ data }) => {
        if (!alive) return;
        url = URL.createObjectURL(data);
        setAudioUrl(url);
      })
      .catch(() => setAudioUrl(''));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, line?.id, line?.seconds]);

  const saveScript = async (nextScript, extra = {}) => {
    setBusy(true);
    try {
      const { data } = await api.put(`${BASE}/${id}`, { script: nextScript.map(({ id: lineId, text }) => ({ id: lineId, text })), ...extra });
      setDataset(data.dataset);
      onChanged();
      return data.dataset;
    } catch (error) {
      message.error(errorMessage(error, t('voiceDsSaveFailed')));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const saveLineText = () => {
    const text = lineText.replace(/\s+/g, ' ').trim();
    if (!line || text === line.text) return;
    saveScript(script.map((item) => (item.id === line.id ? { ...item, text } : item)));
  };

  const record = async (clip) => {
    if (!line) return;
    // A sentence edited but not yet saved is saved first, so the recording matches it.
    const text = lineText.replace(/\s+/g, ' ').trim();
    if (text !== line.text && !(await saveScript(script.map((item) => (item.id === line.id ? { ...item, text } : item))))) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('audio', clip.blob, `${line.id}.wav`);
      const { data } = await api.put(`${BASE}/${id}/clips/${line.id}`, form);
      apply(data.dataset, true);
      onChanged();
    } catch (error) {
      message.error(errorMessage(error, t('voiceDsSaveFailed')));
    } finally {
      setBusy(false);
    }
  };

  const removeClip = async () => {
    setBusy(true);
    try {
      const { data } = await api.delete(`${BASE}/${id}/clips/${line.id}`);
      apply(data.dataset);
      onChanged();
    } catch (error) {
      message.error(errorMessage(error, t('voiceDsSaveFailed')));
    } finally {
      setBusy(false);
    }
  };

  const addLine = async () => {
    const next = await saveScript([...script, { id: newLineId(), text: '' }]);
    if (next) setIndex(next.script.length - 1);
  };

  const removeLine = async () => {
    const next = await saveScript(script.filter((item) => item.id !== line.id));
    if (next) setIndex(Math.min(index, Math.max(0, next.script.length - 1)));
  };

  if (!dataset) return <Card bordered={false} loading />;

  const recorded = script.filter((item) => item.seconds).length;
  const warning = clipWarning(line, t);

  return (
    <Card
      bordered={false}
      title={(
        <Space wrap>
          <span>{dataset.name}</span>
          {dataset.speaker && <Tag>{dataset.speaker}</Tag>}
          <Tag color="blue">{languageLabel(dataset.language)}</Tag>
        </Space>
      )}
      extra={(
        <Space>
          <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>{t('voiceDsEditScript')}</Button>
          <Button onClick={onClose}>{t('close')}</Button>
        </Space>
      )}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Row gutter={[16, 8]} align="middle">
          <Col xs={24} md={14}>
            <Progress percent={script.length ? Math.round((recorded / script.length) * 100) : 0} />
            <Text type="secondary">
              {t('voiceDsProgress', { recorded, total: script.length, duration: clock(dataset.seconds) })}
            </Text>
          </Col>
          <Col xs={24} md={10}>
            {dataset.seconds < GOOD_SECONDS
              ? <Alert type="info" showIcon message={t('voiceDsAim', { minutes: GOOD_SECONDS / 60 })} />
              : <Alert type="success" showIcon message={t('voiceDsEnough')} />}
          </Col>
        </Row>

        <Paragraph type="secondary" style={{ margin: 0 }}>{t('voiceDsTips')}</Paragraph>

        <Row gutter={[16, 16]}>
          <Col xs={24} lg={9}>
            <List
              size="small"
              bordered
              className="voice-ds-lines"
              dataSource={script}
              renderItem={(item, position) => (
                <List.Item
                  onClick={() => setIndex(position)}
                  className={position === index ? 'is-current' : ''}
                  style={{ cursor: 'pointer' }}
                >
                  <Space align="start" size={8} style={{ width: '100%' }}>
                    <Text type="secondary" style={{ minWidth: 26 }}>{position + 1}</Text>
                    <Text ellipsis style={{ flex: 1, maxWidth: 260 }} type={item.text ? undefined : 'secondary'}>
                      {item.text || t('voiceDsEmptyLine')}
                    </Text>
                    {item.seconds
                      ? <Tag color={clipWarning(item, t) ? 'gold' : 'green'} icon={<CheckCircleFilled />}>{`${item.seconds.toFixed(1)} s`}</Tag>
                      : <Tag>{t('voiceDsToRecord')}</Tag>}
                  </Space>
                </List.Item>
              )}
            />
            <Button block type="dashed" icon={<PlusOutlined />} style={{ marginTop: 8 }} onClick={addLine} disabled={busy}>
              {t('voiceDsAddLine')}
            </Button>
          </Col>

          <Col xs={24} lg={15}>
            {line ? (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                  <Text strong>{t('voiceDsLineOf', { number: index + 1, total: script.length })}</Text>
                  <Space>
                    <Button icon={<LeftOutlined />} disabled={index === 0} onClick={() => setIndex(index - 1)} aria-label={t('previous')} />
                    <Button icon={<RightOutlined />} disabled={index >= script.length - 1} onClick={() => setIndex(index + 1)} aria-label={t('next')} />
                  </Space>
                </Space>
                <TextArea
                  className="voice-ds-sentence"
                  autoSize={{ minRows: 2, maxRows: 6 }}
                  value={lineText}
                  maxLength={500}
                  onChange={(event) => setLineText(event.target.value)}
                  onBlur={saveLineText}
                  placeholder={t('voiceDsLinePlaceholder')}
                />
                <ClipRecorder
                  onClip={(clip) => record(clip)}
                  busy={busy}
                  disabled={!lineText.trim()}
                  maxSeconds={MAX_CLIP_SECONDS}
                  allowFile
                  recordLabel={line.seconds ? t('voiceDsRerecord') : t('speakerRecord')}
                  hint={t('voiceDsRecordHint', { seconds: MAX_CLIP_SECONDS })}
                />
                {line.seconds > 0 && (
                  <Space wrap>
                    {audioUrl && <audio controls src={audioUrl} style={{ height: 34 }} />}
                    <Text type="secondary">{`${line.seconds.toFixed(1)} s`}</Text>
                    <Button danger size="small" icon={<DeleteOutlined />} onClick={removeClip} disabled={busy}>
                      {t('voiceDsDeleteRecording')}
                    </Button>
                  </Space>
                )}
                {warning && <Alert type="warning" showIcon icon={<WarningOutlined />} message={warning} />}
                <Popconfirm title={t('voiceDsRemoveLineConfirm')} onConfirm={removeLine}>
                  <Button type="link" danger size="small" style={{ padding: 0 }} disabled={busy}>{t('voiceDsRemoveLine')}</Button>
                </Popconfirm>
              </Space>
            ) : (
              <Empty description={t('voiceDsNoLines')} />
            )}
          </Col>
        </Row>
      </Space>

      <ScriptModal
        open={editing}
        dataset={dataset}
        onCancel={() => setEditing(false)}
        onSave={async (nextScript, details) => {
          const next = await saveScript(nextScript, details);
          if (next) {
            setEditing(false);
            setIndex((current) => Math.min(current, Math.max(0, next.script.length - 1)));
          }
        }}
        busy={busy}
      />
    </Card>
  );
}

/** Edit the details and the whole script as text; lines whose text is kept keep their recordings. */
function ScriptModal({ open, dataset, onCancel, onSave, busy }) {
  const { t } = useLanguage();
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [speaker, setSpeaker] = useState('');

  useEffect(() => {
    if (!open) return;
    setText(dataset.script.map((line) => line.text).join('\n'));
    setName(dataset.name);
    setSpeaker(dataset.speaker || '');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = rebuildScript(dataset.script, text);
  const kept = new Set(next.map((line) => line.id));
  const lost = dataset.script.filter((line) => line.seconds && !kept.has(line.id)).length;

  return (
    <Modal
      open={open}
      title={t('voiceDsEditScript')}
      onCancel={onCancel}
      onOk={() => onSave(next, { name: name.trim() || dataset.name, speaker })}
      okText={t('save')}
      okButtonProps={{ loading: busy, danger: lost > 0 }}
      width={720}
      destroyOnClose
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Row gutter={12}>
          <Col span={12}>
            <Text type="secondary">{t('voiceDsName')}</Text>
            <Input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
          </Col>
          <Col span={12}>
            <Text type="secondary">{t('voiceDsSpeaker')}</Text>
            <Input value={speaker} maxLength={120} onChange={(event) => setSpeaker(event.target.value)} />
          </Col>
        </Row>
        <TextArea rows={14} value={text} onChange={(event) => setText(event.target.value)} />
        <Text type="secondary" style={{ fontSize: 12 }}>{t('voiceDsEditHelp', { count: next.length })}</Text>
        {lost > 0 && <Alert type="warning" showIcon message={t('voiceDsLosesRecordings', { count: lost })} />}
      </Space>
    </Modal>
  );
}
