'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');

let server, base;
const jar = {};
async function call(who, method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (jar[who]) headers.Cookie = jar[who];
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = res.headers.getSetCookie();
  if (sc.length) jar[who] = sc[0].split(';')[0];
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

test.before(async () => {
  server = createServer({ dbFile: ':memory:' });
  await new Promise((r) => server.listen(0, r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => server.close());

test('setup awal hanya sekali', async () => {
  assert.equal((await call('a', 'GET', '/api/setup-status')).data.needsSetup, true);
  assert.equal((await call('a', 'POST', '/api/setup', { username: 'admin', nama: 'Admin', password: 'pendek', sekolah: 'SDN 1' })).status, 400);
  assert.equal((await call('a', 'POST', '/api/setup', { username: 'admin', nama: 'Admin', password: 'rahasia123', sekolah: 'SDN 1', tahun: '2026/2027' })).status, 200);
  assert.equal((await call('a', 'POST', '/api/setup', { username: 'x', nama: 'X', password: 'rahasia123', sekolah: 'S' })).status, 409);
});

test('login, sesi, dan logout', async () => {
  assert.equal((await call('a', 'GET', '/api/me')).status, 401);
  assert.equal((await call('a', 'POST', '/api/login', { username: 'admin', password: 'salah' })).status, 401);
  assert.equal((await call('a', 'POST', '/api/login', { username: 'admin', password: 'rahasia123' })).status, 200);
  const me = await call('a', 'GET', '/api/me');
  assert.equal(me.data.user.role, 'admin');
  assert.equal(me.data.kelas.length, 6);
});

let kelas1, kelas2, guru1;
test('admin membuat guru dengan akses kelas terbatas', async () => {
  const me = (await call('a', 'GET', '/api/me')).data;
  kelas1 = me.kelas.find((k) => k.nama === '1').id; kelas2 = me.kelas.find((k) => k.nama === '2').id;
  assert.equal((await call('a', 'POST', '/api/users', { username: 'bu.ani', nama: 'Bu Ani', password: 'guru12345', role: 'guru', kelas_ids: [kelas1] })).status, 200);
  assert.equal((await call('a', 'POST', '/api/users', { username: 'bu.ani', nama: 'Dobel', password: 'guru12345' })).status, 409);
  assert.equal((await call('g', 'POST', '/api/login', { username: 'bu.ani', password: 'guru12345' })).status, 200);
  const m = (await call('g', 'GET', '/api/me')).data;
  assert.deepEqual(m.kelas.map((k) => k.nama), ['1']);
  assert.equal((await call('g', 'GET', '/api/users')).status, 403);
});

test('guru hanya mengelola kelasnya sendiri', async () => {
  const add = await call('g', 'POST', '/api/students', { kelas_id: kelas1, nama: 'Rani', nis: '1001', jk: 'P' });
  assert.equal(add.status, 200);
  assert.equal((await call('g', 'POST', '/api/students', { kelas_id: kelas1, nama: 'Dobel', nis: '1001' })).status, 409);
  assert.equal((await call('g', 'POST', '/api/students', { kelas_id: kelas2, nama: 'Intip' })).status, 403);
  assert.equal((await call('g', 'GET', '/api/students?kelas_id=' + kelas2)).status, 403);
  const imp = await call('g', 'POST', '/api/students/import', { kelas_id: kelas1, rows: [
    { nama: 'Budi', nis: '1002', jk: 'L' }, { nama: 'Rani', nis: '', jk: 'P' }, { nama: '', nis: '5' }, { nama: 'Salah Kelas', kelas: '2' }, { nama: 'Cika', nis: '1003', kelas: '1', jk: 'Perempuan' } ] });
  assert.equal(imp.data.added, 2);
  assert.equal(imp.data.skipped.length, 3);
});

let sid;
test('absensi: simpan, ubah, hapus, dan validasi', async () => {
  const list = (await call('g', 'GET', `/api/attendance?kelas_id=${kelas1}&date=2026-11-25`)).data.siswa;
  assert.equal(list.length, 3); sid = list[0].id;
  const put = (entries, date = '2026-11-25') => call('g', 'PUT', '/api/attendance', { kelas_id: kelas1, date, entries });
  assert.equal((await put(list.map((s) => ({ student_id: s.id, status: 'H' })))).status, 200);
  assert.equal((await put([{ student_id: sid, status: 'S', catatan: 'Demam' }])).status, 200);
  const again = (await call('g', 'GET', `/api/attendance?kelas_id=${kelas1}&date=2026-11-25`)).data.siswa;
  assert.equal(again.find((s) => s.id === sid).status, 'S');
  assert.equal(again.find((s) => s.id === sid).catatan, 'Demam');
  assert.equal((await put([{ student_id: sid, status: 'X' }])).status, 400);
  assert.equal((await put([{ student_id: 99999, status: 'H' }])).status, 400);
  assert.equal((await put([{ student_id: sid, status: 'H' }], '2026-13-40')).status, 400);
  assert.equal((await call('a', 'PUT', '/api/attendance', { kelas_id: kelas2, date: '2026-11-25', entries: [{ student_id: sid, status: 'H' }] })).status, 400);
  await put([{ student_id: list[1].id, status: '' }]);
  const after = (await call('g', 'GET', `/api/attendance?kelas_id=${kelas1}&date=2026-11-25`)).data.siswa;
  assert.equal(after.find((s) => s.id === list[1].id).status, '');
});

test('rekap bulanan dan CSV', async () => {
  await call('g', 'PUT', '/api/attendance', { kelas_id: kelas1, date: '2026-11-26', entries: [{ student_id: sid, status: 'A' }] });
  const r = (await call('g', 'GET', `/api/rekap?kelas_id=${kelas1}&month=2026-11`)).data;
  assert.equal(r.jumlah_hari, 30);
  const s = r.siswa.find((x) => x.id === sid);
  assert.equal(s.S, 1); assert.equal(s.A, 1); assert.equal(s.persen, 0); assert.equal(s.days[25], 'S');
  const csv = await call('g', 'GET', `/api/rekap.csv?kelas_id=${kelas1}&month=2026-11`);
  assert.match(csv.data, /Nama,NISN\/NIS,1,2/); assert.match(csv.data, /Demam|Rani|Budi|Cika/);
  assert.equal((await call('g', 'GET', `/api/rekap?kelas_id=${kelas1}&month=2026-1`)).status, 400);
});

test('CSV tidak menjalankan rumus', async () => {
  await call('a', 'POST', '/api/students', { kelas_id: kelas2, nama: '=HYPERLINK("x")', nis: '2001' });
  const csv = (await call('a', 'GET', `/api/rekap.csv?kelas_id=${kelas2}&month=2026-11`)).data;
  assert.ok(csv.includes("'=HYPERLINK"));
});

test('kelas tidak bisa dihapus bila masih berisi siswa; guru nonaktif tidak bisa masuk', async () => {
  assert.equal((await call('a', 'DELETE', '/api/kelas/' + kelas1)).status, 409);
  const users = (await call('a', 'GET', '/api/users')).data.users;
  const ani = users.find((u) => u.username === 'bu.ani');
  assert.deepEqual(ani.kelas_ids, [kelas1]);
  assert.equal((await call('a', 'PATCH', '/api/users/' + ani.id, { aktif: false })).status, 200);
  assert.equal((await call('g', 'GET', '/api/me')).status, 401);
  assert.equal((await call('g2', 'POST', '/api/login', { username: 'bu.ani', password: 'guru12345' })).status, 401);
});

test('admin tidak bisa menonaktifkan dirinya sendiri; ganti sandi', async () => {
  const me = (await call('a', 'GET', '/api/me')).data.user;
  assert.equal((await call('a', 'PATCH', '/api/users/' + me.id, { aktif: false })).status, 400);
  assert.equal((await call('a', 'POST', '/api/me/password', { lama: 'salah', baru: 'sandibaru123' })).status, 400);
  assert.equal((await call('a', 'POST', '/api/me/password', { lama: 'rahasia123', baru: 'sandibaru123' })).status, 200);
  assert.equal((await call('a', 'GET', '/api/me')).status, 200);
});

test('pembatas login dan logout', async () => {
  let last;
  for (let i = 0; i < 9; i++) last = await call('z', 'POST', '/api/login', { username: 'ngawur', password: 'x' });
  assert.equal(last.status, 429);
  assert.equal((await call('a', 'POST', '/api/logout')).status, 200);
  assert.equal((await call('a', 'GET', '/api/me')).status, 401);
});

test('file statis aman dari path traversal', async () => {
  const r = await fetch(base + '/..%2f..%2fpackage.json'); assert.equal(r.status, 404);
  assert.equal((await fetch(base + '/healthz')).status, 200);
});

test('unduhan rekap berformat Excel (.xlsx) berisi data yang benar', async () => {
  const { read } = require('../public/xls.js');
  await call('a', 'POST', '/api/login', { username: 'admin', password: 'sandibaru123' });
  const res = await fetch(`${base}/api/rekap.xlsx?kelas_id=${kelas1}&month=2026-11`, { headers: { Cookie: jar.a } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /spreadsheetml\.sheet/);
  assert.match(res.headers.get('content-disposition'), /rekap-kelas-1-2026-11\.xlsx/);
  const rows = await read(Buffer.from(await res.arrayBuffer()));
  const head = rows.find((r) => r[0] === 'No');
  assert.deepEqual(head.slice(0, 4), ['No', 'Nama', 'NISN/NIS', '1']);
  const rani = rows.find((r) => r[1] === 'Rani');
  assert.equal(rani[2], '1001'); assert.equal(rani[3 + 24], 'H');
  assert.equal((await fetch(`${base}/api/rekap.xlsx?kelas_id=${kelas1}&month=2026-11`)).status, 401);
});
