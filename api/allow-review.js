import { executeAction } from './_core.js';
export default function handler(req, res) {
  return executeAction('allow-review', req, res);
}
