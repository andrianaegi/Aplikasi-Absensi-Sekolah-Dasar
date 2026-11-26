'use strict';
const crypto = require('node:crypto');

const SESSION_DAYS = 14;
const COOKIE = 'sid';

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  const [alg, s, h] = String(stored).split('$');
  if (alg !== 'scrypt' || !s || !h) return false;
  const expected = Buffer.from(h, 'base64');
  const got = crypto.scryptSync(pw, Buffer.from(s, 'base64'), expected.length);
  return crypto.timingSafeEqual(got, expected);
}
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const exp = Date.now() + SESSION_DAYS * 86400e3;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)').run(sha(token), userId, exp);
  return { token, exp };
}
function userFromToken(db, token) {
  if (!token) return null;
  const row = db.prepare(`SELECT u.id, u.username, u.nama, u.role, s.expires_at, s.token_hash FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND u.aktif = 1`).get(sha(token));
  if (!row) return null;
  if (row.expires_at < Date.now()) { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash); return null; }
  return { id: row.id, username: row.username, nama: row.nama, role: row.role };
}
function destroySession(db, token) { if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token)); }
function destroyUserSessions(db, userId, exceptToken) {
  if (exceptToken) db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, sha(exceptToken));
  else db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}
function purgeExpired(db) { db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()); }

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function cookieHeader(token, exp, secure) {
  const maxAge = token ? Math.max(0, Math.floor((exp - Date.now()) / 1000)) : 0;
  return `${COOKIE}=${token || ''}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

/* Pembatas percobaan login (dalam memori): 8 gagal per 15 menit per IP+username */
const fails = new Map();
const WINDOW = 15 * 60e3, MAX_FAILS = 8;
function loginBlocked(key) { const f = fails.get(key); return !!f && f.until > Date.now() && f.n >= MAX_FAILS; }
function loginFailed(key) {
  const now = Date.now(); let f = fails.get(key);
  if (!f || f.until < now) f = { n: 0, until: now + WINDOW };
  f.n++; fails.set(key, f);
}
function loginOk(key) { fails.delete(key); }

module.exports = { hashPassword, verifyPassword, createSession, userFromToken, destroySession, destroyUserSessions, purgeExpired, parseCookies, cookieHeader, COOKIE, loginBlocked, loginFailed, loginOk };
