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

const SECRET_FIELDS = /pairings|wishlist|secretName|receiver|admin_hash|Headphones|Mug|Mystery Mango|"giver"/;

test('4b. public data never exposes pairings, wishlists, or aliases tied to names', async () => {
  const res = await call('data', 'GET');
  assert.equal(res.status, 200);
  assert.doesNotMatch(JSON.stringify(res.data.participants), SECRET_FIELDS);
  assert.equal(res.data.pairings, undefined);
  assert.equal(res.data.paired, true);
  assert.deepEqual(res.data.wheelNames, ['Cozy Coffee', 'Mystery Mango']);
  assert.ok(res.data.participants.every(p => p.drawn === false));
});

test('4c. registration closes once pairings are drawn', async () => {
  const late = await call('register', 'POST', {
    realName: 'Zoe Torrecarion',
    secretName: 'Latecomer',
    wishlist: [{ name: 'Socks', link: '' }]
  });
  assert.equal(late.status, 409);
});

test('5. spin reveals the match once, eliminates it from the wheel, and removes the spinner', async () => {
  const spinRes = await call('spin', 'POST', { realName: 'Gerson Paul Bangoy' });
  assert.equal(spinRes.status, 200);
  assert.equal(spinRes.data.receiverSecretName, 'Cozy Coffee');
  assert.equal(spinRes.data.drawnCount, 1);
  assert.ok(spinRes.data.wheelNames.includes('Cozy Coffee'), 'wheel before the spin includes the landed name');

  // Landed name is off the wheel and the spinner is marked as spun
  const after = await call('data', 'GET');
  assert.deepEqual(after.data.wheelNames, ['Mystery Mango']);
  assert.equal(after.data.participants.find(p => p.realName === 'Gerson Paul Bangoy').drawn, true);
  assert.doesNotMatch(JSON.stringify(after.data.participants), SECRET_FIELDS);

  // Nobody can spin again for that name to see the result
  const spin2 = await call('spin', 'POST', { realName: 'Gerson Paul Bangoy' });
  assert.equal(spin2.status, 409);
  assert.equal(spin2.data.receiverSecretName, undefined);

  // Organizer can still look it up
  const admin = await call('admin', 'GET', undefined, adminToken);
  assert.equal(admin.data.pairings.find(p => p.giver === 'Gerson Paul Bangoy').receiver, 'Michael Angelo Marte Balaso');
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

test('8. organizer can link nickname registrations to official masterlist names', async () => {
  const wish = [{ name: 'Book', link: '' }];
  const imp = await call('import', 'POST', {
    participants: [
      { realName: 'reredz', secretName: 'Red Fox', wishlist: wish },
      { realName: 'Gerson Paul Bangoy', secretName: 'Mystery Mango', wishlist: wish },
      { realName: 'mikel', secretName: 'Blue Whale', wishlist: wish }
    ],
    pairings: [
      { giver: 'reredz', receiver: 'Gerson Paul Bangoy' },
      { giver: 'Gerson Paul Bangoy', receiver: 'mikel' },
      { giver: 'mikel', receiver: 'reredz' }
    ]
  }, adminToken);
  assert.equal(imp.status, 200);

  // Can't link onto a name someone already registered with
  const clash = await call('match-names', 'POST', { matches: [{ from: 'reredz', to: 'Gerson Paul Bangoy' }] }, adminToken);
  assert.equal(clash.status, 409);

  // Students can't do it
  const noAuth = await call('match-names', 'POST', { matches: [{ from: 'reredz', to: 'Rhedz Ablaze Pace Agtuca' }] });
  assert.equal(noAuth.status, 403);

  const ok = await call('match-names', 'POST', { matches: [
    { from: 'reredz', to: 'Rhedz Ablaze Pace Agtuca' },
    { from: 'mikel', to: 'Michael Angelo Marte Balaso' }
  ] }, adminToken);
  assert.equal(ok.status, 200);
  const names = ok.data.participants.map(p => p.realName);
  assert.deepEqual(names, ['Rhedz Ablaze Pace Agtuca', 'Gerson Paul Bangoy', 'Michael Angelo Marte Balaso']);
  // Pairings and secret names/wishlists follow the rename
  assert.equal(ok.data.pairings[0].giver, 'Rhedz Ablaze Pace Agtuca');
  assert.equal(ok.data.pairings[2].receiver, 'Rhedz Ablaze Pace Agtuca');
  assert.equal(ok.data.participants[0].secretName, 'Red Fox');
});
