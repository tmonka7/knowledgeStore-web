import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Card, Dropdown, Input, Modal, Radio, Select, Space, Tag, Tooltip, Typography, message,
} from 'antd';
import {
  DeleteOutlined, DownloadOutlined, ImportOutlined, PlusOutlined, ReloadOutlined, RocketOutlined, SaveOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import api from '../../api';
import { useLanguage } from '../../i18n';
import {
  COMMON_LANGUAGES, LANGUAGE_CODE, MAX_ROWS, buildDelimited, buildJsonl, countComplete, downloadText, emptyRow,
  parseImport, safeFileName,
} from '../../lib/translationDataset';
import AlignedTextPanes from './AlignedTextPanes';

const { Text } = Typography;
const { TextArea } = Input;

const DEFAULT_LANGUAGES = ['en', 'es'];

const blankDraft = () => ({ id: null, name: '', languages: DEFAULT_LANGUAGES, rows: [emptyRow(DEFAULT_LANGUAGES)] });

const languageOptions = COMMON_LANGUAGES.map(([code, label]) => ({ value: code, label: `${code} · ${label}` }));

const hasText = (row, code) => Boolean(String(row?.texts?.[code] || '').trim());

/**
 * One language of the dataset as the text of a box: one row per line.
 * Line breaks inside a sentence would shift every pair after it, so they
 * become spaces; trailing empty lines are left off.
 */
const columnText = (rows, code) => {
  const lines = rows.map((row) => String(row.texts?.[code] || '').replace(/[\r\n]+/g, ' '));
  while (lines.length > 1 && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join('\n');
};

/**
 * Rows rebuilt from the two boxes: line N of each is row N. Rows keep their
 * id and any text in languages not on screen, and a row holding such text is
 * never dropped for being past the end of both boxes.
 */
const rowsFromColumns = (rows, languages, left, leftText, right, rightText) => {
  const leftLines = leftText.split('\n');
  const rightLines = rightText.split('\n');
  let keep = 0;
  rows.forEach((row, index) => {
    const other = Object.entries(row.texts || {}).some(([code, text]) => code !== left && code !== right && String(text).trim());
    if (other) keep = index + 1;
  });
  const length = Math.max(leftLines.length, rightLines.length, keep);
  return Array.from({ length }, (_, index) => {
    const row = rows[index] || emptyRow(languages);
    return { ...row, texts: { ...row.texts, [left]: leftLines[index] ?? '', [right]: rightLines[index] ?? '' } };
  });
};

/**
 * Creating and editing multilingual parallel-text datasets.
 *
 * Pairs are edited like an OCR correction screen: two large boxes, one
 * language each, where line N on the left and line N on the right are one
 * pair (see AlignedTextPanes). A dataset with more than two languages is
 * edited two columns at a time, chosen above the boxes.
 *
 * The boxes' text is the editing state; the rows are rebuilt from it on every
 * change, and the boxes are refilled from the rows only when the rows are
 * replaced from outside — opening, importing, saving, switching languages.
 * Deriving the boxes from the rows on every keystroke would move the caret
 * whenever the two sides have different lengths.
 *
 * The whole dataset is saved in one PUT: at the size the API allows, sending
 * it whole is simpler and no slower than tracking row edits.
 */
export default function TranslationDatasetEditor({
  datasets, onDatasetsChange, activeId, onActiveChange, onDirtyChange, onTrain,
}) {
  const { t } = useLanguage();

  const [draft, setDraft] = useState(blankDraft);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [find, setFind] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [pair, setPair] = useState(DEFAULT_LANGUAGES);
  const [boxes, setBoxes] = useState({ left: '', right: '' });
  // Bumped whenever the rows are replaced from outside the boxes.
  const [loadedAt, setLoadedAt] = useState(0);

  const panesRef = useRef(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  // The two edited languages must be languages of the dataset; when the list
  // changes under them, fall back to the first two.
  useEffect(() => {
    setPair(([left, right]) => {
      const { languages } = draft;
      const nextLeft = languages.includes(left) ? left : languages[0];
      const nextRight = languages.includes(right) && right !== nextLeft
        ? right
        : languages.find((code) => code !== nextLeft);
      return nextLeft === left && nextRight === right ? [left, right] : [nextLeft, nextRight];
    });
  }, [draft.languages]); // eslint-disable-line react-hooks/exhaustive-deps

  const [left, right] = pair;

  // Refill the boxes from the rows: on load and when the language pair changes.
  useEffect(() => {
    const { rows } = draftRef.current;
    setBoxes({ left: left ? columnText(rows, left) : '', right: right ? columnText(rows, right) : '' });
  }, [left, right, loadedAt]);

  const loadList = useCallback(async () => {
    try {
      const { data } = await api.get('/tools/transformers/datasets');
      onDatasetsChange(data.datasets || []);
    } catch (error) {
      message.error(error.response?.data?.message || t('translationDatasetsLoadFailed'));
    }
  }, [onDatasetsChange, t]);

  useEffect(() => { loadList(); }, [loadList]);

  const replaceDraft = useCallback((next, isDirty) => {
    draftRef.current = next;
    setDraft(next);
    setDirty(isDirty);
    setLoadedAt((value) => value + 1);
  }, []);

  const showDataset = useCallback((dataset) => {
    const rows = dataset.rows.length ? dataset.rows : [emptyRow(dataset.languages)];
    replaceDraft({ id: dataset.id, name: dataset.name, languages: dataset.languages, rows }, false);
  }, [replaceDraft]);

  const openDataset = useCallback(async (id) => {
    setFind('');
    if (!id) {
      replaceDraft(blankDraft(), false);
      onActiveChange(null);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get(`/tools/transformers/datasets/${id}`);
      showDataset(data.dataset);
      onActiveChange(data.dataset.id);
    } catch (error) {
      message.error(error.response?.data?.message || t('translationDatasetsLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [onActiveChange, replaceDraft, showDataset, t]);

  // Leaving unsaved rows is a confirmation, not a silent loss.
  const guarded = (action) => {
    if (!dirty) {
      action();
      return;
    }
    Modal.confirm({
      title: t('translationDiscardTitle'),
      content: t('translationDiscardBody'),
      okText: t('translationDiscard'),
      okButtonProps: { danger: true },
      onOk: action,
    });
  };

  const update = (patch) => {
    setDraft((current) => ({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) }));
    setDirty(true);
  };

  const setLanguages = (values) => {
    const codes = [...new Set(values.map((value) => String(value).trim()))].filter(Boolean);
    const invalid = codes.find((code) => !LANGUAGE_CODE.test(code));
    if (invalid) {
      message.warning(t('translationBadLanguage', { code: invalid }));
      return;
    }
    // Text for a removed language stays on the row until the next save, so
    // removing one by mistake and adding it straight back loses nothing.
    update({ languages: codes });
  };

  /* ---------------------------------------------------------- the boxes */

  const onBoxChange = (side, text) => {
    const lineCount = text.split('\n').length;
    if (lineCount > MAX_ROWS) {
      message.warning(t('translationRowLimit', { count: MAX_ROWS }));
      return;
    }
    const next = { ...boxes, [side]: text };
    setBoxes(next);
    update((current) => ({
      rows: rowsFromColumns(current.rows, current.languages, left, next.left, right, next.right),
    }));
  };

  const pickLeft = (code) => setPair(([, other]) => [code, other === code ? left : other]);
  const pickRight = (code) => setPair(([other]) => [other === code ? right : other, code]);
  const swapPair = () => setPair(([a, b]) => [b, a]);

  /** The next line (after the current one, wrapping) containing `needle`. */
  const findNext = (value = find) => {
    const needle = value.trim().toLowerCase();
    if (!needle) return;
    const leftLines = boxes.left.toLowerCase().split('\n');
    const rightLines = boxes.right.toLowerCase().split('\n');
    const total = Math.max(leftLines.length, rightLines.length);
    const from = (panesRef.current?.currentLine() ?? -1) + 1;
    for (let step = 0; step < total; step += 1) {
      const line = (from + step) % total;
      if (leftLines[line]?.includes(needle)) return panesRef.current?.jumpTo(line, 'left');
      if (rightLines[line]?.includes(needle)) return panesRef.current?.jumpTo(line, 'right');
    }
    message.info(t('translationNotFound'));
  };

  const editorKeys = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
    }
  };

  /* ------------------------------------------------------ save and delete */

  const save = async () => {
    if (!draft.name.trim()) {
      message.warning(t('translationNameRequired'));
      return;
    }
    if (draft.languages.length < 2) {
      message.warning(t('translationTwoLanguages'));
      return;
    }
    setSaving(true);
    try {
      const body = { name: draft.name, languages: draft.languages, rows: draft.rows };
      const { data } = draft.id
        ? await api.put(`/tools/transformers/datasets/${draft.id}`, body)
        : await api.post('/tools/transformers/datasets', body);
      // The server drops rows that are blank in every language, on both sides
      // at once, so the pairs stay aligned when the boxes are refilled.
      showDataset(data.dataset);
      onActiveChange(data.dataset.id);
      message.success(t('translationSaved'));
      loadList();
    } catch (error) {
      message.error(error.response?.data?.message || t('translationSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!draft.id) return;
    Modal.confirm({
      title: t('translationDeleteTitle', { name: draft.name }),
      content: t('translationDeleteBody'),
      okText: t('delete'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.delete(`/tools/transformers/datasets/${draft.id}`);
          message.success(t('translationDeleted'));
          await openDataset(null);
          loadList();
        } catch (error) {
          message.error(error.response?.data?.message || t('translationSaveFailed'));
        }
      },
    });
  };

  const exportAs = (format) => {
    const dataset = { ...draft, rows: draft.rows.filter((row) => draft.languages.some((code) => hasText(row, code))) };
    const base = safeFileName(draft.name);
    if (format === 'jsonl') downloadText(`${base}.jsonl`, `${buildJsonl(dataset)}\n`, 'application/x-ndjson');
    if (format === 'csv') downloadText(`${base}.csv`, `﻿${buildDelimited(dataset, ',')}`, 'text/csv');
    if (format === 'tsv') downloadText(`${base}.tsv`, buildDelimited(dataset, '\t'), 'text/tab-separated-values');
  };

  const applyImport = ({ rows, languages }, mode) => {
    const nextLanguages = mode === 'replace' && languages.length >= 2
      ? languages
      : [...new Set([...draft.languages, ...languages])];
    const kept = mode === 'replace'
      ? []
      // The blank starter row is not worth keeping ahead of real data.
      : draft.rows.filter((row) => Object.values(row.texts || {}).some((text) => String(text).trim()));
    const merged = [...kept, ...rows];
    if (merged.length > MAX_ROWS) {
      message.warning(t('translationRowLimit', { count: MAX_ROWS }));
    }
    const nextRows = merged.slice(0, MAX_ROWS);
    replaceDraft({
      ...draft,
      languages: nextLanguages,
      rows: nextRows.length ? nextRows : [emptyRow(nextLanguages)],
    }, true);
    message.success(t('translationImported', { count: Math.min(rows.length, MAX_ROWS - kept.length) }));
    setImportOpen(false);
  };

  /* ------------------------------------------------------------- display */

  const stats = useMemo(() => {
    let pairs = 0;
    let halves = 0;
    draft.rows.forEach((row) => {
      const a = hasText(row, left);
      const b = hasText(row, right);
      if (a && b) pairs += 1;
      else if (a || b) halves += 1;
    });
    return { pairs, halves, complete: countComplete(draft.rows, draft.languages) };
  }, [draft.rows, draft.languages, left, right]);

  return (
    <Card
      bordered={false}
      title={t('translationDatasets')}
      extra={(
        <Space wrap>
          <Select
            style={{ minWidth: 240 }}
            placeholder={t('translationPickDataset')}
            value={activeId || undefined}
            onChange={(id) => guarded(() => openDataset(id))}
            options={datasets.map((dataset) => ({
              value: dataset.id,
              label: `${dataset.name} (${dataset.languages.join(' → ')}, ${dataset.rowCount})`,
            }))}
            notFoundContent={t('translationNoDatasets')}
          />
          <Button icon={<PlusOutlined />} onClick={() => guarded(() => openDataset(null))}>
            {t('translationNewDataset')}
          </Button>
          <Tooltip title={t('translationReload')}>
            <Button icon={<ReloadOutlined />} onClick={loadList} />
          </Tooltip>
        </Space>
      )}
      loading={loading}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space wrap align="start" style={{ width: '100%' }}>
          <Input
            style={{ width: 260 }}
            placeholder={t('translationDatasetName')}
            value={draft.name}
            maxLength={120}
            onChange={(event) => update({ name: event.target.value })}
          />
          <Select
            mode="tags"
            style={{ minWidth: 320 }}
            placeholder={t('translationLanguages')}
            value={draft.languages}
            onChange={setLanguages}
            options={languageOptions}
            tokenSeparators={[',', ' ']}
          />
          <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!dirty && Boolean(draft.id)} onClick={save}>
            {t('save')}
          </Button>
          <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>{t('translationImport')}</Button>
          <Dropdown
            menu={{
              items: [
                { key: 'jsonl', label: t('translationExportJsonl') },
                { key: 'csv', label: 'CSV' },
                { key: 'tsv', label: 'TSV' },
              ],
              onClick: ({ key }) => exportAs(key),
            }}
          >
            <Button icon={<DownloadOutlined />}>{t('translationExport')}</Button>
          </Dropdown>
          {onTrain && (
            <Tooltip title={dirty || !draft.id ? t('translationSaveBeforeTraining') : ''}>
              <Button
                icon={<RocketOutlined />}
                disabled={dirty || !draft.id}
                onClick={() => onTrain({ datasetId: draft.id, source: left, target: right })}
              >
                {t('trainButton')}
              </Button>
            </Tooltip>
          )}
          {draft.id && <Button danger icon={<DeleteOutlined />} onClick={remove}>{t('delete')}</Button>}
        </Space>

        <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space wrap>
            <Tag color="green">{t('translationPairCount', { count: stats.pairs })}</Tag>
            {stats.halves > 0 && <Tag color="gold">{t('translationHalfCount', { count: stats.halves })}</Tag>}
            {draft.languages.length > 2 && (
              <Tag>{t('translationCompleteCount', { count: stats.complete })}</Tag>
            )}
            {dirty && <Tag color="orange">{t('translationUnsaved')}</Tag>}
          </Space>
          <Input.Search
            allowClear
            placeholder={t('translationFindLine')}
            value={find}
            onChange={(event) => setFind(event.target.value)}
            onSearch={(value) => findNext(value)}
            enterButton={t('translationFindNext')}
            style={{ maxWidth: 360 }}
          />
        </Space>

        {draft.languages.length < 2 ? (
          <Alert type="warning" showIcon message={t('translationTwoLanguages')} />
        ) : (
          <AlignedTextPanes
            ref={panesRef}
            leftCode={left}
            rightCode={right}
            sourceCode={draft.languages[0]}
            languages={draft.languages}
            leftText={boxes.left}
            rightText={boxes.right}
            onChange={onBoxChange}
            onPickLeft={pickLeft}
            onPickRight={pickRight}
            onSwap={swapPair}
            extraKeys={editorKeys}
          />
        )}

        <Text type="secondary">{t('translationAlignedHelp')}</Text>
      </Space>

      <ImportModal
        open={importOpen}
        languages={draft.languages}
        onCancel={() => setImportOpen(false)}
        onImport={applyImport}
      />
    </Card>
  );
}

function ImportModal({ open, languages, onCancel, onImport }) {
  const { t } = useLanguage();
  const [text, setText] = useState('');
  const [format, setFormat] = useState('auto');
  const [mode, setMode] = useState('append');
  const fileRef = useRef(null);

  useEffect(() => {
    if (open) setText('');
  }, [open]);

  const readFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setText(await file.text());
    const extension = file.name.split('.').pop().toLowerCase();
    if (['csv', 'tsv', 'jsonl'].includes(extension)) setFormat(extension);
    if (extension === 'json') setFormat('jsonl');
  };

  const submit = () => {
    try {
      const parsed = parseImport(text, languages, format);
      if (!parsed.rows.length) {
        message.warning(t('translationNothingToImport'));
        return;
      }
      onImport(parsed, mode);
    } catch (error) {
      message.error(error.message);
    }
  };

  return (
    <Modal
      open={open}
      title={t('translationImport')}
      onCancel={onCancel}
      onOk={submit}
      okText={t('translationImport')}
      width={720}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Text type="secondary">{t('translationImportHelp', { languages: languages.join(', ') })}</Text>
        <Space wrap>
          <Select
            value={format}
            onChange={setFormat}
            style={{ width: 160 }}
            options={[
              { value: 'auto', label: t('translationFormatAuto') },
              { value: 'csv', label: 'CSV' },
              { value: 'tsv', label: 'TSV' },
              { value: 'jsonl', label: 'JSONL' },
            ]}
          />
          <Radio.Group value={mode} onChange={(event) => setMode(event.target.value)}>
            <Radio.Button value="append">{t('translationAppend')}</Radio.Button>
            <Radio.Button value="replace">{t('translationReplace')}</Radio.Button>
          </Radio.Group>
          <Button icon={<UploadOutlined />} onClick={() => fileRef.current?.click()}>{t('translationChooseFile')}</Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,.jsonl,.json"
            style={{ display: 'none' }}
            onChange={readFile}
          />
        </Space>
        <TextArea
          value={text}
          onChange={(event) => setText(event.target.value)}
          autoSize={{ minRows: 8, maxRows: 16 }}
          placeholder={'en,es\nGood morning,Buenos días\n\n{"translation": {"en": "Thank you", "es": "Gracias"}}'}
          style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}
        />
      </Space>
    </Modal>
  );
}
