import express from 'express';
import { createCategoryItem, deleteCategoryItem, listCategories } from '../controllers/categoryController.js';
import { requireAuth, requirePermission } from '../helpers/auth.js';

const router = express.Router();

router.get('/categories', requireAuth, requirePermission('categories:view'), listCategories);
router.post('/categories', requireAuth, requirePermission('categories:create'), createCategoryItem);
router.delete('/categories/:id', requireAuth, requirePermission('categories:delete'), deleteCategoryItem);

export default router;
