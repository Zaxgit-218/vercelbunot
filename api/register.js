import { executeAction } from './_core.js';
export default function handler(req, res) {
  return executeAction('register', req, res);
}
