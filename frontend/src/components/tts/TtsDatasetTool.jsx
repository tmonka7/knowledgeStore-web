import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Card, Col, Empty, Input, List, Modal, Progress, Row, Select, Space, Tag, Tooltip, Typography, message,
} from 'antd';
import {
  CheckCircleFilled, CloudUploadOutlined, DownloadOutlined, FolderOpenOutlined, LeftOutlined, RightOutlined, SoundOutlined,
} from '@ant-design/icons';
import {
  buildManifestJsonl, buildMetadataCsv, clipId, datasetSummary, flattenText,
} from '../../lib/speechDataset';
import { formatSeconds, inspectWav, isWavFile, wavProblem } from '../../lib/wavInspect';
import { useLanguage } from '../../i18n';
import SaveToServerModal from '../ml/SaveToServerModal';
import { COMMON_LANGUAGES } from '../../lib/translationDataset';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

/**
 * Transcribing a folder of audio into a speech dataset.
 *
 * Built like the YOLO labelling tab and for the same reasons: the folder is
 * read where it already is, nothing is uploaded, and the transcripts — which
 * are small — are mirrored into localStorage so a reload does not undo an
 * afternoon. Audio files are large and numerous, and sending a corpus to a
 * server to be handed straight back would be the slowest way to achieve
 * nothing.
 */

const STORAGE_KEY = 'tts-dataset-draft';
const HISTORY_PAGE = 10;

/** Headers are read in parallel, in batches, so a large folder opens quickly. */
const INSPECT_BATCH = 16;

/** Committed this long after the last keystroke, rather than on each one. */
const COMMIT_MS = 400;

const downloadBlob = (filename, text, type) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const readDraft = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
};

export default function TtsDatasetTool() {
  const { t } = useLanguage();

  const [clips, setClips] = useState([]);
  const [skipped, setSkipped] = useState([]);
  const [index, setIndex] = useState(0);
  const [folderName, setFolderName] = useState('');
  const [scanning, setScanning] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);

  const folderInputRef = useRef(null);
  const audioRef = useRef(null);

  // webkitdirectory is not a React prop, and setting it in JSX logs a warning
  // on every render. Applied to the node instead.
  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '');
    folderInputRef.current?.setAttribute('directory', '');
  }, []);

  const current = clips[index] || null;
  const currentFile = current?.file || null;

  // One object URL at a time: a folder of audio held open all at once is a
  // great deal of memory for files nobody is listening to.
  const [audioUrl, setAudioUrl] = useState('');
  useEffect(() => {
    if (!currentFile) {
      setAudioUrl('');
      return undefined;
    }
    const url = URL.createObjectURL(currentFile);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [currentFile]);

  /*
   * The transcript being typed lives here, not in `clips`.
   *
   * Writing every keystroke into the clip array re-renders the history list
   * beside it, and at a few thousand clips that is felt in the typing. The
   * draft is committed on a short delay, and always before anything reads the
   * dataset.
   */
  const [draft, setDraft] = useState('');
  useEffect(() => { setDraft(current?.text || ''); }, [current?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = useCallback((value) => {
    setClips((list) => list.map((clip, position) => (
      position === index && clip.text !== value ? { ...clip, text: value } : clip
    )));
  }, [index]);

  useEffect(() => {
    if (!current || draft === current.text) return undefined;
    const timer = setTimeout(() => commit(draft), COMMIT_MS);
    return () => clearTimeout(timer);
  }, [draft, current, commit]);

  // Saved against the file name, so reopening the folder resumes the work.
  useEffect(() => {
    if (!clips.length) return undefined;
    const timer = setTimeout(() => {
      try {
        const texts = {};
        clips.forEach((clip) => { if (clip.text) texts[clip.name] = clip.text; });
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ texts }));
      } catch {
        // Private mode or a full quota: the session still works, only its
        // ability to survive a reload is lost.
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [clips]);

  const openFolder = async (fileList) => {
    const files = [...(fileList || [])]
      .filter((file) => isWavFile(file))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    if (!files.length) {
      message.warning(t('noWavFilesFound'));
      return;
    }

    setScanning(1);
    const saved = readDraft()?.texts || {};
    const accepted = [];
    const rejected = [];

    for (let start = 0; start < files.length; start += INSPECT_BATCH) {
      const batch = files.slice(start, start + INSPECT_BATCH);
      // eslint-disable-next-line no-await-in-loop
      const results = await Promise.all(batch.map(async (file) => {
        try {
          return { file, info: await inspectWav(file) };
        } catch (error) {
          return { file, info: { ok: false, reason: error.message } };
        }
      }));

      results.forEach(({ file, info }) => {
        const problem = wavProblem(info);
        if (problem) {
          rejected.push({ name: file.name, reason: problem });
          return;
        }
        accepted.push({
          name: file.name,
          file,
          seconds: info.seconds,
          bits: info.bits,
          estimated: info.estimated,
          text: saved[file.name] || '',
        });
      });

      // Never rounds down to 0, which doubles as the "not scanning" state — on
      // a folder of several thousand the first batches are well under half a
      // percent, and the progress bar would vanish the moment it appeared.
      setScanning(Math.max(1, Math.round(((start + batch.length) / files.length) * 100)));
    }

    setScanning(0);
    setClips(accepted);
    setSkipped(rejected);
    setIndex(0);
    setHistoryPage(1);
    setFolderName(files[0].webkitRelativePath?.split('/')[0] || t('selectedFiles'));

    if (!accepted.length) {
      message.error(t('everyFileRejected'));
      return;
    }
    const restored = accepted.filter((clip) => clip.text).length;
    if (restored) message.success(t('restoredTranscripts', { count: restored }));
  };

  const go = useCallback((delta) => {
    // Committed first: navigating away is the moment the draft stops being a
    // draft, and waiting for the timer would lose the last few characters.
    commit(draft);
    setIndex((position) => Math.min(clips.length - 1, Math.max(0, position + delta)));
  }, [clips.length, commit, draft]);

  // The history follows the clip being worked on rather than being left behind
  // on page one.
  useEffect(() => { setHistoryPage(Math.floor(index / HISTORY_PAGE) + 1); }, [index]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      const tag = event.target?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable;

      // Ctrl+Enter is the one shortcut that works while typing, because it is
      // the one needed while typing: finish this clip, move to the next.
      if (typing) {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          go(1);
        }
        return;
      }

      if (event.key === 'ArrowRight') go(1);
      if (event.key === 'ArrowLeft') go(-1);
      if (event.code === 'Space') {
        // Space scrolls the page by default, which is not what it is for here.
        event.preventDefault();
        togglePlay();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [go, togglePlay]);

  // Everything that reads the dataset sees the draft, not the last commit.
  const settled = useMemo(() => clips.map((clip, position) => (
    position === index ? { ...clip, text: draft } : clip
  )), [clips, index, draft]);

  const summary = useMemo(() => datasetSummary(settled), [settled]);

  const exportCsv = () => {
    downloadBlob('metadata.csv', buildMetadataCsv(settled), 'text/csv;charset=utf-8');
    message.success(t('metadataCsvSaved'));
  };

  const exportManifest = () => {
    downloadBlob('manifest.jsonl', buildManifestJsonl(settled), 'application/jsonl;charset=utf-8');
    message.success(t('manifestSaved'));
  };

  /*
   * Saving to the server for training: every clip goes up (only those the
   * server lacks are sent), with the transcripts as they stand — including
   * the one being typed. Whisper needs to be told the spoken language.
   */
  const [savingToServer, setSavingToServer] = useState(false);
  const [spokenLanguage, setSpokenLanguage] = useState(() => {
    try {
      return localStorage.getItem('tts-spoken-language') || 'en';
    } catch {
      return 'en';
    }
  });
  const pickLanguage = (code) => {
    setSpokenLanguage(code);
    try {
      localStorage.setItem('tts-spoken-language', code);
    } catch {
      /* A remembered choice is a convenience. */
    }
  };
  const prepareServerSave = () => ({
    files: settled.map((clip) => ({ path: clip.name, file: clip.file })),
    finish: {
      suffix: 'transcripts',
      body: {
        language: spokenLanguage,
        transcripts: Object.fromEntries(settled
          .filter((clip) => flattenText(clip.text))
          .map((clip) => [clip.name, flattenText(clip.text)])),
      },
    },
  });

  const clearAll = () => {
    Modal.confirm({
      title: t('clearTranscriptsTitle'),
      content: t('clearTranscriptsBody', { count: summary.done }),
      okText: t('delete'),
      okButtonProps: { danger: true },
      onOk: () => {
        setClips((list) => list.map((clip) => ({ ...clip, text: '' })));
        setDraft('');
      },
    });
  };

  return (
    <Row gutter={[16, 16]}>
      <Col span={24} lg={6}>
        <Card title={t('audioFolder')} bordered={false}>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Button
              icon={<FolderOpenOutlined />}
              block
              loading={Boolean(scanning)}
              onClick={() => folderInputRef.current?.click()}
            >
              {t('chooseFolder')}
            </Button>
            <input
              ref={folderInputRef}
              type="file"
              multiple
              className="mail-file-input"
              onChange={(event) => openFolder(event.target.files)}
            />

            {Boolean(scanning) && <Progress percent={scanning} size="small" />}

            <Alert type="info" showIcon message={t('wavRequirement')} />

            {folderName && (
              <Text type="secondary">
                {t('folderLoaded', { name: folderName, count: clips.length })}
              </Text>
            )}

            {skipped.length > 0 && (
              <>
                {/* Listed, never silently dropped: a clip missing from a corpus
                    with no explanation is found much later, by its absence. */}
                <Text strong>{t('skippedFiles', { count: skipped.length })}</Text>
                <List
                  size="small"
                  className="tts-skipped"
                  dataSource={skipped.slice(0, 50)}
                  renderItem={(entry) => (
                    <List.Item>
                      <Space direction="vertical" size={0}>
                        <Text ellipsis style={{ maxWidth: 220 }}>{entry.name}</Text>
                        <Text type="danger" style={{ fontSize: 12 }}>{entry.reason}</Text>
                      </Space>
                    </List.Item>
                  )}
                />
                {skipped.length > 50 && (
                  <Text type="secondary">{t('andMoreSkipped', { count: skipped.length - 50 })}</Text>
                )}
              </>
            )}
          </Space>
        </Card>

        <Card title={t('export')} bordered={false} style={{ marginTop: 16 }}>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Progress
              percent={summary.total ? Math.round((summary.done / summary.total) * 100) : 0}
              size="small"
            />
            <Text type="secondary">
              {t('transcriptionProgress', {
                done: summary.done,
                total: summary.total,
                hours: summary.hours.toFixed(2),
                words: summary.words,
              })}
            </Text>

            <Button
              type="primary"
              className="vision-btn-primary"
              icon={<DownloadOutlined />}
              block
              disabled={!summary.done}
              onClick={exportCsv}
            >
              metadata.csv
            </Button>
            <Button
              icon={<DownloadOutlined />}
              block
              disabled={!summary.done}
              onClick={exportManifest}
            >
              manifest.jsonl
            </Button>
            <Button
              icon={<CloudUploadOutlined />}
              block
              disabled={!summary.done}
              onClick={() => setSavingToServer(true)}
            >
              {t('mlSaveToServer')}
            </Button>
            <Button block danger disabled={!summary.done} onClick={clearAll}>
              {t('clearEveryTranscript')}
            </Button>
          </Space>
        </Card>
      </Col>

      <Col span={24} lg={11}>
        <Card
          bordered={false}
          title={current ? current.name : t('noAudioLoaded')}
          extra={current && <Text type="secondary">{`${index + 1} / ${clips.length}`}</Text>}
        >
          {current ? (
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Space size="small" wrap>
                <Tag icon={<SoundOutlined />}>{formatSeconds(current.seconds)}</Tag>
                <Tag>16 kHz mono</Tag>
                <Tag>{`${current.bits}-bit PCM`}</Tag>
                {current.estimated && <Tag color="orange">{t('durationEstimated')}</Tag>}
              </Space>

              {/* Native controls: scrubbing, volume and the keyboard handling
                  that comes with them are all things a hand-rolled player
                  would have to reimplement worse. */}
              <audio
                ref={audioRef}
                src={audioUrl}
                controls
                className="tts-player"
                preload="auto"
              />

              <TextArea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => commit(draft)}
                autoSize={{ minRows: 4, maxRows: 10 }}
                placeholder={t('transcriptPlaceholder')}
              />
              <Text type="secondary">{t('transcriptHint')}</Text>

              <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                <Space>
                  <Button icon={<LeftOutlined />} onClick={() => go(-1)} disabled={index === 0}>
                    {t('previous')}
                  </Button>
                  <Button
                    type="primary"
                    className="vision-btn-primary"
                    icon={<RightOutlined />}
                    onClick={() => go(1)}
                    disabled={index >= clips.length - 1}
                  >
                    {t('next')}
                  </Button>
                </Space>
                <Tooltip title={t('playPauseHint')}>
                  <Button icon={<SoundOutlined />} onClick={togglePlay}>{t('playPause')}</Button>
                </Tooltip>
              </Space>
            </Space>
          ) : (
            <Empty description={t('chooseAudioFolderToBegin')} />
          )}
        </Card>
      </Col>

      <Col span={24} lg={7}>
        <Card title={t('textHistory')} bordered={false}>
          {clips.length ? (
            <List
              size="small"
              dataSource={clips}
              pagination={{
                current: historyPage,
                onChange: setHistoryPage,
                pageSize: HISTORY_PAGE,
                size: 'small',
                showSizeChanger: false,
              }}
              renderItem={(clip, position) => (
                <List.Item
                  className={position === index ? 'tts-history-row is-active' : 'tts-history-row'}
                  onClick={() => { commit(draft); setIndex(position); }}
                >
                  <Space direction="vertical" size={0} style={{ width: '100%' }}>
                    <Space size="small">
                      {flattenText(position === index ? draft : clip.text)
                        ? <CheckCircleFilled className="tts-done-mark" />
                        : <span className="tts-todo-mark" />}
                      <Text strong ellipsis style={{ maxWidth: 150 }}>{clipId(clip.name)}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>{formatSeconds(clip.seconds)}</Text>
                    </Space>
                    <Paragraph
                      type={flattenText(position === index ? draft : clip.text) ? undefined : 'secondary'}
                      ellipsis={{ rows: 2 }}
                      style={{ margin: 0, fontSize: 12 }}
                    >
                      {flattenText(position === index ? draft : clip.text) || t('notTranscribedYet')}
                    </Paragraph>
                  </Space>
                </List.Item>
              )}
            />
          ) : (
            <Text type="secondary">{t('historyAppearsHere')}</Text>
          )}
        </Card>
      </Col>

      <SaveToServerModal
        open={savingToServer}
        onClose={() => setSavingToServer(false)}
        area="speech"
        defaultName={folderName}
        canSave={summary.done > 0}
        prepare={prepareServerSave}
        extra={(
          <Space wrap>
            <Text type="secondary">{t('mlSpokenLanguage')}</Text>
            <Select
              showSearch
              style={{ minWidth: 200 }}
              value={spokenLanguage}
              onChange={pickLanguage}
              options={COMMON_LANGUAGES.map(([code, label]) => ({ value: code, label: `${code} · ${label}` }))}
            />
          </Space>
        )}
      />
    </Row>
  );
}
