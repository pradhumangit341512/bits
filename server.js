const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { nanoid } = require('nanoid');
const { client, init } = require('./db');
const LibsqlStore = require('./session-store');

const app = express();
const PORT = process.env.PORT || 3000;

// Public base URL for generated short links, e.g. https://sho.rt
// Falls back to the request's host when not set (fine for local dev).
const BASE_URL = process.env.BASE_URL;

// Codes that would collide with real routes / static files.
const RESERVED_CODES = new Set([
  'api', 'login', 'logout', 'signup', 'dashboard', 'style', 'app',
  'public', 'favicon', 'index', 'admin', 'static',
]);

// Trust the X-Forwarded-Proto / Host headers set by a reverse proxy / Vercel
// so req.protocol and secure cookies work correctly behind HTTPS.
app.set('trust proxy', true);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure the schema/migration has run before anything touches the DB or the
// session store (matters on serverless cold starts).
app.use(async (req, res, next) => {
  try {
    await init();
    next();
  } catch (err) {
    console.error('init error:', err);
    res.status(500).json({ error: 'Server not ready.' });
  }
});

app.use(
  session({
    store: new LibsqlStore(),
    name: 'sid',
    secret: process.env.SESSION_SECRET || 'dev-insecure-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);

// ---------- helpers ----------

async function getByCode(code) {
  const rs = await client.execute({ sql: 'SELECT * FROM urls WHERE code = ?', args: [code] });
  return rs.rows[0];
}

async function insertUrl(code, original, userId) {
  await client.execute({
    sql: 'INSERT INTO urls (code, original, user_id) VALUES (?, ?, ?)',
    args: [code, original, userId ?? null],
  });
}

async function bumpClicks(code) {
  await client.execute({ sql: 'UPDATE urls SET clicks = clicks + 1 WHERE code = ?', args: [code] });
}

async function getUserByEmail(email) {
  const rs = await client.execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [email] });
  return rs.rows[0];
}

function isValidHttpUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

function isValidEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

// Custom code: alphanumeric + dashes, 4–30 chars, not reserved.
function isValidCustomCode(value) {
  return typeof value === 'string' && /^[A-Za-z0-9-]{4,30}$/.test(value) && !RESERVED_CODES.has(value.toLowerCase());
}

function buildShortUrl(req, code) {
  const base = BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/+$/, '')}/${code}`;
}

async function generateUniqueCode() {
  let code;
  do {
    code = nanoid(6);
  } while (await getByCode(code));
  return code;
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Login required.' });
  }
  next();
}

// ---------- auth routes ----------

app.post('/api/auth/signup', async (req, res) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const confirmPassword = typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : undefined;
    const human = req.body?.human === true;

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (password.length < 8 || password.length > 200) {
      return res.status(400).json({ error: 'Password must be 8–200 characters.' });
    }
    if (confirmPassword !== undefined && confirmPassword !== password) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }
    if (!human) {
      return res.status(400).json({ error: "Please confirm you're not a robot." });
    }
    if (await getUserByEmail(email)) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await client.execute({
      sql: 'INSERT INTO users (email, password_hash) VALUES (?, ?)',
      args: [email, hash],
    });

    req.session.userId = Number(result.lastInsertRowid);
    req.session.email = email;
    return res.status(201).json({ id: req.session.userId, email });
  } catch (err) {
    // Unique-constraint race → treat as duplicate.
    if (String(err?.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }
    console.error('signup error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    const user = await getUserByEmail(email);
    const ok = user && (await bcrypt.compare(password, user.password_hash));
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    req.session.userId = Number(user.id);
    req.session.email = user.email;
    return res.json({ id: req.session.userId, email: user.email });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sid');
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  res.json({ user: { id: req.session.userId, email: req.session.email } });
});

// ---------- link creation (public + logged-in, with custom codes) ----------

app.post('/api/shorten', async (req, res) => {
  try {
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    const rawCode = typeof req.body?.code === 'string' ? req.body.code.trim() : '';

    if (!isValidHttpUrl(url)) {
      return res.status(400).json({ error: 'Please provide a valid http:// or https:// URL.' });
    }

    let code;
    if (rawCode) {
      if (!isValidCustomCode(rawCode)) {
        return res.status(400).json({ error: 'Custom code must be 4–30 letters, numbers or dashes (and not a reserved word).' });
      }
      if (await getByCode(rawCode)) {
        return res.status(409).json({ error: 'That custom code is already taken.' });
      }
      code = rawCode;
    } else {
      code = await generateUniqueCode();
    }

    await insertUrl(code, url, req.session.userId || null);
    return res.json({ code, shortUrl: buildShortUrl(req, code) });
  } catch (err) {
    console.error('shorten error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

// ---------- stats (public) ----------

app.get('/api/stats/:code', async (req, res) => {
  try {
    const row = await getByCode(req.params.code);
    if (!row) return res.status(404).json({ error: 'Code not found.' });
    return res.json({
      originalUrl: row.original,
      clicks: Number(row.clicks),
      createdAt: row.created_at,
    });
  } catch (err) {
    console.error('stats error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

// ---------- dashboard data APIs (owner-only) ----------

app.get('/api/links', requireAuth, async (req, res) => {
  try {
    const rs = await client.execute({
      sql: 'SELECT code, original, clicks, created_at FROM urls WHERE user_id = ? ORDER BY created_at DESC',
      args: [req.session.userId],
    });
    const links = rs.rows.map((row) => ({
      code: row.code,
      shortUrl: buildShortUrl(req, row.code),
      original: row.original,
      clicks: Number(row.clicks),
      createdAt: row.created_at,
    }));
    return res.json({ links });
  } catch (err) {
    console.error('list links error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

app.patch('/api/links/:code', requireAuth, async (req, res) => {
  try {
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!isValidHttpUrl(url)) {
      return res.status(400).json({ error: 'Please provide a valid http:// or https:// URL.' });
    }
    // Ownership enforced in the WHERE clause.
    const result = await client.execute({
      sql: 'UPDATE urls SET original = ? WHERE code = ? AND user_id = ?',
      args: [url, req.params.code, req.session.userId],
    });
    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: 'Link not found.' });
    }
    return res.json({ code: req.params.code, original: url });
  } catch (err) {
    console.error('edit link error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

app.delete('/api/links/:code', requireAuth, async (req, res) => {
  try {
    const result = await client.execute({
      sql: 'DELETE FROM urls WHERE code = ? AND user_id = ?',
      args: [req.params.code, req.session.userId],
    });
    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: 'Link not found.' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('delete link error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

// ---------- page routes (local convenience; Vercel serves these statically) ----------

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

// ---------- redirect (must come last) ----------

app.get('/:code', async (req, res) => {
  try {
    const row = await getByCode(req.params.code);
    if (!row) {
      return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
    }
    await bumpClicks(req.params.code);
    return res.redirect(302, row.original);
  } catch (err) {
    console.error('redirect error:', err);
    return res.status(500).sendFile(path.join(__dirname, 'public', '404.html'));
  }
});

// Only start a listener when run directly (local dev / persistent hosts).
// On Vercel the app is imported as a serverless function instead.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`URL shortener running at http://localhost:${PORT}`);
  });
}

module.exports = app;
