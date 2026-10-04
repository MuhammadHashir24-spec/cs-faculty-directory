'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { createDb } = require('./db');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_OK = /^https?:\/\/\S+$/i;
const SESSION_MS = 1000 * 60 * 60 * 12;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function clean(b) {
  b = b && typeof b === 'object' ? b : {};
  const s = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const areas = (Array.isArray(b.areas) ? b.areas : []).map((a) => s(a, 60)).filter(Boolean).slice(0, 12);
  const o = {
    name: s(b.name, 100), designation: s(b.designation, 60), qualification: s(b.qualification, 120), areas,
    email: s(b.email, 120), office: s(b.office, 80), hours: s(b.hours, 120), phone: s(b.phone, 50),
    courses: s(b.courses, 300), link: s(b.link, 300), bio: s(b.bio, 600),
  };
  if (!o.name) throw new HttpError(400, 'Name is required.');
  if (o.email && !EMAIL.test(o.email)) throw new HttpError(400, 'That email address does not look right.');
  if (o.link && !URL_OK.test(o.link)) throw new HttpError(400, 'The profile link must start with http:// or https://.');
  return o;
}

function createApp({ pool, adminPassword, sessionSecret, production }) {
  if (!adminPassword || adminPassword.length < 8) throw new Error('ADMIN_PASSWORD must be set and at least 8 characters.');
  if (!sessionSecret || sessionSecret.length < 16) throw new Error('SESSION_SECRET must be set and at least 16 characters.');

  const db = createDb(pool);
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  /* ---- sessions: HMAC-signed expiry in an HttpOnly cookie ---- */
  const sign = (exp) => exp + '.' + crypto.createHmac('sha256', sessionSecret).update(String(exp)).digest('hex');
  function isAdmin(req) {
    const m = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || '');
    if (!m) return false;
    const [exp, sig] = decodeURIComponent(m[1]).split('.');
    if (!exp || !sig || !(Number(exp) > Date.now())) return false;
    const good = Buffer.from(sign(exp).split('.')[1]);
    const got = Buffer.from(sig);
    return good.length === got.length && crypto.timingSafeEqual(good, got);
  }
  function setCookie(res, value, maxAgeSec) {
    res.append('Set-Cookie', `sid=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${production ? '; Secure' : ''}`);
  }
  const requireAdmin = (req, res, next) => (isAdmin(req) ? next() : next(new HttpError(401, 'Sign in as admin to make changes.')));
  const requireJson = (req, res, next) => (req.is('application/json') ? next() : next(new HttpError(415, 'Send JSON.')));

  const attempts = new Map();
  function limited(ip) {
    const now = Date.now();
    const a = attempts.get(ip);
    if (!a || a.reset < now) { attempts.set(ip, { n: 0, reset: now + 10 * 60 * 1000 }); return false; }
    return a.n >= 8;
  }

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  /* ---- public ---- */
  app.get('/api/directory', wrap(async (req, res) => {
    const [meta, faculty, updated] = await Promise.all([db.getSettings(), db.list(), db.updatedAt()]);
    res.set('Cache-Control', 'no-cache');
    res.json({ meta, faculty, updated });
  }));
  app.get('/api/session', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ admin: isAdmin(req) }); });
  app.get('/healthz', (req, res) => res.type('text').send('ok'));

  /* ---- admin session ---- */
  app.post('/api/login', requireJson, (req, res, next) => {
    if (limited(req.ip)) return next(new HttpError(429, 'Too many attempts. Wait 10 minutes and try again.'));
    const given = Buffer.from(String((req.body && req.body.password) || ''));
    const real = Buffer.from(adminPassword);
    const ok = given.length === real.length && crypto.timingSafeEqual(given, real);
    if (!ok) { attempts.get(req.ip).n += 1; return next(new HttpError(401, 'That password is not correct.')); }
    attempts.delete(req.ip);
    setCookie(res, sign(Date.now() + SESSION_MS), SESSION_MS / 1000);
    res.json({ admin: true });
  });
  app.post('/api/logout', (req, res) => { setCookie(res, '', 0); res.json({ admin: false }); });

  /* ---- admin writes ---- */
  app.post('/api/faculty', requireAdmin, requireJson, wrap(async (req, res) => {
    res.status(201).json(await db.insert(clean(req.body)));
  }));
  app.put('/api/faculty/:id', requireAdmin, requireJson, wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) throw new HttpError(400, 'Bad id.');
    const rec = await db.update(id, clean(req.body));
    if (!rec) throw new HttpError(404, 'That faculty member no longer exists.');
    res.json(rec);
  }));
  app.delete('/api/faculty/:id', requireAdmin, wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) throw new HttpError(400, 'Bad id.');
    if (!(await db.remove(id))) throw new HttpError(404, 'That faculty member no longer exists.');
    res.json({ ok: true });
  }));
  app.post('/api/import', requireAdmin, requireJson, wrap(async (req, res) => {
    const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows.slice(0, 500) : [];
    if (!rows.length) throw new HttpError(400, 'No rows to import.');
    const existing = await db.list();
    const names = new Set(existing.map((f) => f.name.toLowerCase()));
    const emails = new Set(existing.filter((f) => f.email).map((f) => f.email.toLowerCase()));
    let added = 0, skipped = 0;
    for (const r of rows) {
      let o;
      try { o = clean(r); } catch (e) { skipped++; continue; }
      if (names.has(o.name.toLowerCase()) || (o.email && emails.has(o.email.toLowerCase()))) { skipped++; continue; }
      await db.insert(o);
      names.add(o.name.toLowerCase());
      if (o.email) emails.add(o.email.toLowerCase());
      added++;
    }
    res.json({ added, skipped });
  }));
  app.put('/api/settings', requireAdmin, requireJson, wrap(async (req, res) => {
    const dept = String((req.body && req.body.department) || '').trim().slice(0, 90);
    const inst = String((req.body && req.body.institution) || '').trim().slice(0, 90);
    if (!dept) throw new HttpError(400, 'Enter a department name.');
    await db.setSetting('department', dept);
    await db.setSetting('institution', inst);
    res.json({ department: dept, institution: inst });
  }));

  app.use('/api', (req, res, next) => next(new HttpError(404, 'Not found.')));
  app.use(express.static(path.join(__dirname, 'public'), { maxAge: '5m' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Send valid JSON.');
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Something went wrong on the server.' : err.message });
  });

  return { app, db };
}

module.exports = { createApp };

if (require.main === module) {
  const { Pool } = require('pg');
  const production = process.env.NODE_ENV === 'production';
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set.'); process.exit(1); }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: production ? { rejectUnauthorized: false } : undefined,
  });
  const { app, db } = createApp({
    pool, production,
    adminPassword: process.env.ADMIN_PASSWORD,
    sessionSecret: process.env.SESSION_SECRET,
  });
  db.init().then(() => {
    const port = process.env.PORT || 3000;
    app.listen(port, () => console.log('Faculty directory listening on port ' + port));
  }).catch((e) => { console.error('Could not set up the database:', e.message); process.exit(1); });
}
if (process.env.VERCEL) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const { app, db } = createApp({
    pool,
    production: true,
    adminPassword: process.env.ADMIN_PASSWORD,
    sessionSecret: process.env.SESSION_SECRET,
  });
  const ready = db.init();
  const handler = (req, res) => ready.then(
    () => app(req, res),
    (e) => { console.error(e); res.statusCode = 500; res.end('Database setup failed'); }
  );
  handler.createApp = createApp;
  module.exports = handler;
}
