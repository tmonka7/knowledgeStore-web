// This module must stay import-free: userModel imports DEFAULT_USER_PERMISSIONS
// from here, and the permission middleware imports userModel.

export const PERMISSION_CATALOG = [
  { key: 'overview', label: 'Overview', actions: ['view'] },
  { key: 'records', label: 'Data', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'categories', label: 'Category', actions: ['view', 'create', 'delete'] },
  { key: 'cameras', label: 'Camera Management', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'attendance', label: 'Camera Management / Automatic Attendance', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'chat', label: 'Chat', actions: ['view', 'create'] },
  { key: 'mail', label: 'Mail', actions: ['view', 'create', 'delete'] },
  { key: 'meetings', label: 'Meetings', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'schedule', label: 'Schedule', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'lvgl-tool', label: 'Tools / LVGL image/font converter', actions: ['view'] },
  { key: 'convert-tool', label: 'Tools / Converting', actions: ['view'] },
  { key: 'yolo', label: 'Tools / YOLO dataset', actions: ['view'] },
  { key: 'tts', label: 'Tools / AI / TTS speech dataset', actions: ['view'] },
  { key: 'transformers', label: 'Tools / Transformers dataset', actions: ['view'] },
  { key: 'keras', label: 'Tools / Keras dataset', actions: ['view'] },
  { key: 'projects', label: 'Project Management', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'wallet', label: 'My Page / Wallet', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'contacts', label: 'My Page / Contacts', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'posts', label: 'Posts', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'users', label: 'Users', actions: ['view', 'edit'] },
  { key: 'database', label: 'Database Management', actions: ['view', 'manage'] },
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
  // Everyone can be in a meeting and book one. Editing and deleting are in the
  // defaults too, because they are scoped to your own meetings in the
  // controller — holding them does not let you touch anybody else's room.
  'meetings:view',
  'meetings:create',
  'meetings:edit',
  'meetings:delete',
  'schedule:view',
  'schedule:create',
  'schedule:edit',
  'schedule:delete',
  'projects:view',
  'projects:create',
  'projects:edit',
  'wallet:view',
  'wallet:create',
  'wallet:edit',
  'wallet:delete',
  'contacts:view',
  'contacts:create',
  'contacts:edit',
  'contacts:delete',
  // Everyone reads posts; writing them is an administrator's job, so only
  // 'view' is granted by default.
  'posts:view',
  'lvgl-tool:view',
  'convert-tool:view',
  'yolo:view',
  'tts:view',
  'transformers:view',
  'keras:view',
  // 'attendance:*' is deliberately absent, exactly as 'cameras:*' is. A sweep
  // turns a camera by remote control and writes a biometric record of
  // everyone standing in front of it, and the lists it produces say where
  // named people were and when. An administrator grants it per account, so
  // there is also nothing for permissionBackfill.js to hand out.
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
