import { executeAction } from './_core.js';

export default function handler(req, res) {
  let action = req.query?.action;
  if (!action && req.query?.path) {
    action = Array.isArray(req.query.path) ? req.query.path.join('/') : req.query.path;
  }
  if (!action) {
    const parsed = new URL(req.url, 'http://localhost');
    action = parsed.searchParams.get('action') || parsed.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  }
  action = (action || '').split('?')[0].replace(/^\/+|\/+$/g, '');

  if (!action) {
    // Default to status check for root /api
    action = 'status';
  }

  return executeAction(action, req, res);
}
