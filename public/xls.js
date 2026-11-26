/* Pembaca berkas Excel tanpa library: .xls (BIFF8 / OLE2) dan .xlsx.
   XLSReader.read(arrayBuffer) -> Promise<string[][]> (lembar pertama yang terlihat). Dipakai di browser dan Node (untuk uji). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.XLSReader = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function u8(buf) { return buf instanceof Uint8Array ? buf : new Uint8Array(buf); }
  function dv(a) { return new DataView(a.buffer, a.byteOffset, a.byteLength); }
  function fmtNum(n) { if (Number.isInteger(n)) return String(n); var s = String(Math.round(n * 1e9) / 1e9); return s; }

  /* ---------- OLE2 (berkas gabungan) ---------- */
  function readOle(a) {
    var v = dv(a), sig = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    for (var i = 0; i < 8; i++) if (a[i] !== sig[i]) throw new Error('Bukan berkas Excel .xls yang valid.');
    var ss = 1 << v.getUint16(30, true), mss = 1 << v.getUint16(32, true);
    var nFat = v.getUint32(44, true), dirStart = v.getUint32(48, true), cutoff = v.getUint32(56, true);
    var miniStart = v.getUint32(60, true), nMini = v.getUint32(64, true), difStart = v.getUint32(68, true), nDif = v.getUint32(72, true);
    var maxSec = Math.floor((a.length - 512) / ss) + 1;
    function sector(n) { var o = 512 + n * ss; if (n < 0 || o + ss > a.length + 1) throw new Error('Berkas .xls rusak.'); return a.subarray(o, Math.min(o + ss, a.length)); }
    var fatIds = [], k;
    for (k = 0; k < 109 && fatIds.length < nFat; k++) { var id = v.getUint32(76 + k * 4, true); if (id < 0xFFFFFFFA) fatIds.push(id); }
    var d = difStart;
    for (k = 0; k < nDif && d < 0xFFFFFFFA; k++) {
      var sd = dv(sector(d));
      for (var j = 0; j < ss / 4 - 1 && fatIds.length < nFat; j++) { var x = sd.getUint32(j * 4, true); if (x < 0xFFFFFFFA) fatIds.push(x); }
      d = sd.getUint32(ss - 4, true);
    }
    var fat = [];
    fatIds.forEach(function (fid) { var s = dv(sector(fid)); for (var q = 0; q < ss / 4; q++) fat.push(s.getUint32(q * 4, true)); });
    function chain(start, table, size, get) {
      var parts = [], n = start, guard = 0;
      while (n < 0xFFFFFFFA && guard++ < 1e6) { parts.push(get(n)); n = table[n]; if (n === undefined) break; }
      var out = new Uint8Array(parts.length * size), p = 0;
      parts.forEach(function (c) { out.set(c, p); p += size; });
      return out;
    }
    var dir = chain(dirStart, fat, ss, sector), dd = dv(dir), entries = [];
    for (var e = 0; e + 128 <= dir.length; e += 128) {
      var nl = dd.getUint16(e + 64, true), name = '';
      for (var c = 0; c < Math.max(0, nl / 2 - 1); c++) name += String.fromCharCode(dd.getUint16(e + c * 2, true));
      entries.push({ name: name, type: dir[e + 66], start: dd.getUint32(e + 116, true), size: dd.getUint32(e + 120, true) });
    }
    var root = entries[0];
    var miniFat = [];
    if (nMini && miniStart < 0xFFFFFFFA) {
      var mf = dv(chain(miniStart, fat, ss, sector));
      for (var m = 0; m < mf.byteLength / 4; m++) miniFat.push(mf.getUint32(m * 4, true));
    }
    var miniData = null;
    function stream(entry) {
      if (entry.size < cutoff) {
        if (!miniData) miniData = chain(root.start, fat, ss, sector);
        var raw = chain(entry.start, miniFat, mss, function (n) { return miniData.subarray(n * mss, n * mss + mss); });
        return raw.subarray(0, entry.size);
      }
      return chain(entry.start, fat, ss, sector).subarray(0, entry.size);
    }
    var wb = entries.filter(function (x) { return x.type === 2 && (x.name === 'Workbook' || x.name === 'Book'); })[0];
    if (!wb) throw new Error('Berkas ini tidak berisi lembar kerja Excel.');
    return stream(wb);
  }

  /* ---------- BIFF8 ---------- */
  function readBiff(s) {
    var v = dv(s), pos = 0, recs = [];
    while (pos + 4 <= s.length) {
      var id = v.getUint16(pos, true), len = v.getUint16(pos + 2, true);
      recs.push({ id: id, off: pos + 4, len: Math.min(len, s.length - pos - 4) }); pos += 4 + len;
    }
    return recs;
  }
  function utf16(a, o, n) { var t = ''; for (var i = 0; i < n; i++) t += String.fromCharCode(a[o + i * 2] | (a[o + i * 2 + 1] << 8)); return t; }
  function latin(a, o, n) { var t = ''; for (var i = 0; i < n; i++) t += String.fromCharCode(a[o + i]); return t; }

  // Daftar string bersama (SST) dengan sambungan CONTINUE
  function parseSst(s, recs, idx) {
    var chunks = [{ off: recs[idx].off, len: recs[idx].len }], i = idx + 1;
    while (i < recs.length && recs[i].id === 0x003C) { chunks.push({ off: recs[i].off, len: recs[i].len }); i++; }
    var ci = 0, p = 0;
    function cur() { return chunks[ci]; }
    function need(n) { while (p >= cur().len && ci < chunks.length - 1) { ci++; p = 0; } return ci < chunks.length && p + 0 <= cur().len; }
    function byte() { need(1); var b = s[cur().off + p]; p++; return b; }
    function u16() { var a = byte(), b = byte(); return a | (b << 8); }
    function u32() { var a = u16(), b = u16(); return (a + b * 65536) >>> 0; }
    u32(); var unique = u32(), out = [];
    for (var n = 0; n < unique; n++) {
      if (ci >= chunks.length || (ci === chunks.length - 1 && p >= cur().len)) break;
      var cch = u16(), flags = byte(), wide = flags & 1, ext = flags & 4, rich = flags & 8, runs = 0, extLen = 0;
      if (rich) runs = u16(); if (ext) extLen = u32();
      var str = '', left = cch;
      while (left > 0) {
        if (p >= cur().len && ci < chunks.length - 1) { ci++; p = 0; wide = byte() & 1; }
        var avail = cur().len - p, bytesPer = wide ? 2 : 1, take = Math.min(left, Math.floor(avail / bytesPer));
        if (take <= 0) { if (ci < chunks.length - 1) { ci++; p = 0; wide = byte() & 1; continue; } break; }
        str += wide ? utf16(s, cur().off + p, take) : latin(s, cur().off + p, take);
        p += take * bytesPer; left -= take;
      }
      var skip = runs * 4 + extLen;
      while (skip > 0) { if (p >= cur().len && ci < chunks.length - 1) { ci++; p = 0; } var tk = Math.min(skip, cur().len - p); if (tk <= 0) break; p += tk; skip -= tk; }
      out.push(str);
    }
    return out;
  }
  function rkValue(rk) {
    var div = rk & 1, isInt = rk & 2, val;
    if (isInt) val = rk >> 2;
    else { var b = new DataView(new ArrayBuffer(8)); b.setUint32(4, (rk & 0xFFFFFFFC) >>> 0, true); val = b.getFloat64(0, true); }
    return div ? val / 100 : val;
  }
  function inlineStr(s, off, len) { // string BIFF8 dengan u16 panjang (LABEL / STRING)
    var cch = s[off] | (s[off + 1] << 8), flags = s[off + 2], wide = flags & 1, o = off + 3;
    if (flags & 8) o += 2; if (flags & 4) o += 4;
    return wide ? utf16(s, o, Math.min(cch, Math.floor((off + len - o) / 2))) : latin(s, o, Math.min(cch, off + len - o));
  }

  function parseXls(buf) {
    var s = readOle(u8(buf)), v = dv(s), recs = readBiff(s), sst = [], sheets = [], i;
    for (i = 0; i < recs.length; i++) {
      var r = recs[i];
      if (r.id === 0x002F) throw new Error('File dilindungi kata sandi. Buka di Excel lalu simpan tanpa kata sandi.');
      if (r.id === 0x00FC) sst = parseSst(s, recs, i);
      if (r.id === 0x0085) sheets.push({ off: v.getUint32(r.off, true), hidden: s[r.off + 4] & 3, type: s[r.off + 5] });
      if (r.id === 0x000A && sheets.length) break; // EOF globals
    }
    var sheet = sheets.filter(function (x) { return x.type === 0 && !x.hidden; })[0] || sheets.filter(function (x) { return x.type === 0; })[0];
    if (!sheet) throw new Error('Tidak ada lembar kerja di berkas ini.');
    var start = recs.findIndex(function (r) { return r.off - 4 === sheet.off; });
    if (start < 0) throw new Error('Struktur berkas .xls tidak dikenali.');
    var cells = {}, maxR = -1, maxC = -1, pendingStr = null, depth = 0;
    function put(r, c, val) { if (val === '' || val == null) return; (cells[r] = cells[r] || {})[c] = val; if (r > maxR) maxR = r; if (c > maxC) maxC = c; }
    for (i = start; i < recs.length; i++) {
      var q = recs[i], o = q.off;
      if (q.id === 0x0809) { depth++; if (depth > 1) { /* sub-stream (grafik) */ } continue; }
      if (q.id === 0x000A) break;
      if (q.id === 0x00FD) put(v.getUint16(o, true), v.getUint16(o + 2, true), sst[v.getUint32(o + 6, true)]);
      else if (q.id === 0x0203) put(v.getUint16(o, true), v.getUint16(o + 2, true), fmtNum(v.getFloat64(o + 6, true)));
      else if (q.id === 0x027E) put(v.getUint16(o, true), v.getUint16(o + 2, true), fmtNum(rkValue(v.getUint32(o + 6, true))));
      else if (q.id === 0x00BD) {
        var row = v.getUint16(o, true), c0 = v.getUint16(o + 2, true), n = (q.len - 6) / 6;
        for (var k = 0; k < n; k++) put(row, c0 + k, fmtNum(rkValue(v.getUint32(o + 4 + k * 6 + 2, true))));
      }
      else if (q.id === 0x0204) put(v.getUint16(o, true), v.getUint16(o + 2, true), inlineStr(s, o + 6, q.len - 6));
      else if (q.id === 0x0006) {
        var fr = v.getUint16(o, true), fc = v.getUint16(o + 2, true);
        if (s[o + 12] === 0xFF && s[o + 13] === 0xFF) { if (s[o + 6] === 0) pendingStr = [fr, fc]; }
        else put(fr, fc, fmtNum(v.getFloat64(o + 6, true)));
      }
      else if (q.id === 0x0207 && pendingStr) { put(pendingStr[0], pendingStr[1], inlineStr(s, o, q.len)); pendingStr = null; }
    }
    var out = [];
    for (var r2 = 0; r2 <= maxR; r2++) { var row2 = []; for (var c2 = 0; c2 <= maxC; c2++) row2.push(cells[r2] && cells[r2][c2] != null ? String(cells[r2][c2]) : ''); out.push(row2); }
    return out;
  }

  /* ---------- .xlsx (zip + XML) ---------- */
  function inflateRaw(data) {
    if (typeof DecompressionStream !== 'undefined') {
      var ds = new DecompressionStream('deflate-raw');
      return new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer().then(function (b) { return new Uint8Array(b); });
    }
    return Promise.resolve(require('node:zlib').inflateRawSync(data));
  }
  function readZip(a) {
    var v = dv(a), eocd = -1;
    for (var i = a.length - 22; i >= Math.max(0, a.length - 66000); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Berkas .xlsx tidak valid.');
    var n = v.getUint16(eocd + 10, true), p = v.getUint32(eocd + 16, true), files = {};
    for (var k = 0; k < n; k++) {
      if (v.getUint32(p, true) !== 0x02014b50) break;
      var method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
      var name = new TextDecoder().decode(a.subarray(p + 46, p + 46 + nl));
      files[name] = { method: method, csize: csize, lo: lo }; p += 46 + nl + el + cl;
    }
    function get(name) {
      var f = files[name]; if (!f) return Promise.resolve(null);
      var lh = f.lo, dataStart = lh + 30 + v.getUint16(lh + 26, true) + v.getUint16(lh + 28, true), raw = a.subarray(dataStart, dataStart + f.csize);
      return (f.method === 0 ? Promise.resolve(raw) : inflateRaw(raw)).then(function (b) { return new TextDecoder().decode(b); });
    }
    return { get: get, has: function (n) { return !!files[n]; } };
  }
  function unent(t) { return t.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, function (m, e) { if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)); return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()]; }); }
  function textOf(xml) { var t = '', re = /<t\b[^>]*>([\s\S]*?)<\/t>/g, m; while ((m = re.exec(xml))) t += m[1]; return unent(t); }
  function colIndex(ref) { var l = /^[A-Z]+/.exec(ref)[0], n = 0; for (var i = 0; i < l.length; i++) n = n * 26 + (l.charCodeAt(i) - 64); return n - 1; }
  function parseXlsx(buf) {
    var z = readZip(u8(buf)), shared = [], sheetPath = 'xl/worksheets/sheet1.xml';
    return z.get('xl/workbook.xml').then(function (wbx) {
      if (!wbx) throw new Error('Berkas .xlsx tidak berisi lembar kerja.');
      var m = /<sheet\b[^>]*?r:id="([^"]+)"/.exec(wbx);
      return z.get('xl/_rels/workbook.xml.rels').then(function (rels) {
        if (m && rels) { var rm = new RegExp('<Relationship\\b[^>]*?Id="' + m[1] + '"[^>]*?>').exec(rels), tm = rm && /Target="([^"]+)"/.exec(rm[0]); if (tm) sheetPath = tm[1].charAt(0) === '/' ? tm[1].slice(1) : 'xl/' + tm[1]; }
        return z.get('xl/sharedStrings.xml');
      });
    }).then(function (sx) {
      if (sx) { var re = /<si\b[^>]*>([\s\S]*?)<\/si>/g, m; while ((m = re.exec(sx))) shared.push(textOf(m[1])); }
      return z.get(sheetPath);
    }).then(function (xml) {
      if (!xml) throw new Error('Lembar kerja tidak ditemukan.');
      var rows = [], re = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, m;
      while ((m = re.exec(xml))) {
        var attrs = m[1], body = m[2] || '', ref = /\br="([A-Z]+)(\d+)"/.exec(attrs); if (!ref) continue;
        var t = (/\bt="(\w+)"/.exec(attrs) || [])[1], vm = /<v>([\s\S]*?)<\/v>/.exec(body), val = '';
        if (t === 'inlineStr') val = textOf(body);
        else if (vm) { val = unent(vm[1]); if (t === 's') val = shared[+val] || ''; else if (!t || t === 'n') { var num = Number(val); val = isNaN(num) ? val : fmtNum(num); } else if (t === 'b') val = val === '1' ? 'TRUE' : 'FALSE'; }
        var r = +ref[2] - 1, c = colIndex(ref[1]); (rows[r] = rows[r] || [])[c] = val;
      }
      var w = 0; rows.forEach(function (r) { if (r && r.length > w) w = r.length; });
      var out = []; for (var i = 0; i < rows.length; i++) { var row = rows[i] || [], full = []; for (var j = 0; j < w; j++) full.push(row[j] == null ? '' : String(row[j])); out.push(full); }
      return out;
    });
  }

  function read(buffer) {
    var a = u8(buffer);
    try {
      if (a[0] === 0xD0 && a[1] === 0xCF) return Promise.resolve(parseXls(a));
      if (a[0] === 0x50 && a[1] === 0x4B) return parseXlsx(a);
    } catch (e) { return Promise.reject(e); }
    return Promise.reject(new Error('Format file tidak dikenali. Gunakan file Excel .xls atau .xlsx.'));
  }
  return { read: read };
});
