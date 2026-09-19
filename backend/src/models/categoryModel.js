import mongoose from 'mongoose';
import { randomUUID } from 'crypto';

const categorySchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true, default: () => randomUUID() },
  name: { type: String, required: true, trim: true },
  parentId: { type: String, default: null, index: true },
  path: { type: String, default: '', index: true },
  level: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
}, { collection: 'categories' });

export const Category = mongoose.models.Category || mongoose.model('Category', categorySchema);

export const getCategoryById = (id) => Category.findOne({ id });

export const buildCategoryTree = (categories = []) => {
  const items = categories.map((category) => ({
    ...(category.toObject ? category.toObject() : category),
    children: [],
  }));
  const map = new Map(items.map((category) => [category.id, category]));

  const roots = [];
  for (const category of items) {
    if (category.parentId && map.has(category.parentId)) {
      map.get(category.parentId).children.push(category);
    } else {
      roots.push(category);
    }
  }

  return roots;
};

export const getCategoryTree = async () => {
  const categories = await Category.find().sort({ path: 1, createdAt: 1 });
  return buildCategoryTree(categories);
};

export const createCategory = async ({ name, parentId = null }) => {
  const cleanName = String(name || '').trim();
  if (!cleanName) {
    throw new Error('Category name is required.');
  }

  const parent = parentId ? await getCategoryById(parentId) : null;
  const parentPath = parent ? parent.path : '';
  const path = parent ? `${parentPath}/${cleanName}` : cleanName;

  return Category.create({
    id: randomUUID(),
    name: cleanName,
    parentId: parent ? parent.id : null,
    path,
    level: parent ? parent.level + 1 : 0,
  });
};

export const deleteCategoryById = async (id) => {
  const category = await getCategoryById(id);
  if (!category) {
    return false;
  }

  await Category.deleteMany({
    $or: [
      { parentId: category.id },
      { path: new RegExp(`^${category.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) },
    ],
  });

  await category.deleteOne();
  return true;
};

export const ensureSeedCategories = async () => {
  const count = await Category.countDocuments();
  if (count > 0) {
    return [];
  }

  const rootCategories = ['General', 'Projects', 'Research'];
  const created = [];
  for (const name of rootCategories) {
    created.push(await createCategory({ name }));
  }
  return created;
};
