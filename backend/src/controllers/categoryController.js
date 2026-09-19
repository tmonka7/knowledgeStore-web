import { createCategory, deleteCategoryById, getCategoryTree } from '../models/store.js';

export const listCategories = async (req, res) => {
  try {
    const categories = await getCategoryTree();
    return res.json({ categories });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to load categories.' });
  }
};

export const createCategoryItem = async (req, res) => {
  try {
    const { name, parentId } = req.body || {};
    const category = await createCategory({ name, parentId });
    return res.status(201).json({ category });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'Unable to create category.' });
  }
};

export const deleteCategoryItem = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await deleteCategoryById(id);
    if (!deleted) {
      return res.status(404).json({ message: 'Category not found.' });
    }
    return res.json({ ok: true, message: 'Category deleted.' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to delete category.' });
  }
};
