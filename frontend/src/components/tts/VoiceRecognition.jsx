import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Badge, Button, Card, Col, Collapse, Empty, Input, List, Progress, Row, Segmented, Select, Space, Switch, Tag,
  Tooltip, Typography, message,
} from 'antd';
import {
  AudioOutlined, ClearOutlined, CopyOutlined, DownloadOutlined, LoadingOutlined, ReloadOutlined, StopOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import api from '../../api';
import { COMMON_LANGUAGES } from '../../lib/translationDataset';
import { encodeWav16k, fileToWav16k, openMicrophone } from '../../lib/speechCapture';
import { MONO } from '../ml/JobView';
import { useLanguage } from '../../i18n';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

const PREFS_KEY = 'voice-recognition-prefs';
const MAX_ENTRIES = 50;

const readPrefs = () => {
  try {
    return JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}') || {};
  } catch {
    return {};
  }
};

const clock = (seconds) => {
  const total = Math.max(0, seconds || 0);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${(total % 60).toFixed(1).padStart(4, '0')}`;
};

const srtTime = (seconds) => {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  const pad = (value, size = 2) => String(value).padStart(size, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};

const save = (name, text, type = 'text/plain') => {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
};

const formatMb = (bytes) => `${Math.round(bytes / 1e6)} MB`;

/**
 * Voice recognition with whisper.cpp (ggml-tiny / ggml-base …) on the server.
 * Speak into the microphone — one recording, or live, phrase by phrase — or
 * choose an audio file; the text is added to one transcript you can edit,
 * copy, or save as .txt or .srt subtitles.
 */
export default function VoiceRecognition() {
  const { t } = useLanguage();
  const [status, setStatus] = useState(null); // { models, engine }
  const [loading, setLoading] = useState(false);
  const [prefs, setPrefs] = useState(() => ({ modelId: '', language: 'auto', translate: false, mode: 'live', ...readPrefs() }));
  const [recording, setRecording] = useState(null); // { startedAt, mic }
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [pending, setPending] = useState(0);
  const [entries, setEntries] = useState([]);
  const [transcript, setTranscript] = useState('');
  const chain = useRef(Promise.resolve());
  const transcriptRef = useRef('');
  const entriesRef = useRef([]);
  const micRef = useRef(null);

  const setPref = (patch) => setPrefs((current) => ({ ...current, ...patch }));
  useEffect(() => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Not remembered; nothing depends on it.
    }
  }, [prefs]);

  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);
  useEffect(() => { entriesRef.current = entries; }, [entries]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/tools/speech/recognize', { timeout: 0 });
      setStatus(data);
    } catch (error) {
      setStatus({ models: [], engine: { ok: false, message: error.response?.data?.message || error.message } });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const models = status?.models || [];
  const model = models.find((item) => item.id === prefs.modelId) || null;
  useEffect(() => {
    if (models.length && !model) setPref({ modelId: (models.find((item) => item.id === 'ggml-base') || models[0]).id });
  }, [models, model]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop the microphone and free the players when the tab goes away.
  useEffect(() => () => {
    micRef.current?.stop();
    entriesRef.current.forEach((entry) => URL.revokeObjectURL(entry.url));
  }, []);

  useEffect(() => {
    if (!recording) return undefined;
    const timer = setInterval(() => setElapsed((Date.now() - recording.startedAt) / 1000), 200);
    return () => clearInterval(timer);
  }, [recording]);

  /** Send one clip; clips are recognised in order, each with the text before it as context. */
  const recognise = (wav, source) => {
    const settings = { ...prefs };
    setPending((count) => count + 1);
    chain.current = chain.current.then(async () => {
      const form = new FormData();
      form.append('audio', wav.blob, 'speech.wav');
      form.append('modelId', settings.modelId);
      form.append('language', settings.language);
      form.append('translate', settings.translate ? 'true' : 'false');
      form.append('prompt', transcriptRef.current.slice(-400));
      form.append('seconds', String(wav.seconds));
      const entry = {
        id: `${Date.now()}-${Math.random()}`,
        source,
        url: URL.createObjectURL(wav.blob),
        seconds: wav.seconds,
        at: new Date(),
      };
      try {
        const { data } = await api.post('/tools/speech/recognize', form, { timeout: 0 });
        Object.assign(entry, {
          text: data.text, segments: data.segments || [], language: data.language, model: data.model, took: data.seconds,
        });
        if (data.text) {
          const next = transcriptRef.current ? `${transcriptRef.current.replace(/\s+$/, '')} ${data.text}` : data.text;
          transcriptRef.current = next;
          setTranscript(next);
        }
      } catch (error) {
        entry.error = error.response?.data?.message || error.message;
      }
      setEntries((current) => {
        const next = [entry, ...current];
        next.slice(MAX_ENTRIES).forEach((old) => URL.revokeObjectURL(old.url));
        return next.slice(0, MAX_ENTRIES);
      });
    }).finally(() => setPending((count) => count - 1));
  };

  const start = async () => {
    try {
      const live = prefs.mode === 'live';
      const mic = await openMicrophone({
        live,
        onLevel: setLevel,
        onPhrase: async (samples, rate) => recognise(await encodeWav16k(samples, rate), 'live'),
      });
      micRef.current = mic;
      setElapsed(0);
      setRecording({ startedAt: Date.now(), live });
    } catch (error) {
      message.error(error.message);
    }
  };

  const stop = async () => {
    const mic = micRef.current;
    micRef.current = null;
    const live = recording?.live;
    setRecording(null);
    if (!mic) return;
    const { samples, sampleRate } = await mic.stop();
    // Live mode sends what was being said when Stop was pressed; a recording
    // sends everything.
    if (samples.length > sampleRate * (live ? 0.5 : 0.3)) {
      recognise(await encodeWav16k(samples, sampleRate), live ? 'live' : 'microphone');
    }
  };

  const chooseFile = async (file) => {
    if (!file) return;
    try {
      const wav = await fileToWav16k(file);
      if (wav.blob.size > 64 * 1024 * 1024) throw new Error(t('voiceFileTooLong'));
      recognise(wav, file.name);
    } catch (error) {
      message.error(error.message);
    }
  };

  const clearAll = () => {
    entries.forEach((entry) => URL.revokeObjectURL(entry.url));
    setEntries([]);
    setTranscript('');
    transcriptRef.current = '';
  };

  const srt = () => {
    // Clips in the order they were spoken, one after another on one timeline.
    let offset = 0;
    let index = 0;
    const blocks = [];
    for (const entry of [...entries].reverse()) {
      for (const segment of entry.segments || []) {
        index += 1;
        blocks.push(`${index}\n${srtTime(offset + segment.start)} --> ${srtTime(offset + segment.end)}\n${segment.text}\n`);
      }
      offset += entry.seconds || 0;
    }
    return blocks.join('\n');
  };

  const ready = status?.engine?.ok && models.length > 0;
  const languageOptions = [
    { value: 'auto', label: t('voiceAutoLanguage') },
    ...COMMON_LANGUAGES.map(([code, label]) => ({ value: code, label: `${code} · ${label}` })),
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        bordered={false}
        title={<Space><AudioOutlined />{t('voiceTitle')}</Space>}
        extra={(
          <Tooltip title={t('translationReload')}>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={load} />
          </Tooltip>
        )}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {status && !models.length && (
            <Alert
              type="warning"
              showIcon
              message={t('voiceNoModels')}
              description={(
                <Paragraph style={{ margin: 0 }}>
                  {t('voiceNoModelsHelp')}
                  <pre style={{ ...MONO, margin: '8px 0 0' }}>
                    pip install pywhispercpp{'\n'}python backend/python/download_models.py ggml-tiny ggml-base ggml-tiny.en
                  </pre>
                </Paragraph>
              )}
            />
          )}
          {status && models.length > 0 && !status.engine.ok && (
            <Alert type="error" showIcon message={t('voiceEngineFailed')} description={status.engine.message} />
          )}

          <Row gutter={[12, 12]}>
            <Col xs={24} md={9}>
              <Text type="secondary">{t('voiceModel')}</Text>
              <Select
                style={{ width: '100%' }}
                value={model?.id}
                onChange={(modelId) => setPref({ modelId })}
                loading={!status}
                options={models.map((item) => ({
                  value: item.id,
                  label: `${item.id} · ${item.englishOnly ? t('voiceEnglishOnly') : t('voiceMultilingual')} · ${formatMb(item.bytes)}`,
                }))}
                notFoundContent={t('voiceNoModels')}
              />
            </Col>
            <Col xs={24} md={9}>
              <Text type="secondary">{t('voiceLanguage')}</Text>
              <Select
                showSearch
                optionFilterProp="label"
                style={{ width: '100%' }}
                value={model?.englishOnly ? 'en' : prefs.language}
                disabled={model?.englishOnly}
                onChange={(language) => setPref({ language })}
                options={languageOptions}
              />
            </Col>
            <Col xs={24} md={6}>
              <Text type="secondary">{t('voiceTranslate')}</Text>
              <div style={{ height: 32, display: 'flex', alignItems: 'center' }}>
                <Switch
                  checked={prefs.translate && !model?.englishOnly}
                  disabled={model?.englishOnly}
                  onChange={(translate) => setPref({ translate })}
                />
              </div>
            </Col>
          </Row>

          <Space wrap align="center" size={12}>
            <Segmented
              value={prefs.mode}
              disabled={Boolean(recording)}
              onChange={(mode) => setPref({ mode })}
              options={[
                { value: 'live', label: t('voiceModeLive') },
                { value: 'record', label: t('voiceModeRecord') },
              ]}
            />
            {recording ? (
              <Button danger type="primary" size="large" icon={<StopOutlined />} onClick={stop}>
                {`${t('voiceStop')} · ${clock(elapsed)}`}
              </Button>
            ) : (
              <Button type="primary" size="large" icon={<AudioOutlined />} disabled={!ready} onClick={start}>
                {t('voiceStart')}
              </Button>
            )}
            <Button
              icon={<UploadOutlined />}
              disabled={!ready}
              onClick={() => document.getElementById('voice-file-input')?.click()}
            >
              {t('voiceChooseFile')}
            </Button>
            <input
              id="voice-file-input"
              type="file"
              accept="audio/*,video/*"
              style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                chooseFile(file);
              }}
            />
            {pending > 0 && (
              <Tag icon={<LoadingOutlined />} color="processing">{t('voiceRecognising', { count: pending })}</Tag>
            )}
          </Space>

          {recording && (
            <div>
              <Progress percent={Math.round(level * 100)} showInfo={false} status="active" strokeColor={level > 0.1 ? '#52c41a' : '#bfbfbf'} />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {recording.live ? t('voiceLiveHelp') : t('voiceRecordHelp')}
              </Text>
            </div>
          )}
          {!recording && <Text type="secondary" style={{ fontSize: 12 }}>{prefs.mode === 'live' ? t('voiceLiveHelp') : t('voiceRecordHelp')}</Text>}
        </Space>
      </Card>

      <Card
        bordered={false}
        title={t('voiceTranscript')}
        extra={(
          <Space wrap>
            <Button icon={<CopyOutlined />} disabled={!transcript} onClick={() => navigator.clipboard.writeText(transcript).then(() => message.success(t('voiceCopied')))}>
              {t('voiceCopy')}
            </Button>
            <Button icon={<DownloadOutlined />} disabled={!transcript} onClick={() => save('transcript.txt', transcript)}>.txt</Button>
            <Button icon={<DownloadOutlined />} disabled={!entries.some((entry) => entry.segments?.length)} onClick={() => save('transcript.srt', srt(), 'application/x-subrip')}>.srt</Button>
            <Button icon={<ClearOutlined />} disabled={!transcript && !entries.length} onClick={clearAll}>{t('voiceClear')}</Button>
          </Space>
        )}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <TextArea
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            autoSize={{ minRows: 5, maxRows: 16 }}
            placeholder={t('voiceTranscriptPlaceholder')}
            style={{ fontSize: 16 }}
          />

          {entries.length ? (
            <Collapse
              size="small"
              items={[{
                key: 'clips',
                label: <Space>{t('voiceClips')}<Badge count={entries.length} color="#8c8c8c" /></Space>,
                children: (
                  <List
                    dataSource={entries}
                    renderItem={(entry) => (
                      <List.Item>
                        <Space direction="vertical" size={4} style={{ width: '100%' }}>
                          <Space wrap size={6}>
                            <Text type="secondary">{entry.at.toLocaleTimeString()}</Text>
                            <Tag>{entry.source === 'live' ? t('voiceModeLive') : entry.source === 'microphone' ? t('voiceMicrophone') : entry.source}</Tag>
                            {entry.model && <Tag color="blue">{entry.model}</Tag>}
                            {entry.language && <Tag>{entry.language}</Tag>}
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {entry.took != null ? t('voiceTook', { audio: clock(entry.seconds), seconds: entry.took }) : clock(entry.seconds)}
                            </Text>
                          </Space>
                          <audio controls preload="none" src={entry.url} style={{ height: 32, maxWidth: '100%' }} />
                          {entry.error
                            ? <Alert type="error" showIcon message={entry.error} />
                            : <Text>{entry.text || <Text type="secondary">{t('voiceNothingHeard')}</Text>}</Text>}
                          {entry.segments?.length > 1 && (
                            <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                              {entry.segments.map((segment) => `[${clock(segment.start)}] ${segment.text}`).join('\n')}
                            </Text>
                          )}
                        </Space>
                      </List.Item>
                    )}
                  />
                ),
              }]}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('voiceNoClips')} />
          )}
        </Space>
      </Card>
    </Space>
  );
}
