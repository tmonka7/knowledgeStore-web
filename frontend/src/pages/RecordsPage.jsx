import { Button, Checkbox, Input, Select, Tag, TreeSelect } from 'antd';
import * as XLSX from 'xlsx';
import { useEffect, useMemo, useState } from 'react';
import { DownloadOutlined, EditOutlined, EyeOutlined, FolderOutlined, DeleteOutlined } from '@ant-design/icons';
import { can } from '../permissions';
import { useLanguage } from '../i18n';

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
  const [pageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedId, setSelectedId] = useState('');
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
    <div className="records-page-shell">
      <div className="records-filter-bar">
        <div className="filter-grid compact-grid">
          <div className="filter-item search-item">
            <Input
              allowClear
              placeholder={t('searchPlaceholder')}
              value={searchText}
              onChange={(event) => onSearchInputChange(event.target.value)}
              onPressEnter={(event) => onSearchRecords(event.target.value)}
              className="records-search"
            />
          </div>

          <div className="filter-item">
            <TreeSelect
              allowClear
              placeholder={t('allCategories')}
              treeData={categoryTreeData(categories)}
              treeDefaultExpandAll
              value={categoryFilter || undefined}
              onChange={(value) => {
                onCategoryFilterChange(value || '');
                setCurrentPage(1);
              }}
              className="filter-select"
            />
          </div>

          <div className="filter-item date-search-item">
            <Checkbox
              checked={dateSearchEnabled}
              onChange={(event) => onDateSearchEnabledChange(event.target.checked)}
            >
              {t('searchByDate')}
            </Checkbox>
            {dateSearchEnabled && (
              <div className="date-search-range">
                <Input
                  type="date"
                  value={searchDateFrom}
                  onChange={(event) => onSearchDateFromChange(event.target.value)}
                  className="date-search-input"
                  aria-label={t('fromDate')}
                  placeholder={t('fromDate')}
                />
                <span>to</span>
                <Input
                  type="date"
                  value={searchDateTo}
                  onChange={(event) => onSearchDateToChange(event.target.value)}
                  className="date-search-input"
                  aria-label={t('toDate')}
                  placeholder={t('toDate')}
                />
              </div>
            )}
          </div>
        </div>

        <div className="filters-actions">
          <Button type="default" className="secondary-btn" onClick={() => onAiSearch(searchText)}>
            {t('aiSearch')}
          </Button>
          <Button type="primary" className="primary-btn" onClick={() => onSearchRecords(searchText)}>
            {t('search')}
          </Button>
        </div>
      </div>

      <div className="records-toolbar">
        <div className="toolbar-left">
          {can(user, 'records', 'create') && (
            <Button type="primary" className="primary-btn" icon={<FolderOutlined />} onClick={() => setIsAddModalOpen(true)}>
              + {t('uploadData')}
            </Button>
          )}
          <Button className="action-btn" icon={<DownloadOutlined />} onClick={handleExportExcel}>
            {t('exportExcel')}
          </Button>
          {can(user, 'records', 'delete') && (
            <Button className="action-btn" icon={<DeleteOutlined />}>{t('delete')}</Button>
          )}
        </div>

        <div className="toolbar-right">
          <span>{t('totalRecords', { count: normalizedRecords.length })}</span>
          <Select defaultValue="10" className="page-size-select">
            <Select.Option value="10">Show 10</Select.Option>
            <Select.Option value="20">Show 20</Select.Option>
          </Select>
        </div>
      </div>

      <div className="records-workspace single-panel">
        <div className="records-table-panel">
          <table className="records-table">
            <thead>
              <tr>
                <th className="checkbox-col"><input type="checkbox" aria-label="Select all" /></th>
                <th>No.</th>
                <th>Title</th>
                <th>Category</th>
                <th>Upload Time</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {currentRecords.map((record) => (
                <tr
                  key={record.id}
                  className={selectedRecord?.id === record.id ? 'is-selected' : ''}
                  onClick={() => setSelectedId(record.id)}
                >
                  <td className="checkbox-col"><input type="checkbox" aria-label={`Select ${record.name}`} /></td>
                  <td>{String(currentRecords.indexOf(record) + 1 + (currentPage - 1) * pageSize).padStart(2, '0')}</td>
                  <td>
                    <div className="table-name-cell">
                      <span className="file-icon">{record.fileExt === 'PDF' ? '📄' : record.fileExt === 'XLSX' ? '📊' : record.fileExt === 'DOCX' ? '📝' : '📁'}</span>
                      <span>{record.name}</span>
                    </div>
                  </td>
                  <td>
                    <span className="category-tag">{record.category}</span>
                  </td>
                  <td>{record.uploadTime}</td>
                  <td>
                    <div className="row-actions">
                      <Button
                        type="text"
                        icon={<EyeOutlined />}
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
            </tbody>
          </table>

          <div className="records-pagination">
            <button type="button" className="pager-btn" disabled={currentPage === 1} onClick={() => handlePageChange(currentPage - 1)}>&lt;</button>
            {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
              <button
                key={page}
                type="button"
                className={page === currentPage ? 'pager-btn active' : 'pager-btn'}
                onClick={() => handlePageChange(page)}
              >
                {page}
              </button>
            ))}
            <button type="button" className="pager-btn" disabled={currentPage === totalPages} onClick={() => handlePageChange(currentPage + 1)}>&gt;</button>
          </div>
        </div>
      </div>
    </div>
  );
}
