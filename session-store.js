const session = require('express-session');
const { client } = require('./db');

// Minimal express-session store backed by the libSQL `sessions` table.
// Required so sessions persist across serverless invocations (the default
// MemoryStore would lose every login between requests on Vercel).
class LibsqlStore extends session.Store {
  _expiry(sess) {
    if (sess && sess.cookie && sess.cookie.expires) {
      return new Date(sess.cookie.expires).getTime();
    }
    return Date.now() + 1000 * 60 * 60 * 24; // default 1 day
  }

  get(sid, cb) {
    client
      .execute({ sql: 'SELECT sess, expire FROM sessions WHERE sid = ?', args: [sid] })
      .then((rs) => {
        const row = rs.rows[0];
        if (!row) return cb(null, null);
        if (Number(row.expire) < Date.now()) {
          return this.destroy(sid, () => cb(null, null));
        }
        cb(null, JSON.parse(row.sess));
      })
      .catch(cb);
  }

  set(sid, sess, cb) {
    const expire = this._expiry(sess);
    client
      .execute({
        sql: `INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
              ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire`,
        args: [sid, JSON.stringify(sess), expire],
      })
      .then(() => cb(null))
      .catch(cb);
  }

  destroy(sid, cb) {
    client
      .execute({ sql: 'DELETE FROM sessions WHERE sid = ?', args: [sid] })
      .then(() => cb(null))
      .catch(cb);
  }

  touch(sid, sess, cb) {
    const expire = this._expiry(sess);
    client
      .execute({ sql: 'UPDATE sessions SET expire = ? WHERE sid = ?', args: [expire, sid] })
      .then(() => cb(null))
      .catch(cb);
  }
}

module.exports = LibsqlStore;
