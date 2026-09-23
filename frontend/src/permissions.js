// Mirrors backend/src/helpers/permissionCatalog.js. These checks only shape the
// UI; the API enforces the same rules via requirePermission.
export const can = (user, page, action = 'view') => {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Array.isArray(user.permissions) && user.permissions.includes(`${page}:${action}`);
};

export const PAGE_PERMISSIONS = {
  overview: { key: 'overview', action: 'view' },
  records: { key: 'records', action: 'view' },
  categories: { key: 'categories', action: 'view' },
  cameras: { key: 'cameras', action: 'view' },
  chat: { key: 'chat', action: 'view' },
  mail: { key: 'mail', action: 'view' },
  meetings: { key: 'meetings', action: 'view' },
  schedule: { key: 'schedule', action: 'view' },
  'lvgl-tool': { key: 'lvgl-tool', action: 'view' },
  'convert-tool': { key: 'convert-tool', action: 'view' },
  yolo: { key: 'yolo', action: 'view' },
  tts: { key: 'tts', action: 'view' },
  transformers: { key: 'transformers', action: 'view' },
  keras: { key: 'keras', action: 'view' },
  projects: { key: 'projects', action: 'view' },
  wallet: { key: 'wallet', action: 'view' },
  contacts: { key: 'contacts', action: 'view' },
  posts: { key: 'posts', action: 'view' },
  users: { key: 'users', action: 'view' },
  database: { key: 'database', action: 'view' },
  'system-monitor': { key: 'system-monitor', action: 'view' },
};

export const canPage = (user, pageKey, action = 'view') => can(user, PAGE_PERMISSIONS[pageKey]?.key || pageKey, action);
