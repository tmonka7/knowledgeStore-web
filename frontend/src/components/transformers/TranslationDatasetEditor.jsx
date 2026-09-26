import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Card, Dropdown, Empty, Input, Modal, Radio, Select, Space, Table, Tag, Tooltip, Typography, message,
} from 'antd';
import {
  CheckCircleFilled, DeleteOutlined, DownloadOutlined, ImportOutlined, LeftOutlined, PlusOutlined, ReloadOutlined,
  RightOutlined, RocketOutlined, SaveOutlined, SwapOutlined, UploadOutlined,
} from '@ant-design/icons';
import api from '../../api';
import { useLanguage } from '../../i18n';
import {
  COMMON_LANGUAGES, LANGUAGE_CODE, MAX_ROWS, buildDelimited, buildJsonl, countComplete, downloadText, emptyRow,
  parseImport, safeFileName,
} from '../../lib/translationDataset';

const { Text } = Typography;
const { TextArea } = Input;

const PAGE_SIZE = 15;
const DEFAULT_LANGUAGES = ['en', 'es'];

const blankDraft = () => ({ id: null, name: '', languages: DEFAULT_LANGUAGES, rows: [emptyRow(DEFAULT_LANGUAGES)] });

const languageOptions = COMMON_LANGUAGES.map(([code, label]) => ({ value: code, label: `${code} · ${label}` }));

const hasText = (row, code) => Boolean(String(row?.texts?.[code] || '').trim());

/**
 * Creating and editing multilingual parallel-text datasets.
 *
 * Editing is one pair at a time: the selected row's text in two languages sits
 * in two large boxes side by side, with the list of rows beneath for picking
 * which pair to edit. A dataset with more than two languages is edited a pair
 * of columns at a time, chosen above the boxes.
 *
 * The whole dataset is held here and saved in one PUT: at the size the API
 * allows, sending it whole is simpler and no slower than tracking row edits,
 * and it means what is on screen is exactly what gets stored.
 *
 * The stored list lives with the page (`datasets` / `onDatasetsChange`), so the
 * training and Python panels always offer what is actually saved.
 */
export default function TranslationDatasetEditor({
  datasets, onDatasetsChange, activeId, onActiveChange, onDirtyChange, onTrain,
}) {
  const { t } = useLanguage();

  const [draft, setDraft] = useState(blankDraft);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(() => null);
  const [pair, setPair] = useState(DEFAULT_LANGUAGES);

  const leftRef = useRef(null);

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
      return [nextLeft, nextRight];
    });
  }, [draft.languages]); // eslint-disable-line react-hooks/exhaustive-deps

  const [left, right] = pair;

  const loadList = useCallback(async () => {
    try {
      const { data } = await api.get('/tools/transformers/datasets');
      onDatasetsChange(data.datasets || []);
    } catch (error) {
      message.error(error.response?.data?.message || t('translationDatasetsLoadFailed'));
    }
  }, [onDatasetsChange, t]);

  useEffect(() => { loadList(); }, [loadList]);

  const showDataset = useCallback((dataset) => {
    const rows = dataset.rows.length ? dataset.rows : [emptyRow(dataset.languages)];
    setDraft({ id: dataset.id, name: dataset.name, languages: dataset.languages, rows });
    setSelectedId(rows[0].id);
    setDirty(false);
  }, []);

  const openDataset = useCallback(async (id) => {
    setSearch('');
    setPage(1);
    if (!id) {
      const blank = blankDraft();
      setDraft(blank);
      setSelectedId(blank.rows[0].id);
      setDirty(false);
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
  }, [onActiveChange, showDataset, t]);

  // Always have a pair selected while there are rows to select.
  useEffect(() => {
    setSelectedId((current) => (draft.rows.some((row) => row.id === current) ? current : draft.rows[0]?.id || null));
  }, [draft.rows]);

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

  const setText = (rowId, code, value) => update((current) => ({
    rows: current.rows.map((row) => (row.id === rowId ? { ...row, texts: { ...row.texts, [code]: value } } : row)),
  }));

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

  /* ---------------------------------------------------------- pair editing */

  const selectedIndex = draft.rows.findIndex((row) => row.id === selectedId);
  const selected = draft.rows[selectedIndex] || null;

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const numbered = draft.rows.map((row, index) => ({ ...row, number: index + 1 }));
    if (!needle) return numbered;
    return numbered.filter((row) => draft.languages
      .some((code) => String(row.texts?.[code] || '').toLowerCase().includes(needle)));
  }, [draft.rows, draft.languages, search]);

  // Keep the selected row on the visible page of the list.
  useEffect(() => {
    const position = visibleRows.findIndex((row) => row.id === selectedId);
    if (position >= 0) setPage(Math.floor(position / PAGE_SIZE) + 1);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusLeft = () => requestAnimationFrame(() => leftRef.current?.focus());

  const select = (id, focus = false) => {
    setSelectedId(id);
    if (focus) focusLeft();
  };

  const addRow = (focus = true) => {
    if (draft.rows.length >= MAX_ROWS) {
      message.warning(t('translationRowLimit', { count: MAX_ROWS }));
      return;
    }
    const row = emptyRow(draft.languages);
    // Inserted after the selected row, so a pair can be added in context.
    update((current) => {
      const at = current.rows.findIndex((item) => item.id === selectedId);
      const rows = [...current.rows];
      rows.splice(at < 0 ? rows.length : at + 1, 0, row);
      return { rows };
    });
    setSearch('');
    select(row.id, focus);
  };

  const move = (step) => {
    const next = draft.rows[selectedIndex + step];
    if (next) {
      select(next.id, true);
      return;
    }
    // Moving past the last pair starts a new one, unless the last is empty.
    if (step > 0 && selected && draft.languages.some((code) => hasText(selected, code))) addRow();
  };

  const removeRow = (rowId) => {
    const index = draft.rows.findIndex((row) => row.id === rowId);
    const neighbour = draft.rows[index + 1] || draft.rows[index - 1];
    update((current) => {
      const rows = current.rows.filter((row) => row.id !== rowId);
      return { rows: rows.length ? rows : [emptyRow(current.languages)] };
    });
    setSelectedId(neighbour?.id || null);
  };

  const swapPair = () => setPair(([a, b]) => [b, a]);

  const editorKeys = (event) => {
    // Ctrl+Enter: next pair (a new one after the last). Alt+↑/↓: move.
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      move(1);
    } else if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.altKey && event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
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
      const keep = selectedId;
      showDataset(data.dataset);
      // Blank rows are dropped by the server; stay on the pair if it survived.
      if (data.dataset.rows.some((row) => row.id === keep)) setSelectedId(keep);
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
    update({ languages: nextLanguages, rows: nextRows.length ? nextRows : [emptyRow(nextLanguages)] });
    setSearch('');
    setSelectedId((rows[0] || nextRows[0])?.id || null);
    message.success(t('translationImported', { count: Math.min(rows.length, MAX_ROWS - kept.length) }));
    setImportOpen(false);
  };

  /* ------------------------------------------------------------- display */

  const complete = countComplete(draft.rows, draft.languages);
  const pairComplete = left && right ? countComplete(draft.rows, [left, right]) : 0;
  const pairLanguageOptions = draft.languages.map((code) => ({ value: code, label: code }));

  const columns = [
    { title: '#', dataIndex: 'number', width: 64, render: (value) => <Text type="secondary">{value}</Text> },
    ...[left, right].filter(Boolean).map((code) => ({
      key: code,
      title: <Tag color={code === draft.languages[0] ? 'blue' : 'default'}>{code}</Tag>,
      ellipsis: true,
      render: (_, row) => (hasText(row, code)
        ? <span lang={code} dir="auto">{row.texts[code]}</span>
        : <Text type="secondary" italic>{t('translationEmpty')}</Text>),
    })),
    {
      key: 'done',
      width: 48,
      render: (_, row) => (hasText(row, left) && hasText(row, right)
        ? <CheckCircleFilled style={{ color: '#12a370' }} />
        : null),
    },
  ];

  const box = (code, ref, onPick) => (
    <div style={{ flex: '1 1 320px', minWidth: 0 }}>
      <Space style={{ marginBottom: 8 }} wrap>
        <Select size="small" value={code} onChange={onPick} options={pairLanguageOptions} style={{ minWidth: 96 }} />
        <Text type="secondary">{code === draft.languages[0] ? t('translationSource') : t('translationTarget')}</Text>
      </Space>
      <TextArea
        ref={ref}
        value={selected?.texts?.[code] || ''}
        onChange={(event) => selected && setText(selected.id, code, event.target.value)}
        onKeyDown={editorKeys}
        disabled={!selected || !code}
        autoSize={{ minRows: 6, maxRows: 16 }}
        maxLength={2000}
        showCount
        lang={code}
        dir="auto"
        placeholder={code ? t('translationTypeIn', { code }) : ''}
        style={{ fontSize: 15 }}
      />
    </div>
  );

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

        <Space wrap>
          <Tag>{t('translationRowCount', { count: draft.rows.length })}</Tag>
          <Tag color={complete === draft.rows.length ? 'green' : 'gold'}>
            {t('translationCompleteCount', { count: complete })}
          </Tag>
          {draft.languages.length > 2 && left && right && (
            <Tag>{`${left} → ${right}: ${pairComplete}`}</Tag>
          )}
          {dirty && <Tag color="orange">{t('translationUnsaved')}</Tag>}
        </Space>

        {draft.languages.length < 2 && <Alert type="warning" showIcon message={t('translationTwoLanguages')} />}

        {/* The pair being edited: source on the left, target on the right. */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {box(left, leftRef, (code) => setPair(([, other]) => [code, other === code ? left : other]))}
          <Tooltip title={t('translationSwapSides')}>
            <Button icon={<SwapOutlined />} onClick={swapPair} style={{ marginTop: 32 }} disabled={!right} />
          </Tooltip>
          {box(right, null, (code) => setPair(([other]) => [other === code ? right : other, code]))}
        </div>

        <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
          <Space wrap>
            <Button icon={<LeftOutlined />} disabled={selectedIndex <= 0} onClick={() => move(-1)} />
            <Text>{t('translationPairPosition', { current: selectedIndex + 1, total: draft.rows.length })}</Text>
            <Button icon={<RightOutlined />} onClick={() => move(1)} />
            <Button type="dashed" icon={<PlusOutlined />} onClick={() => addRow()}>{t('translationAddRow')}</Button>
            <Button danger icon={<DeleteOutlined />} disabled={!selected} onClick={() => removeRow(selected.id)}>
              {t('translationRemoveRow')}
            </Button>
          </Space>
          <Text type="secondary">{t('translationPairKeys')}</Text>
        </Space>

        <Input.Search
          allowClear
          placeholder={t('translationSearchRows')}
          value={search}
          onChange={(event) => { setSearch(event.target.value); setPage(1); }}
          style={{ maxWidth: 360 }}
        />

        <Table
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={visibleRows}
          onRow={(row) => ({
            onClick: () => select(row.id, true),
            style: {
              cursor: 'pointer',
              background: row.id === selectedId ? 'rgba(47, 107, 255, 0.10)' : undefined,
            },
          })}
          pagination={{ current: page, pageSize: PAGE_SIZE, onChange: setPage, showSizeChanger: false }}
          locale={{ emptyText: <Empty description={t('translationNoRows')} /> }}
        />
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
