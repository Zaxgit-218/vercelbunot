import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

export const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

export const MASTERLIST = [
  // 11 Engineering B - Males
  "Rhedz Ablaze Pace Agtuca",
  "Michael Angelo Marte Balaso",
  "Blev Dominic P. Bandoy",
  "Daniel Condez Carajay",
  "Ethan Miguel Dalisay Gasatan",
  "Samuel Dejecasion Hernandez",
  "Philip John Abranilla Lacro",
  "Lenuel Jake Biñas Lagrada",
  "Gabe Art Vergara Lonzaga",
  "Joesef Mardione Wong Lozada",
  "AJ Salilaguia Malaluan",
  "Neil Adrian Nabuab Matin",
  "Matthew Theodore M. Obrador",
  "Ernie John C. Pialago",
  "Tristan Jhudd Eliang Tulang",
  "Jericho Terrado Vilchez",
  "Gian Kristoff Dane Into Vinson",
  "Gerson Paul Bangoy",
  // 11 Engineering B - Females
  "Crystal Bersabe Agapi",
  "Aiyana Abrazado",
  "Cyahne Ehrlyquine A. Banga",
  "Audrey Anell Ortega Cacho",
  "Samantha Colyn C. Cañada",
  "Angelie Ende",
  "Ricah Elyssa Cavan Galios",
  "Marian Jane Torintera Gomez",
  "Louise Audrey Tolorio Lago",
  "Lyka Moreno Landayao",
  "Angela Nicole C. Lapasaran",
  "Sharlen Amianes Manlangit",
  "Aia Khesia Mangadang Maurin",
  "Alexa Malinao Orio",
  "Jerry Mae Soroysoroy Paje",
  "Syra Platil",
  "Angela Jane Ollos Tangub",
  "Zoe Torrecarion"
];

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, key] = stored.split(':');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(hash, 'hex'));
}

export function createToken(adminHash) {
  const payload = JSON.stringify({ admin: true, t: Date.now() });
  const sig = crypto.createHmac('sha256', adminHash).update(payload).digest('hex');
  return Buffer.from(payload).toString('base64url') + '.' + sig;
}

export function verifyToken(token, adminHash) {
  if (!token || !token.includes('.')) return false;
  try {
    const [b64, sig] = token.split('.');
    const payload = Buffer.from(b64, 'base64url').toString();
    const expected = crypto.createHmac('sha256', adminHash).update(payload).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return false;
    const data = JSON.parse(payload);
    if (Date.now() - data.t > 30 * 24 * 60 * 60 * 1000) return false;
    return true;
  } catch {
    return false;
  }
}

export const view = row => ({
  participants: row.participants || [],
  pairings: row.pairings || [],
  prevPairings: row.prev_pairings || row.prevPairings || [],
  version: row.version || 0,
  masterlist: MASTERLIST
});

// Secret names of everyone who has not been landed on yet (still on the wheel).
// Sorted so the order reveals nothing about who is paired with whom.
export function wheelNames(row) {
  const bySecret = new Map((row.participants || []).map(p => [p.realName, p.secretName]));
  return (row.pairings || [])
    .filter(p => !p.drawn)
    .map(p => bySecret.get(p.receiver))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

// What students see: who is registered and who has spun. No pairings, wishlists, or aliases tied to names.
export const publicView = row => {
  const pairings = row.pairings || [];
  const drawnSet = new Set(pairings.filter(p => p.drawn).map(p => p.giver));
  return {
    participants: (row.participants || []).map(p => ({ realName: p.realName, drawn: drawnSet.has(p.realName) })),
    paired: pairings.length > 0,
    drawnCount: drawnSet.size,
    totalPairings: pairings.length,
    wheelNames: wheelNames(row),
    version: row.version || 0,
    masterlist: MASTERLIST
  };
};

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
let pool = null;
let dbInitialized = false;

if (connectionString) {
  pool = new pg.Pool({
    connectionString,
    ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false }
  });
}

const dataDir = process.env.VERCEL ? '/tmp' : path.join(process.cwd(), '.data');
const dataFile = path.join(dataDir, 'exchange.json');

export async function getRow() {
  if (pool) {
    if (!dbInitialized) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS exchanges (
          id integer PRIMARY KEY,
          admin_hash text NOT NULL,
          participants jsonb DEFAULT '[]'::jsonb NOT NULL,
          pairings jsonb DEFAULT '[]'::jsonb NOT NULL,
          prev_pairings jsonb DEFAULT '[]'::jsonb NOT NULL,
          version integer DEFAULT 0 NOT NULL
        )
      `);
      dbInitialized = true;
    }
    const res = await pool.query('SELECT * FROM exchanges WHERE id = 1');
    return res.rows[0] || null;
  } else {
    try {
      if (!fs.existsSync(dataFile)) return null;
      return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    } catch {
      return null;
    }
  }
}

export async function saveRow(row, isInsert = false) {
  if (pool) {
    if (isInsert) {
      const res = await pool.query(
        `INSERT INTO exchanges (id, admin_hash, participants, pairings, prev_pairings, version)
         VALUES (1, $1, $2, $3, $4, 0)
         ON CONFLICT (id) DO NOTHING
         RETURNING *`,
        [row.admin_hash, JSON.stringify(row.participants), JSON.stringify(row.pairings), JSON.stringify(row.prev_pairings)]
      );
      return res.rows[0] || null;
    } else {
      const res = await pool.query(
        `UPDATE exchanges 
         SET admin_hash = $1, participants = $2, pairings = $3, prev_pairings = $4, version = version + 1
         WHERE id = 1 AND version = $5
         RETURNING *`,
        [row.admin_hash, JSON.stringify(row.participants), JSON.stringify(row.pairings), JSON.stringify(row.prev_pairings), row.version]
      );
      return res.rows[0] || null;
    }
  } else {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (isInsert) {
      const newRow = { id: 1, ...row, version: 0 };
      fs.writeFileSync(dataFile, JSON.stringify(newRow, null, 2));
      return newRow;
    } else {
      const existing = await getRow();
      if (!existing || existing.version !== row.version) return null;
      const updated = { ...row, version: existing.version + 1 };
      fs.writeFileSync(dataFile, JSON.stringify(updated, null, 2));
      return updated;
    }
  }
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

export function verifyAdmin(req, row) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('admin_token='))?.slice(12);
  if (!token || !verifyToken(token, row.admin_hash)) {
    fail(403, 'Admin access required. Please sign in with the organizer password.');
  }
}

export function createSender(res) {
  return (data, status = 200) => {
    if (typeof res.status === 'function') {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(status).json(data);
    }
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(data));
  };
}

export async function executeAction(action, req, res) {
  const send = createSender(res);
  try {
    const method = req.method;

    if (action === 'status') {
      const row = await getRow();
      return send({
        initialized: !!row,
        hasDatabase: !!pool,
        masterlistCount: MASTERLIST.length,
        masterlist: MASTERLIST
      });
    }

    if (action === 'masterlist') {
      return send({ masterlist: MASTERLIST });
    }

    if (action === 'data') {
      const row = await getRow();
      if (!row) fail(409, 'Exchange has not been set up yet. Please ask your organizer to finish setup.');
      return send(publicView(row));
    }

    if (action === 'admin' && method === 'GET') {
      const row = await getRow();
      if (!row) fail(409, 'Exchange has not been set up yet.');
      verifyAdmin(req, row);
      return send(view(row));
    }

    if (method !== 'POST') {
      fail(405, 'Method not allowed.');
    }

    const body = await readBody(req);

    if (action === 'setup') {
      const row = await getRow();
      if (row) fail(409, 'An organizer has already set up this exchange.');
      const { adminPass } = body;
      if (!adminPass || typeof adminPass !== 'string' || adminPass.length < 6) {
        fail(400, 'Organizer password must be at least 6 characters.');
      }
      const admin_hash = hashPassword(adminPass);
      const created = await saveRow({
        admin_hash,
        participants: [],
        pairings: [],
        prev_pairings: []
      }, true);
      if (!created) fail(409, 'Setup is already complete.');
      const token = createToken(admin_hash);
      return send({ token, ...view(created) }, 201);
    }

    const row = await getRow();
    if (!row) fail(409, 'Exchange has not been set up yet.');

    if (action === 'login') {
      const { adminPass } = body;
      if (!adminPass || typeof adminPass !== 'string' || !verifyPassword(adminPass, row.admin_hash)) {
        fail(401, 'Incorrect organizer password.');
      }
      const token = createToken(row.admin_hash);
      return send({ token, ...view(row) });
    }

    let participants = row.participants || [];
    let pairings = row.pairings || [];
    let prev_pairings = row.prev_pairings || [];
    let admin_hash = row.admin_hash;

    // POST /api/register
    if (action === 'register') {
      const { realName, secretName, wishlist } = body;
      if (![realName, secretName].every(v => typeof v === 'string' && v.trim() && v.length <= 150)) {
        fail(400, 'Enter both your real name and secret name (up to 150 characters).');
      }

      // A late sign-up would wipe the draw (and everyone's screenshots), so close registration once paired
      if (pairings.length) {
        fail(409, 'Registration is closed because pairings have already been drawn. Please ask your organizer.');
      }

      // Check masterlist limit
      if (participants.length >= MASTERLIST.length) {
        fail(400, `The exchange has reached the maximum class limit of ${MASTERLIST.length} participants.`);
      }

      // Check if realName is in masterlist
      const matched = MASTERLIST.find(m => m.toLowerCase() === realName.trim().toLowerCase());
      if (!matched) {
        fail(400, 'Please select your name from the 11 Engineering B class masterlist.');
      }
      const officialName = matched;

      if (!Array.isArray(wishlist) || !wishlist.length || wishlist.length > 30) {
        fail(400, 'Add 1 to 30 wishlist items.');
      }
      if (wishlist.some(w => !w || typeof w.name !== 'string' || !w.name.trim() || w.name.length > 500 || typeof w.link !== 'string' || w.link.length > 2000 || (w.link && !/^https?:\/\//i.test(w.link)))) {
        fail(400, 'Wishlist items must have a name and optional http/https link.');
      }
      if (participants.some(p => p.realName.toLowerCase() === officialName.toLowerCase())) {
        fail(409, `${officialName} is already registered!`);
      }

      participants = [...participants, { realName: officialName, secretName: secretName.trim(), wishlist }];
      pairings = [];
      prev_pairings = [];
    }
    // POST /api/spin (Wheel Spin Reveal)
    else if (action === 'spin') {
      const { realName } = body;
      if (!realName || typeof realName !== 'string') fail(400, 'Please provide your registered name.');
      if (!pairings.length) {
        fail(400, "Pairings haven't been drawn yet! Ask your organizer to shuffle.");
      }
      const pairing = pairings.find(p => p.giver.toLowerCase() === realName.trim().toLowerCase());
      if (!pairing) {
        fail(404, 'No pairing found for this name. Make sure you registered.');
      }
      if (pairing.drawn) {
        fail(409, 'You have already spun the wheel. If you lost your result, ask your organizer.');
      }
      const receiver = participants.find(p => p.realName === pairing.receiver);
      if (!receiver) fail(404, 'Recipient participant not found.');

      // The wheel as it looked before this spin (still includes the person being landed on)
      const wheelBefore = wheelNames(row);

      // Eliminate: the receiver leaves the wheel and the giver can no longer spin
      pairings = pairings.map(p => p === pairing ? { ...p, drawn: true } : p);

      const saved = await saveRow({
        ...row,
        admin_hash,
        participants,
        pairings,
        prev_pairings
      });
      if (!saved) fail(409, 'Someone else spun at the same moment. Please try again.');

      return send({
        receiverSecretName: receiver.secretName,
        wishlist: receiver.wishlist,
        wheelNames: wheelBefore,
        drawnCount: pairings.filter(p => p.drawn).length,
        totalPairings: pairings.length
      });
    }
    else if (action === 'change-password') {
      verifyAdmin(req, row);
      const { newAdminPass } = body;
      if (!newAdminPass || typeof newAdminPass !== 'string' || newAdminPass.length < 6) {
        fail(400, 'New password must be at least 6 characters.');
      }
      admin_hash = hashPassword(newAdminPass);
      const updated = await saveRow({ ...row, admin_hash });
      if (!updated) fail(409, 'Conflict saving password.');
      const token = createToken(admin_hash);
      return send({ token, success: true });
    } else if (action === 'shuffle') {
      verifyAdmin(req, row);
      if (participants.length < 2) fail(400, 'Need at least 2 participants to shuffle.');
      prev_pairings = pairings.length > 0 ? [...pairings] : prev_pairings;
      const names = participants.map(p => p.realName);
      for (let i = names.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [names[i], names[j]] = [names[j], names[i]];
      }
      pairings = names.map((giver, i) => ({
        giver,
        receiver: names[(i + 1) % names.length],
        drawn: false
      }));
    } else if (action === 'unshuffle') {
      verifyAdmin(req, row);
      if (!prev_pairings || prev_pairings.length === 0) fail(400, 'No previous pairings to restore.');
      const temp = pairings;
      pairings = prev_pairings;
      prev_pairings = temp;
    } else if (action === 'match-names') {
      // Link registrations made under a nickname/typo (e.g. "reredz") to their official masterlist name
      verifyAdmin(req, row);
      const { matches } = body;
      if (!Array.isArray(matches) || !matches.length || matches.length > MASTERLIST.length) {
        fail(400, 'Choose at least one name to match.');
      }
      participants = [...participants];
      const rename = (list, from, to) => list.map(p => ({
        ...p,
        giver: p.giver === from ? to : p.giver,
        receiver: p.receiver === from ? to : p.receiver,
      }));
      for (const m of matches) {
        if (!m || typeof m.from !== 'string' || typeof m.to !== 'string') fail(400, 'Invalid match.');
        const official = MASTERLIST.find(n => n === m.to);
        if (!official) fail(400, `"${m.to}" is not on the masterlist.`);
        const idx = participants.findIndex(p => p.realName === m.from);
        if (idx === -1) fail(404, `Participant "${m.from}" not found.`);
        if (participants.some((p, i) => i !== idx && p.realName.toLowerCase() === official.toLowerCase())) {
          fail(409, `${official} is already registered separately. Delete the duplicate entry first.`);
        }
        participants[idx] = { ...participants[idx], realName: official };
        pairings = rename(pairings, m.from, official);
        prev_pairings = rename(prev_pairings, m.from, official);
      }
    } else if (action === 'edit') {
      verifyAdmin(req, row);
      const { realName, newRealName, newSecretName, newWishlist } = body;
      if (typeof realName !== 'string' || !realName.trim()) fail(400, 'Specify the participant to edit.');
      const idx = participants.findIndex(p => p.realName === realName);
      if (idx === -1) fail(404, 'Participant not found.');
      const updated = { ...participants[idx] };
      if (typeof newSecretName === 'string' && newSecretName.trim()) {
        if (newSecretName.length > 150) fail(400, 'Secret name must be 150 characters or less.');
        updated.secretName = newSecretName.trim();
      }
      if (typeof newRealName === 'string' && newRealName.trim()) {
        if (newRealName.length > 150) fail(400, 'Real name must be 150 characters or less.');
        if (newRealName.trim().toLowerCase() !== realName.toLowerCase() && participants.some(p => p.realName.toLowerCase() === newRealName.trim().toLowerCase())) {
          fail(409, 'A participant with that real name already exists.');
        }
        const oldName = updated.realName;
        const freshName = newRealName.trim();
        pairings = pairings.map(p => ({
          ...p,
          giver: p.giver === oldName ? freshName : p.giver,
          receiver: p.receiver === oldName ? freshName : p.receiver,
        }));
        prev_pairings = prev_pairings.map(p => ({
          ...p,
          giver: p.giver === oldName ? freshName : p.giver,
          receiver: p.receiver === oldName ? freshName : p.receiver,
        }));
        updated.realName = freshName;
      }
      if (Array.isArray(newWishlist)) {
        if (!newWishlist.length || newWishlist.length > 30) fail(400, 'Wishlist must have 1-30 items.');
        if (newWishlist.some(w => !w || typeof w.name !== 'string' || !w.name.trim() || w.name.length > 500 || typeof w.link !== 'string' || w.link.length > 2000 || (w.link && !/^https?:\/\//i.test(w.link)))) {
          fail(400, 'Invalid wishlist items.');
        }
        updated.wishlist = newWishlist;
      }
      participants = [...participants];
      participants[idx] = updated;
    } else if (action === 'delete') {
      verifyAdmin(req, row);
      const { realName } = body;
      if (typeof realName !== 'string' || !realName.trim()) fail(400, 'Specify the participant to delete.');
      const idx = participants.findIndex(p => p.realName === realName);
      if (idx === -1) fail(404, 'Participant not found.');
      participants = participants.filter((_, i) => i !== idx);
      pairings = [];
      prev_pairings = [];
    } else if (action === 'import') {
      verifyAdmin(req, row);
      const { participants: importedParticipants, pairings: importedPairings } = body;
      if (!Array.isArray(importedParticipants) || !importedParticipants.length) {
        fail(400, 'Import data must contain participants.');
      }
      for (const p of importedParticipants) {
        if (!p || typeof p.realName !== 'string' || !p.realName.trim() || p.realName.length > 150) {
          fail(400, `Invalid participant name: ${p?.realName || '(empty)'}`);
        }
        if (typeof p.secretName !== 'string' || !p.secretName.trim() || p.secretName.length > 150) {
          fail(400, `Invalid secret name for ${p.realName}.`);
        }
        if (!Array.isArray(p.wishlist) || !p.wishlist.length || p.wishlist.length > 30) {
          fail(400, `Invalid wishlist for ${p.realName}.`);
        }
        for (const w of p.wishlist) {
          if (!w || typeof w.name !== 'string' || !w.name.trim() || w.name.length > 500) fail(400, `Invalid wishlist item for ${p.realName}.`);
          if (typeof w.link !== 'string' || w.link.length > 2000 || (w.link && !/^https?:\/\//i.test(w.link))) fail(400, `Invalid wishlist link for ${p.realName}.`);
        }
      }
      const names = new Set();
      for (const p of importedParticipants) {
        const lower = p.realName.trim().toLowerCase();
        if (names.has(lower)) fail(400, `Duplicate participant: ${p.realName}`);
        names.add(lower);
      }
      participants = importedParticipants.map(p => ({
        realName: p.realName.trim(),
        secretName: p.secretName.trim(),
        wishlist: p.wishlist.map(w => ({ name: w.name.trim(), link: w.link || '' }))
      }));
      if (Array.isArray(importedPairings) && importedPairings.length > 0) {
        const validNames = new Set(participants.map(p => p.realName));
        const allValid = importedPairings.every(p => p && typeof p.giver === 'string' && typeof p.receiver === 'string' && validNames.has(p.giver) && validNames.has(p.receiver));
        pairings = allValid ? importedPairings.map(p => ({ ...p, drawn: !!p.drawn })) : [];
      } else {
        pairings = [];
      }
      prev_pairings = [];
    } else if (action === 'reset') {
      verifyAdmin(req, row);
      participants = [];
      pairings = [];
      prev_pairings = [];
    } else {
      fail(404, `Endpoint not found: ${action}`);
    }

    const saved = await saveRow({
      ...row,
      admin_hash,
      participants,
      pairings,
      prev_pairings
    });
    if (!saved) fail(409, 'Conflict: someone else updated the exchange. Please try again.');
    // Only the organizer gets the full data back; a student registering just gets the public view
    return send(action === 'register' ? publicView(saved) : view(saved));
  } catch (error) {
    const status = error.status || 500;
    return send({ error: error.message || 'Server error. Please try again.' }, status);
  }
}
