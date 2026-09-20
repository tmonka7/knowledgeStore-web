import { Button, Form, Input, Tree, TreeSelect } from 'antd';
import { DeleteOutlined, FolderOpenOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useState } from 'react';
import PageHeader from '../components/ui/PageHeader';
import StatusBadge from '../components/ui/StatusBadge';

export default function CategoriesPage({
  categories,
  categoryForm,
  handleCreateCategory,
  handleDeleteCategory,
  loading,
}) {
  const [categorySearch, setCategorySearch] = useState('');

  const categoryTreeData = (items = []) => items.map((item) => ({
    title: item.name,
    value: item.id,
    key: item.id,
    children: categoryTreeData(item.children || []),
  }));

  const filterCategoryTree = (items = [], search = '') => {
    const value = search.trim().toLowerCase();
    if (!value) return items;

    return items.reduce((result, item) => {
      const children = filterCategoryTree(item.children || [], value);
      const matches = item.name.toLowerCase().includes(value);

      if (matches || children.length > 0) {
        result.push({ ...item, children });
      }
      return result;
    }, []);
  };

  const visibleCategories = filterCategoryTree(categories, categorySearch);

  return (
    <div className="vision-page">
      <PageHeader
        title="Category Tree Management"
        subtitle="Create, organise and remove the categories records are filed under."
        actions={<StatusBadge tone="blue">Hierarchy</StatusBadge>}
      />

      <div className="vision-categories-layout">
        <section className="vision-panel vision-panel-tight">
          <h3 className="vision-section-title">New category</h3>
          <Form form={categoryForm} layout="vertical" onFinish={handleCreateCategory}>
            <Form.Item name="name" label="Category name" rules={[{ required: true }]}>
              <Input placeholder="Enter category name" />
            </Form.Item>
            <Form.Item name="parentId" label="Parent category">
              <TreeSelect
                treeData={categoryTreeData(categories)}
                treeDefaultExpandAll
                placeholder="Select parent"
                allowClear
                className="vision-category-select"
              />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              icon={<PlusOutlined />}
              className="vision-btn-primary vision-category-submit"
            >
              Create Category
            </Button>
          </Form>
        </section>

        <section className="vision-panel vision-panel-tight">
          <div className="vision-panel-head">
            <h3 className="vision-section-title">Structure</h3>
            <span className="vision-toolbar-meta">{categories.length} items</span>
          </div>

          <Input
            className="vision-category-search"
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Search category"
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
                    Delete
                  </Button>
                </div>
              )}
            />
          ) : (
            <div className="vision-empty">
              <FolderOpenOutlined />
              No categories match your search.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
