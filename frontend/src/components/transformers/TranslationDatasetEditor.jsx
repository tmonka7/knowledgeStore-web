import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Card, Dropdown, Empty, Input, Modal, Radio, Select, Space, Table, Tag, Tooltip, Typography, message,
} from 'antd';
import {
  DeleteOutlined, DownloadOutlined, ImportOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, UploadOutlined,
} from '@ant-design/icons';
import api from '../../api';
import { useLanguage } from '../../i18n';
import {
  COMMON_LANGUAGES, LANGUAGE_CODE, MAX_ROWS, buildDelimited, buildJsonl, countComplete, downloadText, emptyRow,
  parseImport, safeFileName,
} from '../../lib/translationDataset';

const { Text } = Typography;
const { TextArea } = Input;

const PAGE_SIZE = 20;
const DEFAULT_LANGUAGES = ['en', 'es'];

const blankDraft = () => ({ id: null, name: '', languages: DEFAULT_LANGUAGES, rows: [emptyRow(DEFAULT_LANGUAGES)] });

const languageOptions = COMMON_LANGUAGES.map(([code, label]) => ({ value: code, label: `${code} · ${label}` }));

/**
 * Creating and editing multilingual parallel-text datasets.
 *
 * The whole dataset is held here and saved in one PUT: at the size the API
 * allows, sending it whole is simpler and no slower than tracking row edits,
 * and it means what is on screen is exactly what gets stored.
 *
 * The stored list lives with the page (`datasets` / `onDatasetsChange`), so the
 * Python runner beside this always offers what is actually saved.
 */
export default function TranslationDatasetEditor({
  datasets, onDatasetsChange, activeId, onActiveChange, onDirtyChange,
}) {
  const { t } = useLanguage();

  const [draft, setDraft] = useState(blankDraft);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const loadList = useCallback(async () => {
    try {
      const { data } = await api.get('/tools/transformers/datasets');
      onDatasetsChange(data.datasets || []);
    } catch (error) {
      message.error(error.response?.data?.message || t('translationDatasetsLoadFailed'));
    }
  }, [onDatasetsChange, t]);

  useEffect(() => { loadList(); }, [loadList]);

  const openDataset = useCallback(async (id) => {
    if (!id) {
      setDraft(blankDraft());
      setDirty(false);
      setPage(1);
      onActiveChange(null);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get(`/tools/transformers/datasets/${id}`);
      const { dataset } = data;
      setDraft({
        id: dataset.id,
        name: dataset.name,
        languages: dataset.languages,
        rows: dataset.rows.length ? dataset.rows : [emptyRow(dataset.languages)],
      });
      setDirty(false);
      setPage(1);
      setSearch('');
      onActiveChange(dataset.id);
    } catch (error) {
      message.error(error.response?.data?.message || t('translationDatasetsLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [onActiveChange, t]);

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

  const addRow = () => {
    if (draft.rows.length >= MAX_ROWS) {
      message.warning(t('translationRowLimit', { count: MAX_ROWS }));
      return;
    }
    update((current) => ({ rows: [...current.rows, emptyRow(current.languages)] }));
    setSearch('');
    setPage(Math.ceil((draft.rows.length + 1) / PAGE_SIZE));
  };

  const removeRow = (rowId) => update((current) => ({ rows: current.rows.filter((row) => row.id !== rowId) }));

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
      const { dataset } = data;
      setDraft({
        id: dataset.id,
        name: dataset.name,
        languages: dataset.languages,
        rows: dataset.rows.length ? dataset.rows : [emptyRow(dataset.languages)],
      });
      setDirty(false);
      onActiveChange(dataset.id);
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
    const dataset = { ...draft, rows: draft.rows.filter((row) => draft.languages.some((code) => row.texts?.[code]?.trim())) };
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
    update({ languages: nextLanguages, rows: merged.slice(0, MAX_ROWS) });
    setPage(1);
    setSearch('');
    message.success(t('translationImported', { count: Math.min(rows.length, MAX_ROWS - kept.length) }));
    setImportOpen(false);
  };

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const numbered = draft.rows.map((row, index) => ({ ...row, number: index + 1 }));
    if (!needle) return numbered;
    return numbered.filter((row) => draft.languages
      .some((code) => String(row.texts?.[code] || '').toLowerCase().includes(needle)));
  }, [draft.rows, draft.languages, search]);

  const complete = countComplete(draft.rows, draft.languages);

  const columns = [
    { title: '#', dataIndex: 'number', width: 56, render: (value) => <Text type="secondary">{value}</Text> },
    ...draft.languages.map((code, index) => ({
      key: code,
      title: (
        <Space size={4}>
          <Tag color={index === 0 ? 'blue' : 'default'}>{code}</Tag>
          <Text type="secondary">{index === 0 ? t('translationSource') : t('translationTarget')}</Text>
        </Space>
      ),
      render: (_, row) => (
        <TextArea
          value={row.texts?.[code] || ''}
          onChange={(event) => setText(row.id, code, event.target.value)}
          autoSize={{ minRows: 1, maxRows: 6 }}
          maxLength={2000}
          lang={code}
          dir="auto"
        />
      ),
    })),
    {
      key: 'remove',
      width: 56,
      render: (_, row) => (
        <Tooltip title={t('translationRemoveRow')}>
          <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeRow(row.id)} />
        </Tooltip>
      ),
    },
  ];

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
          {draft.id && <Button danger icon={<DeleteOutlined />} onClick={remove}>{t('delete')}</Button>}
        </Space>

        <Space wrap>
          <Tag>{t('translationRowCount', { count: draft.rows.length })}</Tag>
          <Tag color={complete === draft.rows.length ? 'green' : 'gold'}>
            {t('translationCompleteCount', { count: complete })}
          </Tag>
          {dirty && <Tag color="orange">{t('translationUnsaved')}</Tag>}
        </Space>

        {draft.languages.length < 2 && <Alert type="warning" showIcon message={t('translationTwoLanguages')} />}

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
          pagination={{ current: page, pageSize: PAGE_SIZE, onChange: setPage, showSizeChanger: false }}
          locale={{ emptyText: <Empty description={t('translationNoRows')} /> }}
          scroll={{ x: 'max-content' }}
        />

        <Button type="dashed" icon={<PlusOutlined />} onClick={addRow} block>{t('translationAddRow')}</Button>
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
