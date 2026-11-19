import { executeAction } from './_core.js';
export default function handler(req, res) {
  return executeAction('change-password', req, res);
}
