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
async function kelasForUser(db, user) {
  if (user.role === 'admin') return await db.prepare('SELECT id, nama FROM kelas ORDER BY nama COLLATE NOCASE').all();
  return await db.prepare(`SELECT k.id, k.nama FROM kelas k JOIN user_kelas uk ON uk.kelas_id = k.id
    WHERE uk.user_id = ? ORDER BY k.nama COLLATE NOCASE`).all(user.id);
}
async function requireKelas(db, user, kelasId) {
  const id = Number(kelasId);
  if (!Number.isInteger(id)) throw bad('Kelas tidak valid.');
  const k = await db.prepare('SELECT id, nama FROM kelas WHERE id = ?').get(id);
  if (!k) throw new HttpError(404, 'Kelas tidak ditemukan.');
  if (user.role !== 'admin' && !(await db.prepare('SELECT 1 FROM user_kelas WHERE user_id = ? AND kelas_id = ?').get(user.id, id))) throw forbidden();
  return k;
}
async function requireStudent(db, user, id) {
  const s = await db.prepare('SELECT * FROM students WHERE id = ?').get(Number(id));
  if (!s) throw new HttpError(404, 'Siswa tidak ditemukan.');
  await requireKelas(db, user, s.kelas_id);
  return s;
}
const getSetting = async (db, k, d = '') => { const r = await db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : d; };
const setSetting = async (db, k, v) => { await db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v); };
const school = async (db) => ({ nama: await getSetting(db, 'school_nama', 'Sekolah Dasar'), tahun: await getSetting(db, 'school_tahun', '') });

/* ---------- rekap ---------- */
async function buildRekap(db, kelas, month) {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const [students, rows] = await Promise.all([
    db.prepare('SELECT id, nama, nis, jk FROM students WHERE kelas_id = ? ORDER BY nama COLLATE NOCASE').all(kelas.id),
    db.prepare(`SELECT a.student_id, a.tanggal, a.status FROM attendance a JOIN students s ON s.id = a.student_id
      WHERE s.kelas_id = ? AND a.tanggal BETWEEN ? AND ?`).all(kelas.id, `${month}-01`, `${month}-${String(n).padStart(2, '0')}`)
  ]);
  const by = new Map(students.map((s) => [Number(s.id), { id: Number(s.id), nama: s.nama, nis: s.nis, jk: s.jk, days: {}, H: 0, S: 0, I: 0, A: 0 }]));
  for (const r of rows) {
    const o = by.get(Number(r.student_id));
    if (o) {
      o.days[Number(r.tanggal.slice(8))] = r.status;
      o[r.status]++;
    }
  }
  const list = [...by.values()].map((o) => { const t = o.H + o.S + o.I + o.A; o.persen = t ? Math.round((o.H / t) * 1000) / 10 : null; return o; });
  return { kelas, month, jumlah_hari: n, siswa: list };
}
const csvCell = (v) => { v = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };

/* ---------- daftar rute ---------- */
const routes = [];
const on = (method, pattern, authLevel, handler) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), authLevel, handler });

on('GET', '/api/setup-status', false, async ({ db }) => {
  const row = await db.prepare('SELECT COUNT(*) c FROM users').get();
  return { needsSetup: Number(row.c) === 0 };
});

on('POST', '/api/setup', false, async ({ db, body }) => {
  const row = await db.prepare('SELECT COUNT(*) c FROM users').get();
  if (Number(row.c) > 0) throw new HttpError(409, 'Pengaturan awal sudah dilakukan.');
  const username = reqStr(body.username, 40, 'Nama pengguna'), nama = reqStr(body.nama, 80, 'Nama lengkap');
  if (!/^[A-Za-z0-9_.-]+$/.test(username)) throw bad('Nama pengguna hanya boleh huruf, angka, titik, garis bawah, dan strip.');
  checkPassword(body.password);
  const sekolah = reqStr(body.sekolah, 100, 'Nama sekolah');
  const stmts = [
    { sql: 'INSERT INTO users (username, nama, role, password_hash) VALUES (?,?,?,?)', args: [username, nama, 'admin', auth.hashPassword(body.password)] },
    { sql: 'INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', args: ['school_nama', sekolah] },
    { sql: 'INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', args: ['school_tahun', str(body.tahun, 20, 'Tahun ajaran')] },
    ...['1', '2', '3', '4', '5', '6'].map((k) => ({ sql: 'INSERT OR IGNORE INTO kelas (nama) VALUES (?)', args: [k] }))
  ];
  await db.batch(stmts);
  return { ok: true };
});

on('POST', '/api/login', false, async ({ db, body, ctx }) => {
  const username = String(body.username || '').trim(), pw = String(body.password || '');
  const key = ctx.ip + '|' + username.toLowerCase();
  if (auth.loginBlocked(key)) throw new HttpError(429, 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.');
  const u = await db.prepare('SELECT * FROM users WHERE username = ? AND aktif = 1').get(username);
  const ok = u ? auth.verifyPassword(pw, u.password_hash) : (auth.verifyPassword(pw, 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '=='), false);
  if (!ok) { auth.loginFailed(key); throw new HttpError(401, 'Nama pengguna atau kata sandi salah.'); }
  auth.loginOk(key);
  const s = await auth.createSession(db, Number(u.id));
  ctx.setCookie(auth.cookieHeader(s.token, s.exp, ctx.secure));
  return { ok: true };
});

on('POST', '/api/logout', false, async ({ db, ctx }) => {
  await auth.destroySession(db, ctx.token);
  ctx.setCookie(auth.cookieHeader('', 0, ctx.secure));
  return { ok: true };
});

on('GET', '/api/me', 'user', async ({ db, user }) => {
  const [schoolInfo, kelasList] = await Promise.all([school(db), kelasForUser(db, user)]);
  return { user, school: schoolInfo, kelas: kelasList };
});

on('POST', '/api/me/password', 'user', async ({ db, user, body, ctx }) => {
  const u = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
  if (!auth.verifyPassword(String(body.lama || ''), u.password_hash)) throw new HttpError(400, 'Kata sandi lama salah.');
  checkPassword(body.baru);
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(body.baru), user.id);
  await auth.destroyUserSessions(db, user.id, ctx.token);
  return { ok: true };
});

/* ----- siswa ----- */
on('GET', '/api/students', 'user', async ({ db, user, query }) => {
  const k = await requireKelas(db, user, query.kelas_id);
  const siswa = await db.prepare('SELECT id, nama, nis, jk, kelas_id FROM students WHERE kelas_id = ? ORDER BY nama COLLATE NOCASE').all(k.id);
  return { kelas: k, siswa };
});
on('POST', '/api/students', 'user', async ({ db, user, body }) => {
  const k = await requireKelas(db, user, body.kelas_id);
  const nama = reqStr(body.nama, 100, 'Nama'), nis = str(body.nis, 30, 'NIS');
  if (nis && (await db.prepare('SELECT 1 FROM students WHERE nis = ?').get(nis))) throw new HttpError(409, 'NISN/NIS sudah dipakai siswa lain.');
  const r = await db.prepare('INSERT INTO students (nama, nis, jk, kelas_id) VALUES (?,?,?,?)').run(nama, nis, jkOf(body.jk), k.id);
  return { id: Number(r.lastInsertRowid) };
});
on('PATCH', '/api/students/:id', 'user', async ({ db, user, params, body }) => {
  const s = await requireStudent(db, user, params.id);
  const nama = body.nama !== undefined ? reqStr(body.nama, 100, 'Nama') : s.nama;
  const nis = body.nis !== undefined ? str(body.nis, 30, 'NIS') : s.nis;
  const kelasId = body.kelas_id !== undefined ? (await requireKelas(db, user, body.kelas_id)).id : s.kelas_id;
  if (nis && nis !== s.nis && (await db.prepare('SELECT 1 FROM students WHERE nis = ? AND id != ?').get(nis, s.id))) throw new HttpError(409, 'NISN/NIS sudah dipakai siswa lain.');
  await db.prepare('UPDATE students SET nama = ?, nis = ?, jk = ?, kelas_id = ? WHERE id = ?').run(nama, nis, body.jk !== undefined ? jkOf(body.jk) : s.jk, kelasId, s.id);
  return { ok: true };
});
on('DELETE', '/api/students/:id', 'user', async ({ db, user, params }) => {
  const s = await requireStudent(db, user, params.id);
  await db.prepare('DELETE FROM students WHERE id = ?').run(s.id);
  return { ok: true };
});

on('POST', '/api/students/import', 'user', async ({ db, user, body }) => {
  const def = await requireKelas(db, user, body.kelas_id);
  if (!Array.isArray(body.rows) || !body.rows.length) throw bad('Tidak ada baris untuk diimpor.');
  if (body.rows.length > 2000) throw bad('Maksimal 2000 baris per impor.');
  const [userKelasList, nisRows, nmRows] = await Promise.all([
    kelasForUser(db, user),
    db.prepare("SELECT nis FROM students WHERE nis != ''").all(),
    db.prepare("SELECT lower(nama) || '|' || kelas_id AS k FROM students").all()
  ]);
  const allowed = new Map(userKelasList.map((k) => [k.nama.toLowerCase(), k]));
  const nisSeen = new Set(nisRows.map((r) => r.nis));
  const nmSeen = new Set(nmRows.map((r) => r.k));
  const skipped = [];
  const stmts = [];
  for (let i = 0; i < body.rows.length; i++) {
    const r = body.rows[i];
    const baris = i + 1;
    const nama = String((r && r.nama) || '').trim().slice(0, 100), nis = String((r && r.nis) || '').trim().slice(0, 30);
    if (!nama) { skipped.push({ baris, alasan: 'Nama kosong' }); continue; }
    let k = def; const kn = String((r && r.kelas) || '').trim();
    if (kn) {
      k = allowed.get(kn.toLowerCase());
      if (!k) { skipped.push({ baris, nama, alasan: `Kelas "${kn.slice(0, 20)}" tidak ada atau bukan kelas Anda` }); continue; }
    }
    const key = nama.toLowerCase() + '|' + k.id;
    if ((nis && nisSeen.has(nis)) || nmSeen.has(key)) { skipped.push({ baris, nama, alasan: 'Sudah ada' }); continue; }
    stmts.push({ sql: 'INSERT INTO students (nama, nis, jk, kelas_id) VALUES (?,?,?,?)', args: [nama, nis, jkOf(r.jk), k.id] });
    if (nis) nisSeen.add(nis);
    nmSeen.add(key);
  }
  if (stmts.length) await db.batch(stmts);
  return { added: stmts.length, skipped };
});

/* ----- absensi ----- */
on('GET', '/api/attendance', 'user', async ({ db, user, query }) => {
  const k = await requireKelas(db, user, query.kelas_id);
  if (!validDate(query.date)) throw bad('Tanggal tidak valid.');
  const siswa = await db.prepare(`SELECT s.id, s.nama, s.nis, s.jk, COALESCE(a.status, '') AS status, COALESCE(a.catatan, '') AS catatan
    FROM students s LEFT JOIN attendance a ON a.student_id = s.id AND a.tanggal = ? WHERE s.kelas_id = ? ORDER BY s.nama COLLATE NOCASE`).all(query.date, k.id);
  return { kelas: k, date: query.date, siswa };
});

on('PUT', '/api/attendance', 'user', async ({ db, user, body }) => {
  const k = await requireKelas(db, user, body.kelas_id);
  if (!validDate(body.date)) throw bad('Tanggal tidak valid.');
  if (!Array.isArray(body.entries) || body.entries.length > 500) throw bad('Data absensi tidak valid.');
  const ok = new Set((await db.prepare('SELECT id FROM students WHERE kelas_id = ?').all(k.id)).map((r) => Number(r.id)));
  const upSql = `INSERT INTO attendance (student_id, tanggal, status, catatan, updated_by, updated_at) VALUES (?,?,?,?,?,datetime('now'))
    ON CONFLICT(student_id, tanggal) DO UPDATE SET status = excluded.status, catatan = excluded.catatan, updated_by = excluded.updated_by, updated_at = excluded.updated_at`;
  const delSql = 'DELETE FROM attendance WHERE student_id = ? AND tanggal = ?';
  const stmts = [];
  for (const e of body.entries) {
    const sid = Number(e.student_id);
    if (!ok.has(sid)) throw bad('Ada siswa yang bukan dari kelas ini.');
    const st = String(e.status || ''), cat = str(e.catatan, 200, 'Catatan');
    if (!st && !cat) stmts.push({ sql: delSql, args: [sid, body.date] });
    else if (!st) throw bad('Pilih status kehadiran sebelum menulis catatan.');
    else if (!['H', 'S', 'I', 'A'].includes(st)) throw bad('Status tidak valid.');
    else stmts.push({ sql: upSql, args: [sid, body.date, st, cat, user.id] });
  }
  if (stmts.length) await db.batch(stmts);
  return { ok: true };
});

on('GET', '/api/rekap', 'user', async ({ db, user, query }) => {
  const k = await requireKelas(db, user, query.kelas_id);
  if (!reMonth.test(query.month || '')) throw bad('Bulan tidak valid.');
  return await buildRekap(db, k, query.month);
});
on('GET', '/api/rekap.csv', 'user', async ({ db, user, query, ctx }) => {
  const k = await requireKelas(db, user, query.kelas_id);
  if (!reMonth.test(query.month || '')) throw bad('Bulan tidak valid.');
  const r = await buildRekap(db, k, query.month);
  const head = ['No', 'Nama', 'NISN/NIS']; for (let d = 1; d <= r.jumlah_hari; d++) head.push(d);
  head.push('Hadir', 'Sakit', 'Izin', 'Alpa', '% Hadir');
  const lines = [head.join(',')];
  r.siswa.forEach((s, i) => { const row = [i + 1, s.nama, s.nis]; for (let d = 1; d <= r.jumlah_hari; d++) row.push(s.days[d] || ''); row.push(s.H, s.S, s.I, s.A, s.persen === null ? '' : s.persen); lines.push(row.map(csvCell).join(',')); });
  return ctx.raw('\uFEFF' + lines.join('\r\n'), 'text/csv; charset=utf-8', `rekap-kelas-${k.nama}-${query.month}.csv`.replace(/[^\w.-]/g, '_'));
});

on('GET', '/api/rekap.xlsx', 'user', async ({ db, user, query, ctx }) => {
  const k = await requireKelas(db, user, query.kelas_id);
  if (!reMonth.test(query.month || '')) throw bad('Bulan tidak valid.');
  const [rekapData, schoolInfo] = await Promise.all([buildRekap(db, k, query.month), school(db)]);
  const buf = rekapWorkbook(rekapData, schoolInfo);
  return ctx.raw(buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `rekap-kelas-${k.nama}-${query.month}.xlsx`.replace(/[^\w.-]/g, '_'));
});

/* ----- admin: pengguna, kelas, sekolah ----- */
const userOut = async (db, u) => ({
  id: Number(u.id),
  username: u.username,
  nama: u.nama,
  role: u.role,
  aktif: !!u.aktif,
  kelas_ids: (await db.prepare('SELECT kelas_id FROM user_kelas WHERE user_id = ?').all(u.id)).map((r) => Number(r.kelas_id))
});
async function setUserKelas(db, userId, ids) {
  if (!Array.isArray(ids)) throw bad('Daftar kelas tidak valid.');
  await db.prepare('DELETE FROM user_kelas WHERE user_id = ?').run(userId);
  const ins = db.prepare('INSERT OR IGNORE INTO user_kelas (user_id, kelas_id) VALUES (?,?)');
  for (const id of ids) {
    if (!(await db.prepare('SELECT 1 FROM kelas WHERE id = ?').get(Number(id)))) throw bad('Kelas tidak ditemukan.');
    await ins.run(userId, Number(id));
  }
}
on('GET', '/api/users', 'admin', async ({ db }) => {
  const [rows, ukRows] = await Promise.all([
    db.prepare('SELECT * FROM users ORDER BY role, nama COLLATE NOCASE').all(),
    db.prepare('SELECT user_id, kelas_id FROM user_kelas').all()
  ]);
  const mapUk = new Map();
  for (const r of ukRows) {
    const uid = Number(r.user_id);
    if (!mapUk.has(uid)) mapUk.set(uid, []);
    mapUk.get(uid).push(Number(r.kelas_id));
  }
  const users = rows.map((u) => ({
    id: Number(u.id),
    username: u.username,
    nama: u.nama,
    role: u.role,
    aktif: !!u.aktif,
    kelas_ids: mapUk.get(Number(u.id)) || []
  }));
  return { users };
});
on('POST', '/api/users', 'admin', async ({ db, body }) => {
  const username = reqStr(body.username, 40, 'Nama pengguna'), nama = reqStr(body.nama, 80, 'Nama lengkap');
  if (!/^[A-Za-z0-9_.-]+$/.test(username)) throw bad('Nama pengguna hanya boleh huruf, angka, titik, garis bawah, dan strip.');
  checkPassword(body.password);
  const role = body.role === 'admin' ? 'admin' : 'guru';
  if (await db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'Nama pengguna sudah dipakai.');
  return await tx(db, async (tdb) => {
    const r = await tdb.prepare('INSERT INTO users (username, nama, role, password_hash) VALUES (?,?,?,?)').run(username, nama, role, auth.hashPassword(body.password));
    await setUserKelas(tdb, Number(r.lastInsertRowid), body.kelas_ids || []);
    return { id: Number(r.lastInsertRowid) };
  });
});
on('PATCH', '/api/users/:id', 'admin', async ({ db, user, params, body }) => {
  const u = await db.prepare('SELECT * FROM users WHERE id = ?').get(Number(params.id));
  if (!u) throw new HttpError(404, 'Pengguna tidak ditemukan.');
  const role = body.role !== undefined ? (body.role === 'admin' ? 'admin' : 'guru') : u.role;
  const aktif = body.aktif !== undefined ? (body.aktif ? 1 : 0) : u.aktif;
  if (Number(u.id) === user.id && (role !== 'admin' || !aktif)) throw bad('Anda tidak bisa menurunkan atau menonaktifkan akun Anda sendiri.');
  await tx(db, async (tdb) => {
    await tdb.prepare('UPDATE users SET nama = ?, role = ?, aktif = ? WHERE id = ?').run(body.nama !== undefined ? reqStr(body.nama, 80, 'Nama lengkap') : u.nama, role, aktif, u.id);
    if (body.kelas_ids !== undefined) await setUserKelas(tdb, u.id, body.kelas_ids);
    if (body.password) {
      checkPassword(body.password);
      await tdb.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(body.password), u.id);
      await auth.destroyUserSessions(tdb, u.id);
    }
    if (!aktif) await auth.destroyUserSessions(tdb, u.id);
  });
  return { ok: true };
});
on('DELETE', '/api/users/:id', 'admin', async ({ db, user, params }) => {
  const id = Number(params.id);
  if (id === user.id) throw bad('Anda tidak bisa menghapus akun Anda sendiri.');
  await db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return { ok: true };
});
on('POST', '/api/kelas', 'admin', async ({ db, body }) => {
  const nama = reqStr(body.nama, 20, 'Nama kelas');
  if (await db.prepare('SELECT 1 FROM kelas WHERE nama = ?').get(nama)) throw new HttpError(409, 'Kelas sudah ada.');
  const res = await db.prepare('INSERT INTO kelas (nama) VALUES (?)').run(nama);
  return { id: Number(res.lastInsertRowid) };
});
on('DELETE', '/api/kelas/:id', 'admin', async ({ db, params }) => {
  const id = Number(params.id);
  const cRow = await db.prepare('SELECT COUNT(*) c FROM students WHERE kelas_id = ?').get(id);
  if (Number(cRow.c)) throw new HttpError(409, 'Kelas masih berisi siswa. Pindahkan atau hapus siswanya dulu.');
  await db.prepare('DELETE FROM kelas WHERE id = ?').run(id);
  return { ok: true };
});
on('PUT', '/api/school', 'admin', async ({ db, body }) => {
  await db.batch([
    { sql: 'INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', args: ['school_nama', reqStr(body.nama, 100, 'Nama sekolah')] },
    { sql: 'INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', args: ['school_tahun', str(body.tahun, 20, 'Tahun ajaran')] }
  ]);
  return { ok: true };
});

module.exports = { routes, HttpError, userOut };
