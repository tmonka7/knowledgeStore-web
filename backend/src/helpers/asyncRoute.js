/**
 * Express 4 does not await route handlers, so a rejected promise escapes as an
 * unhandled rejection instead of reaching the error middleware in server.js.
 * Wrapping a handler here is what turns a thrown error into a JSON response.
 */
export const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};
