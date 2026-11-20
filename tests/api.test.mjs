import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import handler from '../api/index.js';
import { MASTERLIST } from '../api/_core.js';

// Clean test data directory
const dataDir = path.join(process.cwd(), '.data');
const dataFile = path.join(dataDir, 'exchange.json');
try { fs.rmSync(dataFile, { force: true }); } catch {}

async function call(action, method = 'GET', body = undefined, token = undefined) {
  let responseData = null;
  let responseStatus = 200;
  let headers = {};

  const req = {
    method,
    url: `/api/${action}`,
    query: { path: action },
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body
  };

  const res = {
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    status(code) { responseStatus = code; return this; },
    json(data) { responseData = data; return this; },
    end(data) {
      if (data && typeof data === 'string') {
        try { responseData = JSON.parse(data); } catch { responseData = data; }
      }
      return this;
    }
  };

  await handler(req, res);
  return { status: responseStatus, data: responseData, headers };
}

let adminToken = '';

test('1. status returns masterlist count of 36', async () => {
  const res = await call('status', 'GET');
  assert.equal(res.status, 200);
  assert.equal(res.data.initialized, false);
  assert.equal(res.data.masterlistCount, 36);
  assert.ok(res.data.masterlist.includes('Gerson Paul Bangoy'));
});

test('2. setup initializes exchange with organizer password', async () => {
  const res = await call('setup', 'POST', { adminPass: 'supersecret' });
  assert.equal(res.status, 201);
  assert.ok(res.data.token);
  adminToken = res.data.token;
});

test('3. registration enforces masterlist membership', async () => {
  // Invalid name rejected
  const fake = await call('register', 'POST', {
    realName: 'Random Stranger',
    secretName: 'Alien',
    wishlist: [{ name: 'Book', link: '' }]
  });
  assert.equal(fake.status, 400);

  // Valid masterlist names accepted
  const r1 = await call('register', 'POST', {
    realName: 'Gerson Paul Bangoy',
    secretName: 'Mystery Mango',
    wishlist: [{ name: 'Headphones', link: 'https://example.com/item' }]
  });
  assert.equal(r1.status, 200);
  assert.equal(r1.data.participants.length, 1);

  const r2 = await call('register', 'POST', {
    realName: 'Michael Angelo Marte Balaso',
    secretName: 'Cozy Coffee',
    wishlist: [{ name: 'Mug', link: '' }]
  });
  assert.equal(r2.status, 200);
  assert.equal(r2.data.participants.length, 2);

  // Duplicate masterlist name rejected
  const dup = await call('register', 'POST', {
    realName: 'gerson paul bangoy',
    secretName: 'Copycat',
    wishlist: [{ name: 'Shoes', link: '' }]
  });
  assert.equal(dup.status, 409);
});

test('4. shuffle generates pairings and marks drawn as false', async () => {
  const ok = await call('shuffle', 'POST', {}, adminToken);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.pairings.length, 2);
  assert.ok(ok.data.pairings.every(p => p.giver !== p.receiver));
  assert.ok(ok.data.pairings.every(p => p.drawn === false));
});

test('5. spin endpoint returns receiver secret name and marks drawn true', async () => {
  const spinRes = await call('spin', 'POST', { realName: 'Gerson Paul Bangoy' });
  assert.equal(spinRes.status, 200);
  assert.equal(spinRes.data.receiverSecretName, 'Cozy Coffee');
  assert.equal(spinRes.data.alreadyDrawn, false);
  assert.equal(spinRes.data.drawnCount, 1);

  // Second spin reports alreadyDrawn: true
  const spin2 = await call('spin', 'POST', { realName: 'Gerson Paul Bangoy' });
  assert.equal(spin2.status, 200);
  assert.equal(spin2.data.alreadyDrawn, true);
});

test('6. undo shuffle restores pairings', async () => {
  await call('shuffle', 'POST', {}, adminToken);
  const undoRes = await call('unshuffle', 'POST', {}, adminToken);
  assert.equal(undoRes.status, 200);
});

test('7. reset clears exchange participants and pairings', async () => {
  const resetRes = await call('reset', 'POST', {}, adminToken);
  assert.equal(resetRes.status, 200);
  assert.equal(resetRes.data.participants.length, 0);
  assert.equal(resetRes.data.pairings.length, 0);
});
