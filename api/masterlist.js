import { executeAction } from './_core.js';
export default function handler(req, res) {
  return executeAction('masterlist', req, res);
}
