'use strict';
const auth = require('./auth');
const { tx } = require('./db');
const { rekapWorkbook } = require('./xlsx');

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m) => new HttpError(400, m);
const forbidden = () => new HttpError(403, 'Anda tidak punya akses ke data ini.');

const reDate = /^\d{4}-\d{2}-\d{2}$/;
const reMonth = /^\d{4}-(0[1-9]|1[0-2])$/;
function validDate(s) { if (!reDate.test(s)) return false; const d = new Date(s + 'T00:00:00Z'); return !isNaN(d) && d.toISOString().slice(0, 10) === s; }
const str = (v, max, label) => { const s = String(v == null ? '' : v).trim(); if (s.length > max) throw bad(`${label} terlalu panjang (maks ${max} karakter).`); return s; };
const reqStr = (v, max, label) => { const s = str(v, max, label); if (!s) throw bad(`${label} wajib diisi.`); return s; };
const jkOf = (v) => (/^(p|perempuan|wanita|female|f)$/i.test(String(v || '').trim()) ? 'P' : 'L');
function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw bad('Kata sandi minimal 8 karakter.');
  if (pw.length > 200) throw bad('Kata sandi terlalu panjang.');
}

/* ---------- akses kelas ---------- */
function kelasForUser(db, user) {
  if (user.role === 'admin') return db.prepare('SELECT id, nama FROM kelas ORDER BY nama COLLATE NOCASE').all();
  return db.prepare(`SELECT k.id, k.nama FROM kelas k JOIN user_kelas uk ON uk.kelas_id = k.id
    WHERE uk.user_id = ? ORDER BY k.nama COLLATE NOCASE`).all(user.id);
}
function requireKelas(db, user, kelasId) {
  const id = Number(kelasId);
  if (!Number.isInteger(id)) throw bad('Kelas tidak valid.');
  const k = db.prepare('SELECT id, nama FROM kelas WHERE id = ?').get(id);
  if (!k) throw new HttpError(404, 'Kelas tidak ditemukan.');
  if (user.role !== 'admin' && !db.prepare('SELECT 1 FROM user_kelas WHERE user_id = ? AND kelas_id = ?').get(user.id, id)) throw forbidden();
  return k;
}
function requireStudent(db, user, id) {
  const s = db.prepare('SELECT * FROM students WHERE id = ?').get(Number(id));
  if (!s) throw new HttpError(404, 'Siswa tidak ditemukan.');
  requireKelas(db, user, s.kelas_id);
  return s;
}
const getSetting = (db, k, d = '') => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : d; };
const setSetting = (db, k, v) => db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);
const school = (db) => ({ nama: getSetting(db, 'school_nama', 'Sekolah Dasar'), tahun: getSetting(db, 'school_tahun', '') });

/* ---------- rekap ---------- */
function buildRekap(db, kelas, month) {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const students = db.prepare('SELECT id, nama, nis, jk FROM students WHERE kelas_id = ? ORDER BY nama COLLATE NOCASE').all(kelas.id);
  const rows = db.prepare(`SELECT a.student_id, a.tanggal, a.status FROM attendance a JOIN students s ON s.id = a.student_id
    WHERE s.kelas_id = ? AND a.tanggal BETWEEN ? AND ?`).all(kelas.id, `${month}-01`, `${month}-${String(n).padStart(2, '0')}`);
  const by = new Map(students.map((s) => [s.id, { id: s.id, nama: s.nama, nis: s.nis, jk: s.jk, days: {}, H: 0, S: 0, I: 0, A: 0 }]));
  for (const r of rows) { const o = by.get(r.student_id); o.days[Number(r.tanggal.slice(8))] = r.status; o[r.status]++; }
  const list = [...by.values()].map((o) => { const t = o.H + o.S + o.I + o.A; o.persen = t ? Math.round((o.H / t) * 1000) / 10 : null; return o; });
  return { kelas, month, jumlah_hari: n, siswa: list };
}
const csvCell = (v) => { v = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };

/* ---------- daftar rute ---------- */
// auth: false = publik, 'user' = login, 'admin' = admin
const routes = [];
const on = (method, pattern, authLevel, handler) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), authLevel, handler });

on('GET', '/api/setup-status', false, ({ db }) => ({ needsSetup: db.prepare('SELECT COUNT(*) c FROM users').get().c === 0 }));

on('POST', '/api/setup', false, ({ db, body, ctx }) => {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) throw new HttpError(409, 'Pengaturan awal sudah dilakukan.');
  const username = reqStr(body.username, 40, 'Nama pengguna'), nama = reqStr(body.nama, 80, 'Nama lengkap');
  if (!/^[A-Za-z0-9_.-]+$/.test(username)) throw bad('Nama pengguna hanya boleh huruf, angka, titik, garis bawah, dan strip.');
  checkPassword(body.password);
  const sekolah = reqStr(body.sekolah, 100, 'Nama sekolah');
  tx(db, () => {
    db.prepare('INSERT INTO users (username, nama, role, password_hash) VALUES (?,?,?,?)').run(username, nama, 'admin', auth.hashPassword(body.password));
    setSetting(db, 'school_nama', sekolah); setSetting(db, 'school_tahun', str(body.tahun, 20, 'Tahun ajaran'));
    const ins = db.prepare('INSERT OR IGNORE INTO kelas (nama) VALUES (?)');
    ['1', '2', '3', '4', '5', '6'].forEach((k) => ins.run(k));
  });
  return { ok: true };
});

on('POST', '/api/login', false, ({ db, body, ctx }) => {
  const username = String(body.username || '').trim(), pw = String(body.password || '');
  const key = ctx.ip + '|' + username.toLowerCase();
  if (auth.loginBlocked(key)) throw new HttpError(429, 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.');
  const u = db.prepare('SELECT * FROM users WHERE username = ? AND aktif = 1').get(username);
  const ok = u ? auth.verifyPassword(pw, u.password_hash) : (auth.verifyPassword(pw, 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '=='), false);
  if (!ok) { auth.loginFailed(key); throw new HttpError(401, 'Nama pengguna atau kata sandi salah.'); }
  auth.loginOk(key);
  const s = auth.createSession(db, u.id);
  ctx.setCookie(auth.cookieHeader(s.token, s.exp, ctx.secure));
  return { ok: true };
});

on('POST', '/api/logout', false, ({ db, ctx }) => { auth.destroySession(db, ctx.token); ctx.setCookie(auth.cookieHeader('', 0, ctx.secure)); return { ok: true }; });

on('GET', '/api/me', 'user', ({ db, user }) => ({ user, school: school(db), kelas: kelasForUser(db, user) }));

on('POST', '/api/me/password', 'user', ({ db, user, body, ctx }) => {
  const u = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
  if (!auth.verifyPassword(String(body.lama || ''), u.password_hash)) throw new HttpError(400, 'Kata sandi lama salah.');
  checkPassword(body.baru);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(body.baru), user.id);
  auth.destroyUserSessions(db, user.id, ctx.token);
  return { ok: true };
});

/* ----- siswa ----- */
on('GET', '/api/students', 'user', ({ db, user, query }) => {
  const k = requireKelas(db, user, query.kelas_id);
  return { kelas: k, siswa: db.prepare('SELECT id, nama, nis, jk, kelas_id FROM students WHERE kelas_id = ? ORDER BY nama COLLATE NOCASE').all(k.id) };
});
on('POST', '/api/students', 'user', ({ db, user, body }) => {
  const k = requireKelas(db, user, body.kelas_id);
  const nama = reqStr(body.nama, 100, 'Nama'), nis = str(body.nis, 30, 'NIS');
  if (nis && db.prepare('SELECT 1 FROM students WHERE nis = ?').get(nis)) throw new HttpError(409, 'NISN/NIS sudah dipakai siswa lain.');
  const r = db.prepare('INSERT INTO students (nama, nis, jk, kelas_id) VALUES (?,?,?,?)').run(nama, nis, jkOf(body.jk), k.id);
  return { id: Number(r.lastInsertRowid) };
});
on('PATCH', '/api/students/:id', 'user', ({ db, user, params, body }) => {
  const s = requireStudent(db, user, params.id);
  const nama = body.nama !== undefined ? reqStr(body.nama, 100, 'Nama') : s.nama;
  const nis = body.nis !== undefined ? str(body.nis, 30, 'NIS') : s.nis;
  const kelasId = body.kelas_id !== undefined ? requireKelas(db, user, body.kelas_id).id : s.kelas_id;
  if (nis && nis !== s.nis && db.prepare('SELECT 1 FROM students WHERE nis = ? AND id != ?').get(nis, s.id)) throw new HttpError(409, 'NISN/NIS sudah dipakai siswa lain.');
  db.prepare('UPDATE students SET nama = ?, nis = ?, jk = ?, kelas_id = ? WHERE id = ?').run(nama, nis, body.jk !== undefined ? jkOf(body.jk) : s.jk, kelasId, s.id);
  return { ok: true };
});
on('DELETE', '/api/students/:id', 'user', ({ db, user, params }) => { const s = requireStudent(db, user, params.id); db.prepare('DELETE FROM students WHERE id = ?').run(s.id); return { ok: true }; });

on('POST', '/api/students/import', 'user', ({ db, user, body }) => {
  const def = requireKelas(db, user, body.kelas_id);
  if (!Array.isArray(body.rows) || !body.rows.length) throw bad('Tidak ada baris untuk diimpor.');
  if (body.rows.length > 2000) throw bad('Maksimal 2000 baris per impor.');
  const allowed = new Map(kelasForUser(db, user).map((k) => [k.nama.toLowerCase(), k]));
  const nisSeen = new Set(db.prepare("SELECT nis FROM students WHERE nis != ''").all().map((r) => r.nis));
  const nmSeen = new Set(db.prepare("SELECT lower(nama) || '|' || kelas_id AS k FROM students").all().map((r) => r.k));
  const ins = db.prepare('INSERT INTO students (nama, nis, jk, kelas_id) VALUES (?,?,?,?)');
  const skipped = []; let added = 0;
  tx(db, () => {
    body.rows.forEach((r, i) => {
      const baris = i + 1;
      const nama = String((r && r.nama) || '').trim().slice(0, 100), nis = String((r && r.nis) || '').trim().slice(0, 30);
      if (!nama) return skipped.push({ baris, alasan: 'Nama kosong' });
      let k = def; const kn = String((r && r.kelas) || '').trim();
      if (kn) { k = allowed.get(kn.toLowerCase()); if (!k) return skipped.push({ baris, nama, alasan: `Kelas "${kn.slice(0, 20)}" tidak ada atau bukan kelas Anda` }); }
      const key = nama.toLowerCase() + '|' + k.id;
      if ((nis && nisSeen.has(nis)) || nmSeen.has(key)) return skipped.push({ baris, nama, alasan: 'Sudah ada' });
      ins.run(nama, nis, jkOf(r.jk), k.id); added++; if (nis) nisSeen.add(nis); nmSeen.add(key);
    });
  });
  return { added, skipped };
});

/* ----- absensi ----- */
on('GET', '/api/attendance', 'user', ({ db, user, query }) => {
  const k = requireKelas(db, user, query.kelas_id);
  if (!validDate(query.date)) throw bad('Tanggal tidak valid.');
  const siswa = db.prepare(`SELECT s.id, s.nama, s.nis, s.jk, COALESCE(a.status, '') AS status, COALESCE(a.catatan, '') AS catatan
    FROM students s LEFT JOIN attendance a ON a.student_id = s.id AND a.tanggal = ? WHERE s.kelas_id = ? ORDER BY s.nama COLLATE NOCASE`).all(query.date, k.id);
  return { kelas: k, date: query.date, siswa };
});
on('PUT', '/api/attendance', 'user', ({ db, user, body }) => {
  const k = requireKelas(db, user, body.kelas_id);
  if (!validDate(body.date)) throw bad('Tanggal tidak valid.');
  if (!Array.isArray(body.entries) || body.entries.length > 500) throw bad('Data absensi tidak valid.');
  const ok = new Set(db.prepare('SELECT id FROM students WHERE kelas_id = ?').all(k.id).map((r) => r.id));
  const up = db.prepare(`INSERT INTO attendance (student_id, tanggal, status, catatan, updated_by, updated_at) VALUES (?,?,?,?,?,datetime('now'))
    ON CONFLICT(student_id, tanggal) DO UPDATE SET status = excluded.status, catatan = excluded.catatan, updated_by = excluded.updated_by, updated_at = excluded.updated_at`);
  const del = db.prepare('DELETE FROM attendance WHERE student_id = ? AND tanggal = ?');
  tx(db, () => {
    for (const e of body.entries) {
      const sid = Number(e.student_id);
      if (!ok.has(sid)) throw bad('Ada siswa yang bukan dari kelas ini.');
      const st = String(e.status || ''), cat = str(e.catatan, 200, 'Catatan');
      if (!st && !cat) del.run(sid, body.date);
      else if (!st) throw bad('Pilih status kehadiran sebelum menulis catatan.');
      else if (!['H', 'S', 'I', 'A'].includes(st)) throw bad('Status tidak valid.');
      else up.run(sid, body.date, st, cat, user.id);
    }
  });
  return { ok: true };
});

on('GET', '/api/rekap', 'user', ({ db, user, query }) => {
  const k = requireKelas(db, user, query.kelas_id);
  if (!reMonth.test(query.month || '')) throw bad('Bulan tidak valid.');
  return buildRekap(db, k, query.month);
});
on('GET', '/api/rekap.csv', 'user', ({ db, user, query, ctx }) => {
  const k = requireKelas(db, user, query.kelas_id);
  if (!reMonth.test(query.month || '')) throw bad('Bulan tidak valid.');
  const r = buildRekap(db, k, query.month);
  const head = ['No', 'Nama', 'NISN/NIS']; for (let d = 1; d <= r.jumlah_hari; d++) head.push(d);
  head.push('Hadir', 'Sakit', 'Izin', 'Alpa', '% Hadir');
  const lines = [head.join(',')];
  r.siswa.forEach((s, i) => { const row = [i + 1, s.nama, s.nis]; for (let d = 1; d <= r.jumlah_hari; d++) row.push(s.days[d] || ''); row.push(s.H, s.S, s.I, s.A, s.persen === null ? '' : s.persen); lines.push(row.map(csvCell).join(',')); });
  return ctx.raw('﻿' + lines.join('\r\n'), 'text/csv; charset=utf-8', `rekap-kelas-${k.nama}-${query.month}.csv`.replace(/[^\w.-]/g, '_'));
});

on('GET', '/api/rekap.xlsx', 'user', ({ db, user, query, ctx }) => {
  const k = requireKelas(db, user, query.kelas_id);
  if (!reMonth.test(query.month || '')) throw bad('Bulan tidak valid.');
  const buf = rekapWorkbook(buildRekap(db, k, query.month), school(db));
  return ctx.raw(buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `rekap-kelas-${k.nama}-${query.month}.xlsx`.replace(/[^\w.-]/g, '_'));
});

/* ----- admin: pengguna, kelas, sekolah ----- */
const userOut = (db, u) => ({ id: u.id, username: u.username, nama: u.nama, role: u.role, aktif: !!u.aktif,
  kelas_ids: db.prepare('SELECT kelas_id FROM user_kelas WHERE user_id = ?').all(u.id).map((r) => r.kelas_id) });
function setUserKelas(db, userId, ids) {
  if (!Array.isArray(ids)) throw bad('Daftar kelas tidak valid.');
  db.prepare('DELETE FROM user_kelas WHERE user_id = ?').run(userId);
  const ins = db.prepare('INSERT OR IGNORE INTO user_kelas (user_id, kelas_id) VALUES (?,?)');
  for (const id of ids) { if (!db.prepare('SELECT 1 FROM kelas WHERE id = ?').get(Number(id))) throw bad('Kelas tidak ditemukan.'); ins.run(userId, Number(id)); }
}
on('GET', '/api/users', 'admin', ({ db }) => ({ users: db.prepare('SELECT * FROM users ORDER BY role, nama COLLATE NOCASE').all().map((u) => userOut(db, u)) }));
on('POST', '/api/users', 'admin', ({ db, body }) => {
  const username = reqStr(body.username, 40, 'Nama pengguna'), nama = reqStr(body.nama, 80, 'Nama lengkap');
  if (!/^[A-Za-z0-9_.-]+$/.test(username)) throw bad('Nama pengguna hanya boleh huruf, angka, titik, garis bawah, dan strip.');
  checkPassword(body.password);
  const role = body.role === 'admin' ? 'admin' : 'guru';
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'Nama pengguna sudah dipakai.');
  return tx(db, () => {
    const r = db.prepare('INSERT INTO users (username, nama, role, password_hash) VALUES (?,?,?,?)').run(username, nama, role, auth.hashPassword(body.password));
    setUserKelas(db, Number(r.lastInsertRowid), body.kelas_ids || []);
    return { id: Number(r.lastInsertRowid) };
  });
});
on('PATCH', '/api/users/:id', 'admin', ({ db, user, params, body }) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(params.id));
  if (!u) throw new HttpError(404, 'Pengguna tidak ditemukan.');
  const role = body.role !== undefined ? (body.role === 'admin' ? 'admin' : 'guru') : u.role;
  const aktif = body.aktif !== undefined ? (body.aktif ? 1 : 0) : u.aktif;
  if (u.id === user.id && (role !== 'admin' || !aktif)) throw bad('Anda tidak bisa menurunkan atau menonaktifkan akun Anda sendiri.');
  tx(db, () => {
    db.prepare('UPDATE users SET nama = ?, role = ?, aktif = ? WHERE id = ?').run(body.nama !== undefined ? reqStr(body.nama, 80, 'Nama lengkap') : u.nama, role, aktif, u.id);
    if (body.kelas_ids !== undefined) setUserKelas(db, u.id, body.kelas_ids);
    if (body.password) { checkPassword(body.password); db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(body.password), u.id); auth.destroyUserSessions(db, u.id); }
    if (!aktif) auth.destroyUserSessions(db, u.id);
  });
  return { ok: true };
});
on('DELETE', '/api/users/:id', 'admin', ({ db, user, params }) => {
  const id = Number(params.id);
  if (id === user.id) throw bad('Anda tidak bisa menghapus akun Anda sendiri.');
  db.prepare('DELETE FROM users WHERE id = ?').run(id); return { ok: true };
});
on('POST', '/api/kelas', 'admin', ({ db, body }) => {
  const nama = reqStr(body.nama, 20, 'Nama kelas');
  if (db.prepare('SELECT 1 FROM kelas WHERE nama = ?').get(nama)) throw new HttpError(409, 'Kelas sudah ada.');
  return { id: Number(db.prepare('INSERT INTO kelas (nama) VALUES (?)').run(nama).lastInsertRowid) };
});
on('DELETE', '/api/kelas/:id', 'admin', ({ db, params }) => {
  const id = Number(params.id);
  if (db.prepare('SELECT COUNT(*) c FROM students WHERE kelas_id = ?').get(id).c) throw new HttpError(409, 'Kelas masih berisi siswa. Pindahkan atau hapus siswanya dulu.');
  db.prepare('DELETE FROM kelas WHERE id = ?').run(id); return { ok: true };
});
on('PUT', '/api/school', 'admin', ({ db, body }) => { setSetting(db, 'school_nama', reqStr(body.nama, 100, 'Nama sekolah')); setSetting(db, 'school_tahun', str(body.tahun, 20, 'Tahun ajaran')); return { ok: true }; });

module.exports = { routes, HttpError, userOut };
