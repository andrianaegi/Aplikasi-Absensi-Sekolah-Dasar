'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@libsql/client');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    nama TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','guru')),
    password_hash TEXT NOT NULL,
    aktif INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS kelas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nama TEXT NOT NULL UNIQUE COLLATE NOCASE
  )`,
  `CREATE TABLE IF NOT EXISTS user_kelas (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kelas_id INTEGER NOT NULL REFERENCES kelas(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, kelas_id)
  )`,
  `CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nama TEXT NOT NULL,
    nis TEXT NOT NULL DEFAULT '',
    jk TEXT NOT NULL DEFAULT 'L' CHECK (jk IN ('L','P')),
    kelas_id INTEGER NOT NULL REFERENCES kelas(id) ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_students_kelas ON students(kelas_id)`,
  `CREATE TABLE IF NOT EXISTS attendance (
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    tanggal TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('H','S','I','A')),
    catatan TEXT NOT NULL DEFAULT '',
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (student_id, tanggal)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_att_tanggal ON attendance(tanggal)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  )`
];

function wrapExecutor(execObj) {
  return {
    prepare(sql) {
      return {
        async get(...args) {
          const res = await execObj.execute({ sql, args });
          return res.rows[0] ? { ...res.rows[0] } : undefined;
        },
        async all(...args) {
          const res = await execObj.execute({ sql, args });
          return res.rows.map((r) => ({ ...r }));
        },
        async run(...args) {
          const res = await execObj.execute({ sql, args });
          return {
            lastInsertRowid: res.lastInsertRowid != null ? Number(res.lastInsertRowid) : 0,
            changes: res.rowsAffected || 0
          };
        }
      };
    },
    async exec(sql) {
      const stmts = sql.split(';').map((s) => s.trim()).filter(Boolean);
      for (const s of stmts) {
        await execObj.execute(s);
      }
    }
  };
}

function open(file) {
  let client;
  if (process.env.TURSO_DATABASE_URL) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  } else {
    if (file !== ':memory:') {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    const url = file === ':memory:' ? ':memory:' : `file:${file}`;
    client = createClient({ url });
  }

  const wrapper = wrapExecutor(client);
  wrapper._client = client;

  const ready = (async () => {
    await client.execute('PRAGMA foreign_keys = ON');
    for (const stmt of SCHEMA) {
      await client.execute(stmt);
    }
  })();

  wrapper.ready = ready;
  wrapper.close = () => client.close();
  return wrapper;
}

async function tx(db, fn) {
  if (db._client && typeof db._client.transaction === 'function') {
    const t = await db._client.transaction('write');
    const txDb = wrapExecutor(t);
    try {
      const res = await fn(txDb);
      await t.commit();
      return res;
    } catch (e) {
      try { await t.rollback(); } catch (_) {}
      throw e;
    }
  }
  return fn(db);
}

module.exports = { open, tx };
