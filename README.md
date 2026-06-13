# theurlshortner

A Bitly-style URL shortener. Anonymous visitors can shorten links; registered users get a
personal dashboard to create custom-coded links, track clicks, and edit or delete their own links.

## Tech stack

- **Backend:** Node.js + Express
- **Database:** SQLite via libSQL (`@libsql/client`) — local file in dev, hosted Turso in production
- **Auth:** `bcrypt` password hashing + `express-session` (httpOnly signed cookies, libSQL-backed store)
- **Frontend:** static HTML + vanilla JS/CSS (no build step, no framework)
- **Short codes:** `nanoid`, 6 chars (or a user-chosen custom code)

## Install

```bash
npm install
```

## Run (local)

```bash
npm start
```

Then open **http://localhost:3000**.

With no env vars set, the database is a local file `urls.db` (created on first run). Useful env vars:

- `PORT` — port to listen on (default 3000)
- `SESSION_SECRET` — secret for signing session cookies (set a strong value in production)
- `BASE_URL` — public origin used when building short links, e.g. `https://sho.rt`
- `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` — hosted libSQL/Turso database (production)

## Manual test (4 steps)

With the server running, open **http://localhost:3000** and:

1. **Sign up** — click *Sign up* (top right), enter an email + password (8+ chars). You land on `/dashboard`.
2. **Create a custom-code link** — in the dashboard, enter `https://example.com` and the custom code `my-link`, click *Create*.
3. **See it on the dashboard** — the row appears with its short URL, `0` clicks, and today's date.
4. **Edit its destination** — click *Edit* on that row, change the URL to `https://www.wikipedia.org`, click *Save*. Visiting the short link now redirects to the new destination (and the click count goes up).

## API

| Method | Route                 | Auth      | Description                                                             |
| ------ | --------------------- | --------- | ----------------------------------------------------------------------- |
| POST   | `/api/auth/signup`    | —         | `{ email, password }` → creates account, starts session.                |
| POST   | `/api/auth/login`     | —         | `{ email, password }` → starts session.                                 |
| POST   | `/api/auth/logout`    | —         | Ends the session.                                                       |
| GET    | `/api/me`             | —         | Current user `{ user: {...} | null }`.                                  |
| POST   | `/api/shorten`        | optional  | `{ url, code? }`. Optional custom code (4–30 alphanumeric/dashes). Attaches to the logged-in user when authenticated. |
| GET    | `/api/stats/:code`    | —         | `{ originalUrl, clicks, createdAt }`.                                    |
| GET    | `/api/links`          | required  | The current user's links.                                               |
| PATCH  | `/api/links/:code`    | required  | `{ url }` — change a link's destination (owner only).                   |
| DELETE | `/api/links/:code`    | required  | Delete a link (owner only).                                             |
| GET    | `/:code`              | —         | Increments clicks, 302-redirects to the original URL.                   |

Invalid/non-http(s) URLs → 400. Duplicate custom code → 409. Unknown codes → clean 404 page.
Dashboard data routes are owner-scoped, so users can only read/edit/delete their own links.

## Deploying to Vercel

This app is structured to run on Vercel as a single Node Function (it exports the Express app
from `server.js`; `public/` is served as static assets; `cleanUrls` gives `/login` and `/dashboard`).

Because Vercel's filesystem is ephemeral, **do not** use the local SQLite file in production — point
at a hosted libSQL database (Turso) and set a session secret:

1. Create a Turso database and grab its URL + auth token.
2. In the Vercel project, set env vars: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `SESSION_SECRET`,
   and (optionally) `BASE_URL`.
3. Deploy with `vercel` (preview) / `vercel --prod` (production).

> Note: `bcrypt` is a native module. If a Vercel build ever fails to compile it, swap to the
> pure-JS drop-in `bcryptjs` (same API).
