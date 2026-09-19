import { Button, Card, Form, Input, Tag, Tree, TreeSelect, Typography } from 'antd';
import { useState } from 'react';

const { Text } = Typography;

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
    <Card className="category-manager-card" title="Category Tree Management" extra={<Tag color="blue">Hierarchy</Tag>}>
      <div className="category-manager-layout">
        <div className="category-form-panel">
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
                style={{ width: '100%' }}
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} className="category-create-btn">
              Create Category
            </Button>
          </Form>
        </div>

        <div className="category-tree-panel">
          <div className="category-tree-header">
            <Text strong>Structure</Text>
            <Text type="secondary">{categories.length} items</Text>
          </div>

          <Input
            className="category-search-input"
            allowClear
            placeholder="Search category"
            value={categorySearch}
            onChange={(event) => setCategorySearch(event.target.value)}
            style={{ marginBottom: 12 }}
          />

          {visibleCategories.length > 0 ? (
            <Tree
              className="modern-category-tree"
              treeData={categoryTreeData(visibleCategories)}
              defaultExpandAll
              showLine
              blockNode
              titleRender={(nodeData) => (
                <div className="category-node-row">
                  <span className="category-node-label">{nodeData.title}</span>
                  <Button
                    size="small"
                    danger
                    type="text"
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
            <div className="category-empty-state">
              <Text type="secondary">No categories match your search.</Text>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
