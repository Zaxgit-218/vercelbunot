import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import handler from '../api/index.js';

// Clean test data directory
const dataDir = path.join(process.cwd(), '.data');
const dataFile = path.join(dataDir, 'exchange.json');
try { fs.rmSync(dataFile, { force: true }); } catch {}

// Helper to make mock requests to handler
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

test('1. status returns uninitialized when new', async () => {
  const res = await call('status', 'GET');
  assert.equal(res.status, 200);
  assert.equal(res.data.initialized, false);
});

test('2. setup initializes exchange with organizer password', async () => {
  const res = await call('setup', 'POST', { adminPass: 'supersecret' });
  assert.equal(res.status, 201);
  assert.ok(res.data.token);
  adminToken = res.data.token;

  // Cannot setup twice
  const res2 = await call('setup', 'POST', { adminPass: 'anotherone' });
  assert.equal(res2.status, 409);
});

test('3. admin login succeeds with correct password, fails with wrong password', async () => {
  const failRes = await call('login', 'POST', { adminPass: 'wrongpass' });
  assert.equal(failRes.status, 401);

  const okRes = await call('login', 'POST', { adminPass: 'supersecret' });
  assert.equal(okRes.status, 200);
  assert.ok(okRes.data.token);
});

test('4. participants can register with wishlist', async () => {
  const r1 = await call('register', 'POST', {
    realName: 'Juan Dela Cruz',
    secretName: 'Mystery Mango',
    wishlist: [{ name: 'Fountain Pen', link: 'https://example.com/pen' }]
  });
  assert.equal(r1.status, 200);
  assert.equal(r1.data.participants.length, 1);

  const r2 = await call('register', 'POST', {
    realName: 'Maria Santos',
    secretName: 'Cozy Coffee',
    wishlist: [{ name: 'Mug', link: '' }]
  });
  assert.equal(r2.status, 200);
  assert.equal(r2.data.participants.length, 2);

  // Duplicate realName rejected
  const dup = await call('register', 'POST', {
    realName: 'juan dela cruz',
    secretName: 'Another Alias',
    wishlist: [{ name: 'Book', link: '' }]
  });
  assert.equal(dup.status, 409);
});

test('5. admin can shuffle and pairings are generated with nobody drawing themselves', async () => {
  // Unauthorized without token
  const unauth = await call('shuffle', 'POST', {});
  assert.equal(unauth.status, 403);

  // Authorized with token
  const ok = await call('shuffle', 'POST', {}, adminToken);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.pairings.length, 2);
  assert.ok(ok.data.pairings.every(p => p.giver !== p.receiver));
});

test('6. admin can undo shuffle and restore previous pairings', async () => {
  const firstPairings = (await call('data', 'GET')).data.pairings;

  // Shuffle a second time
  await call('shuffle', 'POST', {}, adminToken);

  // Unshuffle
  const undoRes = await call('unshuffle', 'POST', {}, adminToken);
  assert.equal(undoRes.status, 200);
  assert.deepEqual(undoRes.data.pairings, firstPairings);
});

test('7. admin can edit participant details and pairings update', async () => {
  const editRes = await call('edit', 'POST', {
    realName: 'Juan Dela Cruz',
    newRealName: 'Juan D. Cruz',
    newSecretName: 'Super Mango',
    newWishlist: [{ name: 'Planner', link: 'https://example.com/planner' }]
  }, adminToken);
  assert.equal(editRes.status, 200);
  assert.equal(editRes.data.participants[0].realName, 'Juan D. Cruz');
  assert.equal(editRes.data.participants[0].secretName, 'Super Mango');
});

test('8. admin can import Excel-parsed data', async () => {
  const importRes = await call('import', 'POST', {
    participants: [
      { realName: 'Alice', secretName: 'Sun', wishlist: [{ name: 'Hat', link: '' }] },
      { realName: 'Bob', secretName: 'Moon', wishlist: [{ name: 'Shoes', link: '' }] }
    ],
    pairings: [
      { giver: 'Alice', receiver: 'Bob' },
      { giver: 'Bob', receiver: 'Alice' }
    ]
  }, adminToken);
  assert.equal(importRes.status, 200);
  assert.equal(importRes.data.participants.length, 2);
  assert.equal(importRes.data.pairings.length, 2);
});

test('9. admin can reset exchange', async () => {
  const resetRes = await call('reset', 'POST', {}, adminToken);
  assert.equal(resetRes.status, 200);
  assert.equal(resetRes.data.participants.length, 0);
  assert.equal(resetRes.data.pairings.length, 0);
});
