import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Input, Select, Space, Tag, Tooltip, Typography, message,
} from 'antd';
import { CaretRightOutlined, ReloadOutlined, RollbackOutlined } from '@ant-design/icons';
import api from '../../api';
import { useLanguage } from '../../i18n';

const { Text } = Typography;
const { TextArea } = Input;

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13 };
const STORAGE_KEY = 'transformers-python-draft';

/*
 * Runs as-is with no packages installed; the transformers half is guarded, so
 * the first click on Run shows the dataset rather than an ImportError.
 */
const DEFAULT_CODE = `# The dataset picked above is written next to this script as dataset.jsonl,
# one {"translation": {"en": ..., "es": ...}} per line. ks_dataset reads it.
from ks_dataset import LANGUAGES, NAME, load, pairs

rows = load()
print(f"{NAME or '(no dataset)'}: {len(rows)} rows, languages {LANGUAGES}")
for row in rows[:5]:
    print(row["translation"])

if len(LANGUAGES) >= 2:
    source, target = LANGUAGES[0], LANGUAGES[1]
    try:
        from transformers import pipeline
    except ImportError:
        print("\\ntransformers is not installed on the server:")
        print("  pip install transformers torch sentencepiece")
    else:
        # Opus-MT has a model for most language pairs; swap in any other.
        translator = pipeline("translation", model=f"Helsinki-NLP/opus-mt-{source}-{target}")
        for text, reference in pairs(source, target)[:5]:
            output = translator(text)[0]["translation_text"]
            print(f"\\n{source}: {text}\\nmodel: {output}\\nreference: {reference}")
`;

const readDraft = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_CODE;
  } catch {
    return DEFAULT_CODE;
  }
};

const formatDuration = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

/**
 * Runs Python on the API server against a saved dataset.
 *
 * The runner reads the dataset as stored, not as it is in the editor, so
 * unsaved edits are called out rather than silently left out of a run.
 */
export default function PythonRunner({ datasets, activeId, activeDirty }) {
  const { t } = useLanguage();

  const [code, setCode] = useState(readDraft);
  const [datasetId, setDatasetId] = useState(activeId || '');
  const [python, setPython] = useState(null);
  const [probing, setProbing] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  // Follows the editor: the dataset being worked on is the one to run against.
  useEffect(() => { setDatasetId(activeId || ''); }, [activeId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, code);
      } catch {
        /* A remembered script is a convenience. */
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [code]);

  const probe = useCallback(async () => {
    setProbing(true);
    try {
      const { data } = await api.get('/tools/transformers/python');
      setPython(data.python);
    } catch (error) {
      setPython({ available: false, message: error.response?.data?.message || error.message });
    } finally {
      setProbing(false);
    }
  }, []);

  useEffect(() => { probe(); }, [probe]);

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      // No client timeout: the server enforces its own, and a first model
      // download can legitimately take minutes.
      const { data } = await api.post('/tools/transformers/run', { code, datasetId: datasetId || undefined }, { timeout: 0 });
      setResult(data);
    } catch (error) {
      message.error(error.response?.data?.message || t('pythonRunFailed'));
    } finally {
      setRunning(false);
    }
  };

  const status = (() => {
    if (!result) return null;
    if (result.timedOut) return <Tag color="red">{t('pythonTimedOut', { seconds: Math.round(result.timeoutMs / 1000) })}</Tag>;
    if (result.exitCode === 0) return <Tag color="green">{t('pythonExitOk')}</Tag>;
    return <Tag color="red">{t('pythonExitCode', { code: result.exitCode })}</Tag>;
  })();

  return (
    <Card
      bordered={false}
      title={t('pythonRunner')}
      extra={(
        <Space wrap>
          {python?.available && (
            <>
              <Tag color="blue">Python {python.version}</Tag>
              {Object.entries(python.packages || {}).map(([name, installed]) => (
                <Tag key={name} color={installed ? 'green' : 'default'}>{installed ? name : `${name} ✕`}</Tag>
              ))}
            </>
          )}
          <Tooltip title={t('pythonCheckAgain')}>
            <Button icon={<ReloadOutlined />} loading={probing} onClick={probe} />
          </Tooltip>
        </Space>
      )}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {python && !python.available && (
          <Alert type="error" showIcon message={t('pythonUnavailable')} description={python.message} />
        )}

        <Space wrap>
          <Select
            style={{ minWidth: 260 }}
            value={datasetId}
            onChange={setDatasetId}
            options={[
              { value: '', label: t('pythonNoDataset') },
              ...datasets.map((dataset) => ({ value: dataset.id, label: `${dataset.name} (${dataset.rowCount})` })),
            ]}
          />
          <Button
            type="primary"
            icon={<CaretRightOutlined />}
            loading={running}
            disabled={!code.trim() || python?.available === false}
            onClick={run}
          >
            {running ? t('pythonRunning') : t('pythonRun')}
          </Button>
          <Tooltip title={t('pythonResetCode')}>
            <Button icon={<RollbackOutlined />} onClick={() => setCode(DEFAULT_CODE)} />
          </Tooltip>
        </Space>

        {activeDirty && datasetId && datasetId === activeId && (
          <Alert type="warning" showIcon message={t('pythonUsesSavedVersion')} />
        )}

        <TextArea
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoSize={{ minRows: 14, maxRows: 32 }}
          spellCheck={false}
          style={MONO}
          onKeyDown={(event) => {
            // Tab indents instead of leaving the editor — this is Python.
            if (event.key === 'Tab' && !event.shiftKey) {
              event.preventDefault();
              const { selectionStart, selectionEnd } = event.target;
              const next = `${code.slice(0, selectionStart)}    ${code.slice(selectionEnd)}`;
              setCode(next);
              requestAnimationFrame(() => {
                event.target.selectionStart = selectionStart + 4;
                event.target.selectionEnd = selectionStart + 4;
              });
            }
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !running) {
              event.preventDefault();
              run();
            }
          }}
        />
        <Text type="secondary">{t('pythonHint')}</Text>

        {result && (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Space wrap>
              {status}
              <Tag>{formatDuration(result.durationMs)}</Tag>
            </Space>
            {(result.stdout || !result.stderr) && (
              <pre style={{ ...MONO, margin: 0, background: '#0f172a', color: '#e2e8f0', borderRadius: 8, padding: 12, maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {result.stdout || t('pythonNoOutput')}
                {result.stdoutTruncated && `\n… ${t('pythonTruncated')}`}
              </pre>
            )}
            {result.stderr && (
              <pre style={{ ...MONO, margin: 0, background: '#2a0f14', color: '#fecaca', borderRadius: 8, padding: 12, maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {result.stderr}
                {result.stderrTruncated && `\n… ${t('pythonTruncated')}`}
              </pre>
            )}
          </Space>
        )}
      </Space>
    </Card>
  );
}
