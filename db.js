const { createClient } = require('@libsql/client');

// In production, set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN (hosted libSQL/Turso).
// With no env vars, falls back to a local SQLite file so dev works out of the box.
const client = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:urls.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Memoized one-time schema setup + migration. Safe to await on every request —
// it only runs once per process (important on serverless cold starts).
let initPromise;
function init() {
  if (!initPromise) {
    initPromise = migrate();
  }
  return initPromise;
}

async function migrate() {
  // Existing links table (unchanged for fresh installs).
  await client.execute(`
    CREATE TABLE IF NOT EXISTS urls (
      code        TEXT PRIMARY KEY,
      original    TEXT NOT NULL,
      clicks      INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Accounts.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Session store (backs express-session so logins survive serverless).
  await client.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid     TEXT PRIMARY KEY,
      sess    TEXT NOT NULL,
      expire  INTEGER NOT NULL
    )
  `);

  // Additive column migrations — each guarded so existing rows are preserved.
  const info = await client.execute('PRAGMA table_info(urls)');
  const cols = new Set(info.rows.map((r) => r.name));
  // Old anonymous links keep user_id = NULL.
  if (!cols.has('user_id')) {
    await client.execute('ALTER TABLE urls ADD COLUMN user_id INTEGER REFERENCES users(id)');
  }
  // Optional per-link password (bcrypt hash). NULL = no password.
  if (!cols.has('password_hash')) {
    await client.execute('ALTER TABLE urls ADD COLUMN password_hash TEXT');
  }
  // Optional expiry as an ISO 8601 UTC string. NULL = never expires.
  if (!cols.has('expires_at')) {
    await client.execute('ALTER TABLE urls ADD COLUMN expires_at TEXT');
  }
}

module.exports = { client, init };
