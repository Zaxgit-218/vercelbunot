import { executeAction } from './_core.js';
export default function handler(req, res) {
  return executeAction('unshuffle', req, res);
}
