'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { read } = require('../public/xls.js');
const dir = path.join(__dirname, 'fixtures');
const ref = JSON.parse(fs.readFileSync(path.join(dir, 'ref.json')));

// ref.json dibuat dari pembaca independen (xlrd untuk .xls, openpyxl untuk .xlsx)
for (const f of ['template-siswa.xls', 'uji.xls', 'uji.xlsx']) {
  test('pembaca Excel cocok dengan pembaca pembanding: ' + f, async () => {
    assert.deepEqual(await read(fs.readFileSync(path.join(dir, f))), ref[f]);
  });
}
test('template resmi bisa dibaca dan berisi kolom yang benar', async () => {
  const rows = await read(fs.readFileSync(path.join(__dirname, '..', 'public', 'template-siswa.xls')));
  assert.deepEqual(rows[0], ['Nama', 'NISN/NIS', 'Kelas', 'JK']);
});
test('file bukan Excel ditolak dengan pesan jelas', async () => {
  await assert.rejects(read(Buffer.from('bukan excel')), /Format file tidak dikenali/);
  await assert.rejects(read(Buffer.concat([Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]), Buffer.alloc(600)])), /Excel|rusak|lembar/i);
});
