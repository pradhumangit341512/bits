const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const QRCode = require('qrcode');
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
  'public', 'favicon', 'index', 'admin', 'static', 'guides', 'robots', 'sitemap', 'qr', 'docs', 'unlock',
]);

// Security headers (also set in vercel.json for static/CDN responses; this
// covers local dev and dynamic function responses).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
].join('; ');

// Trust the X-Forwarded-Proto / Host headers set by a reverse proxy / Vercel
// so req.protocol and secure cookies work correctly behind HTTPS.
app.set('trust proxy', true);

// Security headers on every response.
app.use((req, res, next) => {
  res.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Content-Security-Policy', CSP);
  next();
});

app.use(express.json());
// redirect:false so "/guides" isn't 301'd to "/guides/" (keeps canonical URLs clean).
app.use(express.static(path.join(__dirname, 'public'), { redirect: false }));

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

async function insertUrl(code, original, userId, passwordHash = null, expiresAt = null) {
  await client.execute({
    sql: 'INSERT INTO urls (code, original, user_id, password_hash, expires_at) VALUES (?, ?, ?, ?, ?)',
    args: [code, original, userId ?? null, passwordHash ?? null, expiresAt ?? null],
  });
}

// Allowed expiration presets (server-authoritative — never trust a client clock).
const EXPIRY_PRESETS = {
  '1h': 3600e3,
  '24h': 86400e3,
  '7d': 604800e3,
  '30d': 2592000e3,
};

// Returns an ISO expiry string, null (never), or undefined (invalid preset).
function computeExpiresAt(expiresIn) {
  if (!expiresIn) return null;
  const ms = EXPIRY_PRESETS[expiresIn];
  if (!ms) return undefined;
  return new Date(Date.now() + ms).toISOString();
}

function isExpired(row) {
  return !!row.expires_at && new Date(row.expires_at).getTime() <= Date.now();
}

// Parse optional password + expiration from a create request body.
// Returns { passwordHash, expiresAt } or { optError } on invalid input.
async function parseLinkOptions(body) {
  const password = typeof body?.password === 'string' ? body.password : '';
  if (password && password.length > 200) {
    return { optError: 'Password must be 200 characters or fewer.' };
  }
  const passwordHash = password ? await bcrypt.hash(password, 10) : null;

  const expiresIn = typeof body?.expiresIn === 'string' ? body.expiresIn.trim() : '';
  const expiresAt = computeExpiresAt(expiresIn);
  if (expiresAt === undefined) {
    return { optError: 'Invalid expiration. Use 1h, 24h, 7d or 30d.' };
  }
  return { passwordHash, expiresAt };
}

function htmlEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// Minimal branded, no-JS page shell (CSP-safe: external stylesheet, no inline script).
function pageShell(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${htmlEscape(title)} · TheURLShortner</title>
  <meta name="robots" content="noindex, nofollow" />
  <meta name="theme-color" content="#2563eb" />
  <link rel="icon" href="/favicon.ico" sizes="48x48" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <nav class="nav">
    <a class="brand" href="/" aria-label="TheURLShortner home">
      <svg class="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      <span class="brand-name">TheURLShortner</span>
    </a>
  </nav>
  <main class="page">${bodyHtml}</main>
</body>
</html>`;
}

function renderUnlockPage(code, error) {
  const body = `
    <section class="card" style="max-width:420px;margin:3rem auto;text-align:center;">
      <h1 style="font-size:1.4rem;margin-top:0;">🔒 Password required</h1>
      <p class="muted">This short link is protected. Enter its password to continue.</p>
      ${error ? `<p class="error">${htmlEscape(error)}</p>` : ''}
      <form method="POST" action="/unlock/${encodeURIComponent(code)}">
        <input type="password" name="password" placeholder="Link password" maxlength="200" required autofocus />
        <button type="submit">Unlock link</button>
      </form>
    </section>`;
  return pageShell('Password required', body);
}

function renderExpiredPage() {
  const body = `
    <section class="card" style="max-width:420px;margin:3rem auto;text-align:center;">
      <h1 style="font-size:1.4rem;margin-top:0;">⏳ Link expired</h1>
      <p class="muted">This short link has expired and no longer forwards to its destination.</p>
      <a class="cta-primary" href="/">Shorten a new link</a>
    </section>`;
  return pageShell('Link expired', body);
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

    const { passwordHash, expiresAt, optError } = await parseLinkOptions(req.body);
    if (optError) return res.status(400).json({ error: optError });

    await insertUrl(code, url, req.session.userId || null, passwordHash, expiresAt);
    return res.json({
      code,
      shortUrl: buildShortUrl(req, code),
      expiresAt: expiresAt || null,
      passwordProtected: !!passwordHash,
    });
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
      // Don't leak the destination of a password-protected link.
      originalUrl: row.password_hash ? null : row.original,
      passwordProtected: !!row.password_hash,
      clicks: Number(row.clicks),
      createdAt: row.created_at,
      expiresAt: row.expires_at || null,
      expired: isExpired(row),
    });
  } catch (err) {
    console.error('stats error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

// ---------- public API v1 (CORS-enabled, no auth) ----------

function qrUrlFor(req, code) {
  const base = BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/+$/, '')}/qr/${code}.svg`;
}

// CORS for the public API + preflight handling.
app.use('/api/v1', (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// POST /api/v1/shorten  { url, code? }
app.post('/api/v1/shorten', async (req, res) => {
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

    const { passwordHash, expiresAt, optError } = await parseLinkOptions(req.body);
    if (optError) return res.status(400).json({ error: optError });

    await insertUrl(code, url, req.session.userId || null, passwordHash, expiresAt);
    return res.status(201).json({
      code,
      shortUrl: buildShortUrl(req, code),
      qrUrl: qrUrlFor(req, code),
      originalUrl: url,
      clicks: 0,
      expiresAt: expiresAt || null,
      passwordProtected: !!passwordHash,
    });
  } catch (err) {
    console.error('api v1 shorten error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

// GET /api/v1/links/:code  -> stats
app.get('/api/v1/links/:code', async (req, res) => {
  try {
    const row = await getByCode(req.params.code);
    if (!row) return res.status(404).json({ error: 'Code not found.' });
    return res.json({
      code: row.code,
      shortUrl: buildShortUrl(req, row.code),
      qrUrl: qrUrlFor(req, row.code),
      // Don't leak the destination of a password-protected link.
      originalUrl: row.password_hash ? null : row.original,
      passwordProtected: !!row.password_hash,
      clicks: Number(row.clicks),
      createdAt: row.created_at,
      expiresAt: row.expires_at || null,
      expired: isExpired(row),
    });
  } catch (err) {
    console.error('api v1 stats error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

// ---------- dashboard data APIs (owner-only) ----------

app.get('/api/links', requireAuth, async (req, res) => {
  try {
    const rs = await client.execute({
      sql: 'SELECT code, original, clicks, created_at, password_hash, expires_at FROM urls WHERE user_id = ? ORDER BY created_at DESC',
      args: [req.session.userId],
    });
    const links = rs.rows.map((row) => ({
      code: row.code,
      shortUrl: buildShortUrl(req, row.code),
      original: row.original,
      clicks: Number(row.clicks),
      createdAt: row.created_at,
      hasPassword: !!row.password_hash,
      expiresAt: row.expires_at || null,
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
app.get('/docs', (req, res) => res.sendFile(path.join(__dirname, 'public', 'docs.html')));
app.get('/guides', (req, res) => res.sendFile(path.join(__dirname, 'public', 'guides', 'index.html')));
app.get('/guides/:slug', (req, res) => {
  // Only allow safe slug characters; serve the matching static guide page.
  if (!/^[a-z0-9-]+$/.test(req.params.slug)) {
    return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  }
  const file = path.join(__dirname, 'public', 'guides', `${req.params.slug}.html`);
  res.sendFile(file, (err) => {
    if (err) res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  });
});

// ---------- QR code for a short link ----------
// GET /qr/:code(.svg) -> SVG QR code encoding the short URL.
app.get('/qr/:code', async (req, res) => {
  try {
    const code = req.params.code.replace(/\.svg$/i, '');
    if (!/^[A-Za-z0-9-]{1,40}$/.test(code)) {
      return res.status(400).send('Invalid code');
    }
    const target = buildShortUrl(req, code);
    const svg = await QRCode.toString(target, {
      type: 'svg',
      margin: 1,
      width: 240,
      color: { dark: '#0f172a', light: '#ffffff' },
    });
    res.type('image/svg+xml');
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(svg);
  } catch (err) {
    console.error('qr error:', err);
    return res.status(500).send('QR generation failed');
  }
});

// ---------- password gate (verify + redirect) ----------
// Plain HTML form POST (no JS), so it works under a strict CSP.
app.post('/unlock/:code', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const row = await getByCode(req.params.code);
    if (!row) {
      return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
    }
    if (isExpired(row)) {
      return res.status(410).type('html').send(renderExpiredPage());
    }
    // Not protected → nothing to unlock; just forward.
    if (!row.password_hash) {
      await bumpClicks(row.code);
      return res.redirect(302, row.original);
    }
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) {
      return res.status(401).type('html').send(renderUnlockPage(row.code, 'Incorrect password. Please try again.'));
    }
    await bumpClicks(row.code);
    return res.redirect(302, row.original);
  } catch (err) {
    console.error('unlock error:', err);
    return res.status(500).sendFile(path.join(__dirname, 'public', '404.html'));
  }
});

// ---------- redirect (must come last) ----------

app.get('/:code', async (req, res) => {
  try {
    const row = await getByCode(req.params.code);
    if (!row) {
      return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
    }
    // Expired links stop forwarding (no click counted).
    if (isExpired(row)) {
      return res.status(410).type('html').send(renderExpiredPage());
    }
    // Password-protected links show a gate first (click counted only on unlock).
    if (row.password_hash) {
      return res.status(200).type('html').send(renderUnlockPage(row.code));
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
