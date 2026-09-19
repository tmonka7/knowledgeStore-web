// This module must stay import-free: userModel imports DEFAULT_USER_PERMISSIONS
// from here, and the permission middleware imports userModel.

export const PERMISSION_CATALOG = [
  { key: 'overview', label: 'Overview', actions: ['view'] },
  { key: 'records', label: 'Data', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'categories', label: 'Category', actions: ['view', 'create', 'delete'] },
  { key: 'cameras', label: 'Camera Management', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'chat', label: 'Chat', actions: ['view', 'create'] },
  { key: 'mail', label: 'Mail', actions: ['view', 'create', 'delete'] },
  { key: 'users', label: 'Users', actions: ['view', 'edit'] },
  { key: 'system-monitor', label: 'System Monitoring', actions: ['view'] },
];

export const ALL_PERMISSIONS = PERMISSION_CATALOG.flatMap(
  (page) => page.actions.map((action) => `${page.key}:${action}`),
);

export const DEFAULT_USER_PERMISSIONS = [
  'overview:view',
  'records:view',
  'categories:view',
  'chat:view',
  'chat:create',
  'mail:view',
  'mail:create',
];

export const sanitizePermissions = (values) => {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value) => ALL_PERMISSIONS.includes(value)))];
};

export const hasPermission = (user, permission) => {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
};
