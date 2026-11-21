import { executeAction } from './_core.js';
export default function handler(req, res) {
  return executeAction('match-names', req, res);
}
