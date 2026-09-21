import { Button, Checkbox, Input, Modal, Select, TreeSelect } from 'antd';
import * as XLSX from 'xlsx';
import { useEffect, useMemo, useState } from 'react';
import {
  ClockCircleOutlined,
  CloudUploadOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  InboxOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import FilterBar from '../components/ui/FilterBar';
import PageHeader from '../components/ui/PageHeader';
import Pagination from '../components/ui/Pagination';
import StatCard from '../components/ui/StatCard';
import StatusBadge from '../components/ui/StatusBadge';
import { can } from '../permissions';
import { useLanguage } from '../i18n';

// Stable colour per category name so the same badge keeps its tone between renders.
const CATEGORY_TONES = ['blue', 'violet', 'cyan', 'green', 'amber', 'red'];
const categoryTone = (category = '') => {
  const seed = [...String(category)].reduce((total, char) => total + char.charCodeAt(0), 0);
  return CATEGORY_TONES[seed % CATEGORY_TONES.length];
};

const deriveMetaFromRecord = (record, index) => {
  const category = record.category || 'Documents';
  const title = record.title || 'Untitled';
  const attachmentName = record.attachment ? record.attachment.split('/').pop() : title;
  const ext = attachmentName.includes('.') ? attachmentName.split('.').pop().toUpperCase() : 'FILE';
  const sizeOptions = ['2.5 MB', '1.2 MB', '5.6 MB', '842 KB', '3.1 MB', '4.2 MB', '1.8 MB', '650 KB', '48.7 MB', '2.8 MB'];
  const locationOptions = ['Local Disk', 'NAS', 'Cloud', 'Archive'];
  const typeOptions = ['PDF', 'XLSX', 'DOCX', 'ZIP', 'JPG', 'CSV'];

  return {
    id: record.id || `DS-${String(index + 1).padStart(3, '0')}`,
    dataType: typeOptions[(index + ext.length) % typeOptions.length],
    size: sizeOptions[(index + title.length) % sizeOptions.length],
    location: locationOptions[(index + category.length) % locationOptions.length],
    tags: category.split('/').filter(Boolean).slice(0, 2),
    fileExt: ext,
    name: title,
    status: index % 2 === 0 ? 'Public' : 'Private',
    uploadTime: record.createdAt ? new Date(record.createdAt).toLocaleString('sv-SE').replace(' ', ' ') : '2025-09-16 11:03',
  };
};

export default function RecordsPage({
  user,
  records,
  categories,
  searchText,
  categoryFilter,
  searchMode,
  dateSearchEnabled,
  searchDateFrom,
  searchDateTo,
  onSearchRecords,
  onSearchInputChange,
  onDateSearchEnabledChange,
  onSearchDateFromChange,
  onSearchDateToChange,
  onCategoryFilterChange,
  onAiSearch,
  setSelectedRecord,
  handleEditRecord,
  handleDeleteRecord,
  setIsAddModalOpen,
}) {
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedId, setSelectedId] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const { t } = useLanguage();

  const categoryTreeData = (items = []) => items.map((item) => ({
    title: item.name,
    value: item.id,
    key: item.id,
    children: categoryTreeData(item.children || []),
  }));

  const normalizedRecords = useMemo(() => records.map((record, index) => ({
    ...record,
    ...deriveMetaFromRecord(record, index),
  })), [records]);

  useEffect(() => {
    if (!normalizedRecords.length) {
      setSelectedId('');
      return;
    }

    if (!selectedId || !normalizedRecords.some((record) => record.id === selectedId)) {
      setSelectedId(normalizedRecords[0].id);
    }
  }, [normalizedRecords, selectedId]);

  const selectedRecord = normalizedRecords.find((record) => record.id === selectedId) || normalizedRecords[0];
  const totalPages = Math.max(1, Math.ceil(normalizedRecords.length / pageSize));
  const currentRecords = normalizedRecords.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handlePageChange = (page) => setCurrentPage(Math.min(Math.max(page, 1), totalPages));

  const fileCount = normalizedRecords.filter((record) => record.attachment).length;
  const folderCount = new Set(normalizedRecords.map((record) => record.category).filter(Boolean)).size;
  const addedThisWeek = normalizedRecords.filter((record) => {
    const created = new Date(record.createdAt).getTime();
    return Number.isFinite(created) && Date.now() - created < 7 * 24 * 60 * 60 * 1000;
  }).length;
  const percentOfRecords = (count) => (normalizedRecords.length
    ? `${Math.round((count / normalizedRecords.length) * 100)}% of total`
    : '0% of total');

  const pageIds = currentRecords.map((record) => record.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
  const someOnPageSelected = !allOnPageSelected && pageIds.some((id) => selectedIds.includes(id));

  const toggleRowSelection = (id, checked) => setSelectedIds((current) => (
    checked ? [...new Set([...current, id])] : current.filter((item) => item !== id)
  ));

  const togglePageSelection = (checked) => setSelectedIds((current) => (
    checked
      ? [...new Set([...current, ...pageIds])]
      : current.filter((id) => !pageIds.includes(id))
  ));

  // The toolbar Delete button was previously inert; it now acts on the checked
  // rows, behind a confirmation because this cannot be undone.
  const deleteSelected = () => {
    if (!selectedIds.length) return;
    Modal.confirm({
      title: t('deleteRecordsQuestion', { count: selectedIds.length }),
      content: t('actionCannotBeUndone'),
      okText: t('delete'),
      okButtonProps: { danger: true },
      onOk: async () => {
        for (const id of selectedIds) {
          // Sequential so a failure stops the run instead of firing every request.
          await handleDeleteRecord?.(id);
        }
        setSelectedIds([]);
      },
    });
  };

  const handleExportExcel = () => {
    const exportRows = currentRecords.map((record, index) => ({
      No: String(index + 1 + (currentPage - 1) * pageSize).padStart(2, '0'),
      Title: record.name,
      Category: record.category,
      UploadTime: record.uploadTime,
      FileType: record.fileExt,
      Status: record.status,
      Location: record.location,
      Size: record.size,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');
    XLSX.writeFile(workbook, `${(searchText || 'data').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-export.xlsx`);
  };

  return (
    <div className="vision-page">
      <PageHeader
        title={t('dataManagement')}
        subtitle={t('dataManagementSubtitle')}
        actions={can(user, 'records', 'create') && (
          <Button
            type="primary"
            className="vision-btn-primary"
            icon={<CloudUploadOutlined />}
            onClick={() => setIsAddModalOpen(true)}
          >
            {t('uploadData')}
          </Button>
        )}
      />

      <div className="vision-stat-grid">
        <StatCard
          tone="blue"
          icon={<DatabaseOutlined />}
          label={t('totalRecordsLabel')}
          value={normalizedRecords.length}
          meta={`${addedThisWeek} added this week`}
          trend={addedThisWeek > 0 ? 'up' : undefined}
        />
        <StatCard
          tone="violet"
          icon={<FileTextOutlined />}
          label={t('files')}
          value={fileCount}
          meta={`${percentOfRecords(fileCount)} of total`}
        />
        <StatCard
          tone="green"
          icon={<FolderOutlined />}
          label={t('folders')}
          value={folderCount}
          meta={t('distinctCategories')}
        />
        <StatCard
          tone="cyan"
          icon={<ClockCircleOutlined />}
          label={t('addedThisWeek')}
          value={addedThisWeek}
          meta={t('lastSevenDays')}
        />
      </div>

      <FilterBar
        actions={(
          <>
            <Button className="vision-btn-ai" icon={<ThunderboltOutlined />} onClick={() => onAiSearch(searchText)}>
              {t('aiSearch')}
            </Button>
            <Button
              type="primary"
              className="vision-btn-primary"
              icon={<SearchOutlined />}
              onClick={() => onSearchRecords(searchText)}
            >
              {t('search')}
            </Button>
          </>
        )}
      >
        <Input
          allowClear
          className="vision-filter-search"
          prefix={<SearchOutlined />}
          placeholder={t('searchPlaceholder')}
          value={searchText}
          onChange={(event) => onSearchInputChange(event.target.value)}
          onPressEnter={(event) => onSearchRecords(event.target.value)}
        />

        <TreeSelect
          allowClear
          className="vision-filter-select"
          placeholder={t('allCategories')}
          treeData={categoryTreeData(categories)}
          treeDefaultExpandAll
          value={categoryFilter || undefined}
          onChange={(value) => {
            onCategoryFilterChange(value || '');
            setCurrentPage(1);
          }}
        />

        <Checkbox
          checked={dateSearchEnabled}
          onChange={(event) => onDateSearchEnabledChange(event.target.checked)}
        >
          {t('searchByDate')}
        </Checkbox>

        {dateSearchEnabled && (
          <div className="vision-date-range">
            <Input
              type="date"
              value={searchDateFrom}
              onChange={(event) => onSearchDateFromChange(event.target.value)}
              aria-label={t('fromDate')}
            />
            <span>{t('to')}</span>
            <Input
              type="date"
              value={searchDateTo}
              onChange={(event) => onSearchDateToChange(event.target.value)}
              aria-label={t('toDate')}
            />
          </div>
        )}
      </FilterBar>

      <div className="vision-toolbar">
        <div className="vision-toolbar-group">
          {can(user, 'records', 'create') && (
            <Button
              type="primary"
              className="vision-btn-primary"
              icon={<CloudUploadOutlined />}
              onClick={() => setIsAddModalOpen(true)}
            >
              {t('uploadData')}
            </Button>
          )}
          <Button className="vision-btn-ghost" icon={<DownloadOutlined />} onClick={handleExportExcel}>
            {t('exportExcel')}
          </Button>
          {can(user, 'records', 'delete') && (
            <Button
              className="vision-btn-ghost"
              danger={selectedIds.length > 0}
              icon={<DeleteOutlined />}
              disabled={selectedIds.length === 0}
              onClick={deleteSelected}
            >
              {t('delete')}
              {selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
            </Button>
          )}
        </div>

        <div className="vision-toolbar-group">
          <span className="vision-toolbar-meta">{t('totalRecords', { count: normalizedRecords.length })}</span>
          <Select
            value={String(pageSize)}
            onChange={(value) => {
              setPageSize(Number(value));
              setCurrentPage(1);
            }}
            className="vision-page-size"
            options={[
              { value: '10', label: t('showCount', { count: 10 }) },
              { value: '20', label: t('showCount', { count: 20 }) },
              { value: '50', label: t('showCount', { count: 50 }) },
            ]}
          />
        </div>
      </div>

      <div className="vision-table-panel">
        <div className="vision-table-scroll">
          <table className="vision-data-table">
            <thead>
              <tr>
                <th className="col-check">
                  <Checkbox
                    checked={allOnPageSelected}
                    indeterminate={someOnPageSelected}
                    onChange={(event) => togglePageSelection(event.target.checked)}
                    aria-label={t('selectAllRows')}
                  />
                </th>
                <th className="col-no">{t('number')}</th>
                <th>{t('title')}</th>
                <th>{t('category')}</th>
                <th>{t('uploadTime')}</th>
                <th className="col-actions">{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {currentRecords.map((record, index) => (
                <tr
                  key={record.id}
                  className={selectedRecord?.id === record.id ? 'is-selected' : ''}
                  onClick={() => setSelectedId(record.id)}
                >
                  <td className="col-check" onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.includes(record.id)}
                      onChange={(event) => toggleRowSelection(record.id, event.target.checked)}
                      aria-label={`Select ${record.name}`}
                    />
                  </td>
                  <td className="col-no">{String(index + 1 + (currentPage - 1) * pageSize).padStart(2, '0')}</td>
                  <td>
                    <div className="vision-file-cell">
                      <span className="vision-file-icon">
                        {record.attachment ? <FileTextOutlined /> : <FolderOpenOutlined />}
                      </span>
                      <span className="vision-file-name" title={record.name}>{record.name}</span>
                    </div>
                  </td>
                  <td>
                    <StatusBadge tone={categoryTone(record.category)}>{record.category}</StatusBadge>
                  </td>
                  <td className="vision-cell-muted">{record.uploadTime}</td>
                  <td className="col-actions">
                    <div className="vision-row-actions">
                      <Button
                        type="text"
                        icon={<EyeOutlined />}
                        aria-label={`Preview ${record.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedRecord?.(record);
                          setSelectedId(record.id);
                        }}
                      />
                      {can(user, 'records', 'edit') && (
                        <Button
                          type="text"
                          icon={<EditOutlined />}
                          aria-label={`Edit ${record.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleEditRecord?.(record);
                          }}
                        />
                      )}
                      {can(user, 'records', 'delete') && (
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          aria-label={`Delete ${record.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDeleteRecord?.(record.id);
                          }}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}

              {currentRecords.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="vision-empty">
                      <InboxOutlined />
                      <span>No records match your search.</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Pagination current={currentPage} total={totalPages} onChange={handlePageChange} />
      </div>
    </div>
  );
}
