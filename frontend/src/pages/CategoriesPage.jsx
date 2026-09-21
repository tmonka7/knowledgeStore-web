import { Button, Form, Input, Tree, TreeSelect } from 'antd';
import { DeleteOutlined, FolderOpenOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useMemo, useState } from 'react';
import PageHeader from '../components/ui/PageHeader';
import StatusBadge from '../components/ui/StatusBadge';
import { useLanguage } from '../i18n';

const categoryTreeData = (items = []) => items.map((item) => ({
  title: item.name,
  value: item.id,
  key: item.id,
  children: categoryTreeData(item.children || []),
}));

export default function CategoriesPage({
  categories,
  categoryForm,
  handleCreateCategory,
  handleDeleteCategory,
  loading,
}) {
  const [categorySearch, setCategorySearch] = useState('');
  const { t } = useLanguage();

  const visibleCategories = useMemo(() => {
    const needle = categorySearch.trim().toLowerCase();
    if (!needle) return categories;

    const filter = (items) => items
      .map((item) => ({ ...item, children: filter(item.children || []) }))
      .filter((item) => item.name.toLowerCase().includes(needle) || item.children.length > 0);

    return filter(categories);
  }, [categories, categorySearch]);

  return (
    <div className="vision-page vision-stack">
      <PageHeader
        title={t('categoryTreeManagement')}
        subtitle={t('categoryTreeSubtitle')}
        actions={<StatusBadge tone="blue">{t('hierarchy')}</StatusBadge>}
      />

      <div className="vision-category-layout">
        <section className="vision-panel vision-panel-tight">
          <h3 className="vision-section-title">{t('newCategory')}</h3>
          <Form form={categoryForm} layout="vertical" onFinish={handleCreateCategory}>
            <Form.Item name="name" label={t('categoryName')} rules={[{ required: true }]}>
              <Input placeholder={t('enterCategoryName')} />
            </Form.Item>
            <Form.Item name="parentId" label={t('parentCategory')}>
              <TreeSelect
                treeData={categoryTreeData(categories)}
                treeDefaultExpandAll
                placeholder={t('selectParent')}
                allowClear
                style={{ width: '100%' }}
              />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              icon={<PlusOutlined />}
              className="vision-btn-primary vision-category-submit"
            >
              {t('createCategory')}
            </Button>
          </Form>
        </section>

        <section className="vision-panel vision-panel-tight">
          <div className="vision-panel-head">
            <h3 className="vision-section-title">{t('structure')}</h3>
            <span className="vision-toolbar-meta">{t('itemsCount', { count: categories.length })}</span>
          </div>

          <Input
            className="vision-category-search"
            allowClear
            prefix={<SearchOutlined />}
            placeholder={t('searchCategory')}
            value={categorySearch}
            onChange={(event) => setCategorySearch(event.target.value)}
          />

          {visibleCategories.length > 0 ? (
            <Tree
              className="vision-category-tree"
              treeData={categoryTreeData(visibleCategories)}
              defaultExpandAll
              showLine
              blockNode
              titleRender={(nodeData) => (
                <div className="vision-category-node">
                  <span className="vision-category-node-label">{nodeData.title}</span>
                  <Button
                    size="small"
                    danger
                    type="text"
                    icon={<DeleteOutlined />}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleDeleteCategory(nodeData.value);
                    }}
                  >
                    {t('delete')}
                  </Button>
                </div>
              )}
            />
          ) : (
            <div className="vision-empty">
              <FolderOpenOutlined />
              {t('noCategoriesMatch')}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}