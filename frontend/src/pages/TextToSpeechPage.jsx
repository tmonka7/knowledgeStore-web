import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import {
  Alert, Button, Card, Col, Empty, Input, List, Progress, Row, Segmented, Select, Slider, Space, Tabs, Tag, Tooltip,
  Typography, message,
} from 'antd';
import {
  ClearOutlined, DeleteOutlined, DownloadOutlined, FileTextOutlined, ReloadOutlined, RocketOutlined, SoundOutlined,
  StopOutlined,
} from '@ant-design/icons';
import api from '../api';
import { MONO } from '../components/ml/JobView';
import VoiceTrainingPanel from '../components/voice/VoiceTrainingPanel';
import { useLanguage } from '../i18n';
import { can } from '../permissions';
import { joinWavs, splitForSpeech, wavSeconds } from '../lib/speechSynthesis';

const { Paragraph, Text } = Typography;
const { TextArea } = Input;

// Each language in its own script, as a language picker shows them (Korean as on the OCR page).
const LANGUAGE_LABELS = {
  en: 'English', ko: '조선어', ja: '日本語', ar: 'العربية', bg: 'Български', cs: 'Čeština', da: 'Dansk', de: 'Deutsch',
  el: 'Ελληνικά', es: 'Español', et: 'Eesti', fi: 'Suomi', fr: 'Français', hi: 'हिन्दी', hr: 'Hrvatski', hu: 'Magyar',
  id: 'Bahasa Indonesia', it: 'Italiano', lt: 'Lietuvių', lv: 'Latviešu', nl: 'Nederlands', pl: 'Polski', pt: 'Português',
  ro: 'Română', ru: 'Русский', sk: 'Slovenčina', sl: 'Slovenščina', sv: 'Svenska', tr: 'Türkçe', uk: 'Українська',
  vi: 'Tiếng Việt',
};
// The page's language, as a first choice of what to read.
const UI_TO_SPEECH = { en: 'en', es: 'es', jp: 'ja', zh: 'en' };
const PREFS_KEY = 'text-to-speech-prefs';
const PART_PAUSE = 0.3;
const PARAGRAPH_PAUSE = 0.6;
const MAX_TEXT = 100000;
const MAX_HISTORY = 10;
const NONE = [];

const readPrefs = () => {
  try {
    return JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}') || {};
  } catch {
    return {};
  }
};

const clock = (seconds) => {
  const total = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** The server's reason, from an error whose body came back as an ArrayBuffer. */
const errorText = (error) => {
  const data = error.response?.data;
  if (data instanceof ArrayBuffer) {
    try {
      return JSON.parse(new TextDecoder().decode(data)).message || error.message;
    } catch {
      return error.message;
    }
  }
  return data?.message || error.message;
};

const fileName = (text) => `${(text.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'speech')}.wav`;

const TRAINED = 'trained:';

/**
 * Tools > AI > Text to Speech: Read aloud, and — with 'text-to-speech:train' —
 * Train voice, which learns a voice from someone's recordings and tests it.
 */
export default function TextToSpeechPage({ user }) {
  const { t } = useLanguage();
  // Training copies a person's voice and ties up the server: a separate
  // grant, and the API enforces the same rule.
  const canTrain = can(user, 'text-to-speech', 'train');
  // Read aloud re-reads its voices when shown, so a voice just trained is there.
  const [tab, setTab] = useState('read');
  const [voicesVersion, setVoicesVersion] = useState(0);

  return (
    <div className="vision-page vision-stack">
      <div className="vision-page-header">
        <div>
          <h1 className="vision-page-title">{t('textToSpeech')}</h1>
          <p className="vision-page-subtitle">{t('ttsSynthSubtitle')}</p>
        </div>
      </div>
      <Tabs
        activeKey={tab}
        onChange={(key) => {
          setTab(key);
          if (key === 'read') setVoicesVersion((value) => value + 1);
        }}
        items={[
          {
            key: 'read',
            label: <span><SoundOutlined /> {t('ttsReadTab')}</span>,
            children: <ReadAloud reloadKey={voicesVersion} />,
          },
          {
            key: 'train',
            label: <span><RocketOutlined /> {t('voiceTrainTab')}</span>,
            children: canTrain
              ? <VoiceTrainingPanel />
              : <Alert type="info" showIcon message={t('voiceTrainNeedsPermission')} />,
          },
        ]}
      />
    </div>
  );
}

/**
 * Read aloud with Supertonic 3 on the server: type or open a text, choose the
 * language and a voice — one of the model's or one trained on Train voice —
 * and it is read aloud, the first part playing while the rest is being made,
 * then kept below, to play again or save as WAV.
 */
function ReadAloud({ reloadKey }) {
  const { t, language: uiLanguage } = useLanguage();
  const [status, setStatus] = useState(null); // { models, engine, languages, steps, maxChars }
  const [loading, setLoading] = useState(false);
  const [prefs, setPrefs] = useState(() => ({
    modelId: '', language: UI_TO_SPEECH[uiLanguage] || 'en', voice: 'F1', speed: 1.05, steps: 8, ...readPrefs(),
  }));
  const [text, setText] = useState('');
  const [run, setRun] = useState(null); // { done, total, started }
  const [history, setHistory] = useState([]);
  const stopRef = useRef(false);
  const historyRef = useRef([]);
  const playerRef = useRef(null);
  const fileRef = useRef(null);
  // Parts made so far, and which one the player is on, while one is being read.
  const queueRef = useRef({ urls: [], playing: -1, waiting: false });

  const setPref = (patch) => setPrefs((current) => ({ ...current, ...patch }));
  useEffect(() => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Not remembered; nothing depends on it.
    }
  }, [prefs]);
  useEffect(() => { historyRef.current = history; }, [history]);
  useEffect(() => () => {
    stopRef.current = true;
    historyRef.current.forEach((entry) => URL.revokeObjectURL(entry.url));
    queueRef.current.urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/tools/speech/synthesize', { timeout: 0 });
      setStatus(data);
    } catch (error) {
      setStatus({ models: [], engine: { ok: false, message: errorText(error) }, languages: [], steps: [4, 8, 16], maxChars: 2000 });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);

  const models = status?.models || NONE;
  const model = models.find((item) => item.id === prefs.modelId) || null;
  const voices = model?.voices || NONE;
  const allTrained = status?.trainedVoices || NONE;
  // Voices trained on Train voice for this model, picked as "trained:<id>".
  const trained = allTrained.filter((voice) => !voice.synthesisModel || voice.synthesisModel === model?.id);
  const voiceValues = [...voices, ...trained.map((voice) => `${TRAINED}${voice.id}`)];
  useEffect(() => {
    if (models.length && !model) setPref({ modelId: models[0].id });
  }, [models, model]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (voices.length && !voiceValues.includes(prefs.voice)) setPref({ voice: voices[0] });
  }, [voices, trained.length, prefs.voice]); // eslint-disable-line react-hooks/exhaustive-deps
  const languages = status?.languages || NONE;
  useEffect(() => {
    if (languages.length && !languages.includes(prefs.language)) setPref({ language: 'en' });
  }, [languages, prefs.language]); // eslint-disable-line react-hooks/exhaustive-deps

  const voiceLabel = (voice) => {
    if (String(voice).startsWith(TRAINED)) {
      return allTrained.find((item) => `${TRAINED}${item.id}` === voice)?.name || t('voiceDeleted');
    }
    const match = /^([FM])(\d+)$/.exec(voice);
    if (!match) return voice;
    return `${t(match[1] === 'F' ? 'ttsVoiceFemale' : 'ttsVoiceMale')} ${match[2]}`;
  };

  /** Play the next part made, if the player is free for it. */
  const playNext = () => {
    const queue = queueRef.current;
    const player = playerRef.current;
    if (!player || queue.playing + 1 >= queue.urls.length) {
      queue.waiting = true;
      return;
    }
    queue.waiting = false;
    queue.playing += 1;
    player.src = queue.urls[queue.playing];
    player.play().catch(() => { queue.waiting = true; });
  };

  const stopPlayback = () => {
    playerRef.current?.pause();
    queueRef.current.urls.forEach((url) => URL.revokeObjectURL(url));
    queueRef.current = { urls: [], playing: -1, waiting: false };
  };

  const speak = async () => {
    const words = text.trim();
    if (!words || !model || run) return;
    const settings = { ...prefs };
    const parts = splitForSpeech(words, Math.min(600, status.maxChars || 600), 200);
    stopRef.current = false;
    stopPlayback();
    queueRef.current.waiting = true;
    const started = Date.now();
    setRun({ done: 0, total: parts.length, started });
    const buffers = [];
    const dropped = new Set();
    try {
      for (let i = 0; i < parts.length && !stopRef.current; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const response = await api.post('/tools/speech/synthesize', {
          modelId: settings.modelId,
          text: parts[i].text,
          language: settings.language,
          ...(settings.voice.startsWith(TRAINED)
            ? { voiceId: settings.voice.slice(TRAINED.length) }
            : { voice: settings.voice }),
          speed: settings.speed,
          steps: settings.steps,
        }, { responseType: 'arraybuffer', timeout: 0 });
        if (stopRef.current) break;
        buffers.push(response.data);
        decodeURIComponent(response.headers['x-speech-dropped'] || '').split('').forEach((char) => dropped.add(char));
        queueRef.current.urls.push(URL.createObjectURL(new Blob([response.data], { type: 'audio/wav' })));
        if (queueRef.current.waiting) playNext();
        setRun({ done: i + 1, total: parts.length, started });
      }
      if (buffers.length) {
        const blob = joinWavs(buffers, parts.map((part) => (part.paragraphEnd ? PARAGRAPH_PAUSE : PART_PAUSE)));
        const seconds = wavSeconds(await blob.arrayBuffer());
        const entry = {
          id: `${started}`,
          text: parts.slice(0, buffers.length).map((part) => part.text).join(' '),
          complete: buffers.length === parts.length,
          language: settings.language,
          voice: settings.voice,
          speed: settings.speed,
          seconds,
          took: (Date.now() - started) / 1000,
          url: URL.createObjectURL(blob),
        };
        setHistory((current) => {
          const next = [entry, ...current];
          next.slice(MAX_HISTORY).forEach((old) => URL.revokeObjectURL(old.url));
          return next.slice(0, MAX_HISTORY);
        });
      }
      if (dropped.size) message.warning(t('ttsDropped', { chars: [...dropped].join(' ') }));
    } catch (error) {
      message.error(errorText(error));
    } finally {
      setRun(null);
    }
  };

  const stop = () => {
    stopRef.current = true;
    stopPlayback();
  };

  const openFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_TEXT * 4) {
      message.error(t('ttsFileTooLarge'));
      return;
    }
    const content = await file.text();
    setText(content.slice(0, MAX_TEXT));
    if (content.length > MAX_TEXT) message.warning(t('ttsTextCut', { count: MAX_TEXT.toLocaleString() }));
  };

  const download = (entry) => {
    const link = document.createElement('a');
    link.href = entry.url;
    link.download = fileName(entry.text);
    link.click();
  };

  const remove = (entry) => {
    URL.revokeObjectURL(entry.url);
    setHistory((current) => current.filter((item) => item.id !== entry.id));
  };

  const engineError = status && !status.engine?.ok ? status.engine.message : '';
  const noModel = status && !models.length && !engineError;
  const busy = Boolean(run);
  const percent = run ? Math.round((run.done / run.total) * 100) : 0;

  return (
    <div className="vision-stack">

      {noModel && (
        <Alert
          type="warning"
          showIcon
          message={t('ttsNoModel')}
          description={<Text code>python backend/python/download_models.py supertonic-3</Text>}
        />
      )}
      {engineError && <Alert type="error" showIcon message={t('ttsEngineError')} description={<span style={MONO}>{engineError}</span>} />}

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card
            title={t('ttsTextTitle')}
            extra={(
              <Space wrap>
                <input ref={fileRef} type="file" accept=".txt,.md,text/plain" hidden onChange={openFile} />
                <Button icon={<FileTextOutlined />} onClick={() => fileRef.current?.click()} disabled={busy}>{t('ttsOpenText')}</Button>
                <Button icon={<ClearOutlined />} onClick={() => setText('')} disabled={busy || !text}>{t('clear')}</Button>
              </Space>
            )}
          >
            <TextArea
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) speak();
              }}
              placeholder={t('ttsPlaceholder')}
              autoSize={{ minRows: 10, maxRows: 24 }}
              maxLength={MAX_TEXT}
              showCount
              disabled={busy}
            />
            <Space wrap style={{ marginTop: 16 }}>
              {busy ? (
                <Button danger icon={<StopOutlined />} onClick={stop}>{t('ttsStop')}</Button>
              ) : (
                <Tooltip title="Ctrl+Enter">
                  <Button type="primary" icon={<SoundOutlined />} onClick={speak} disabled={!text.trim() || !model || Boolean(engineError)}>
                    {t('ttsSpeak')}
                  </Button>
                </Tooltip>
              )}
              {run && (
                <Text type="secondary">{t('ttsProgress', { done: run.done, total: run.total })}</Text>
              )}
            </Space>
            {run && <Progress percent={percent} size="small" status="active" style={{ marginTop: 8 }} />}
            {/* The parts play here, one after another, as they arrive. */}
            <audio
              ref={playerRef}
              controls
              style={{ width: '100%', marginTop: 12, display: busy || queueRef.current.playing >= 0 ? 'block' : 'none' }}
              onEnded={playNext}
            />
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card
            title={t('ttsSettings')}
            extra={(
              <Tooltip title={t('refresh')}>
                <Button icon={<ReloadOutlined />} onClick={load} loading={loading} />
              </Tooltip>
            )}
          >
            <Space direction="vertical" size={14} style={{ width: '100%' }}>
              <div>
                <Text strong>{t('ttsLanguage')}</Text>
                <Select
                  showSearch
                  optionFilterProp="label"
                  style={{ width: '100%', marginTop: 6 }}
                  value={prefs.language}
                  onChange={(language) => setPref({ language })}
                  disabled={busy}
                  options={languages.map((code) => ({ value: code, label: `${LANGUAGE_LABELS[code] || code} (${code})` }))}
                />
              </div>
              <div>
                <Text strong>{t('ttsVoice')}</Text>
                <Select
                  style={{ width: '100%', marginTop: 6 }}
                  value={voiceValues.includes(prefs.voice) ? prefs.voice : undefined}
                  onChange={(voice) => {
                    // A trained voice speaks the language it was trained in.
                    const own = trained.find((item) => `${TRAINED}${item.id}` === voice);
                    setPref(own && languages.includes(own.language) ? { voice, language: own.language } : { voice });
                  }}
                  disabled={busy || !voices.length}
                  options={trained.length ? [
                    {
                      label: t('voiceTrainedVoices'),
                      options: trained.map((item) => ({ value: `${TRAINED}${item.id}`, label: `${item.name} (${item.language})` })),
                    },
                    { label: t('voicePresets'), options: voices.map((voice) => ({ value: voice, label: voiceLabel(voice) })) },
                  ] : voices.map((voice) => ({ value: voice, label: voiceLabel(voice) }))}
                />
              </div>
              <div>
                <Text strong>{t('ttsSpeed')}</Text>
                <Text type="secondary" style={{ float: 'right' }}>{`${Number(prefs.speed).toFixed(2)}×`}</Text>
                <Slider
                  min={0.7}
                  max={1.6}
                  step={0.05}
                  value={prefs.speed}
                  onChange={(speed) => setPref({ speed })}
                  disabled={busy}
                  marks={{ 0.7: '0.7', 1.05: '1', 1.6: '1.6' }}
                />
              </div>
              <div>
                <Text strong>{t('ttsQuality')}</Text>
                <Segmented
                  block
                  style={{ marginTop: 6 }}
                  value={prefs.steps}
                  onChange={(steps) => setPref({ steps })}
                  disabled={busy}
                  options={[
                    { value: 4, label: t('ttsQualityFast') },
                    { value: 8, label: t('ttsQualityStandard') },
                    { value: 16, label: t('ttsQualityBest') },
                  ]}
                />
              </div>
              {models.length > 1 && (
                <div>
                  <Text strong>{t('ttsModel')}</Text>
                  <Select
                    style={{ width: '100%', marginTop: 6 }}
                    value={model?.id}
                    onChange={(modelId) => setPref({ modelId })}
                    disabled={busy}
                    options={models.map((item) => ({ value: item.id, label: item.name }))}
                  />
                </div>
              )}
              {model && <Text type="secondary">{t('ttsModelNote', { name: model.name })}</Text>}
            </Space>
          </Card>
        </Col>
      </Row>

      <Card title={t('ttsHistory')}>
        {history.length ? (
          <List
            dataSource={history}
            renderItem={(entry) => (
              <List.Item
                actions={[
                  <Tooltip key="save" title={t('ttsDownload')}>
                    <Button icon={<DownloadOutlined />} onClick={() => download(entry)} />
                  </Tooltip>,
                  <Tooltip key="delete" title={t('delete')}>
                    <Button icon={<DeleteOutlined />} onClick={() => remove(entry)} />
                  </Tooltip>,
                ]}
              >
                <div style={{ width: '100%', minWidth: 0 }}>
                  <Space wrap size={4} style={{ marginBottom: 6 }}>
                    <Tag>{LANGUAGE_LABELS[entry.language] || entry.language}</Tag>
                    <Tag>{voiceLabel(entry.voice)}</Tag>
                    <Tag>{clock(entry.seconds)}</Tag>
                    {!entry.complete && <Tag color="orange">{t('ttsStopped')}</Tag>}
                    <Text type="secondary">{t('ttsTook', { seconds: entry.took.toFixed(1) })}</Text>
                  </Space>
                  <Paragraph ellipsis={{ rows: 2, expandable: true, symbol: t('ttsMore') }} style={{ marginBottom: 6 }}>
                    {entry.text}
                  </Paragraph>
                  <audio controls src={entry.url} style={{ width: '100%' }} />
                </div>
              </List.Item>
            )}
          />
        ) : (
          <Empty description={t('ttsHistoryEmpty')} />
        )}
      </Card>
    </div>
  );
}
