// Mirrors backend/src/helpers/permissionCatalog.js. These checks only shape the
// UI; the API enforces the same rules via requirePermission.
export const can = (user, page, action = 'view') => {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Array.isArray(user.permissions) && user.permissions.includes(`${page}:${action}`);
};
