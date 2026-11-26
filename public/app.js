(function () {
  'use strict';
  var STATUS = { H: 'Hadir', S: 'Sakit', I: 'Izin', A: 'Alpa' };
  var BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  var HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

  /* ---------- util ---------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var ymd = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var parseYmd = function (s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  var tglPanjang = function (s) { var d = parseYmd(s); return HARI[d.getDay()] + ', ' + d.getDate() + ' ' + BULAN[d.getMonth()] + ' ' + d.getFullYear(); };
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 3000); }

  function api(method, path, body) {
    return fetch(path, { method: method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (r.ok) return data;
          var e = new Error(data.error || 'Terjadi kesalahan.'); e.status = r.status;
          if (r.status === 401 && S.me && path !== '/api/login') { S.me = null; boot(); }
          throw e;
        });
      }, function () { var e = new Error('Tidak ada koneksi ke server.'); e.status = 0; throw e; });
  }
  function fail(e) { if (e && e.status !== 401) toast(e.message || 'Terjadi kesalahan.'); }

  /* ---------- state ---------- */
  var today = ymd(new Date());
  var S = { me: null, school: null, kelas: [], tab: 'harian', kelasId: null, date: today, month: today.slice(0, 7), rows: [], dirty: {}, saving: '', rekap: null, siswa: [], editId: null, imp: null, impResult: null, users: null, msg: '', online: navigator.onLine !== false };
  var saveTimer = null, noteTimers = {};

  /* ---------- boot / auth ---------- */
  function boot() {
    document.title = 'Absensi Kelas SD';
    api('GET', '/api/me').then(function (r) {
      S.me = r.user; S.school = r.school; S.kelas = r.kelas;
      if (!S.kelas.some(function (k) { return k.id === S.kelasId; })) S.kelasId = S.kelas.length ? S.kelas[0].id : null;
      if (S.tab === 'pengguna' || S.tab === 'sekolah') { if (S.me.role !== 'admin') S.tab = 'harian'; }
      loadTab();
    }, function (e) {
      if (e.status === 401) return api('GET', '/api/setup-status').then(function (s) { view(s.needsSetup ? setupView() : loginView()); }, function () { view(loginView('Server tidak bisa dihubungi.')); });
      view(loginView(e.message));
    });
  }

  function loginView(err) {
    return '<div class="auth-bg" aria-hidden="true"><i></i><i></i><i></i></div><div class="auth panel"><span class="logo">' + ICON.logo + '</span><h1>Absensi Kelas SD</h1><p class="muted">Masuk dengan akun guru atau admin.</p>' + (err ? '<div class="err" role="alert">' + esc(err) + '</div>' : '') +
      '<form data-form="login"><div class="field"><label for="lu">Nama pengguna</label><input type="text" id="lu" autocomplete="username" autocapitalize="none" required></div>' +
      '<div class="field"><label for="lp">Kata sandi</label><input type="password" id="lp" autocomplete="current-password" required></div>' +
      '<button class="btn primary" type="submit">Masuk</button></form></div>';
  }
  function setupView(err) {
    return '<div class="auth-bg" aria-hidden="true"><i></i><i></i><i></i></div><div class="auth panel"><span class="logo">' + ICON.logo + '</span><h1>Pengaturan awal</h1><p class="muted">Buat akun admin pertama dan isi nama sekolah. Langkah ini hanya muncul sekali.</p>' + (err ? '<div class="err" role="alert">' + esc(err) + '</div>' : '') +
      '<form data-form="setup"><div class="field"><label for="ss">Nama sekolah</label><input type="text" id="ss" required></div>' +
      '<div class="field"><label for="st">Tahun ajaran</label><input type="text" id="st" placeholder="2026/2027"></div>' +
      '<div class="field"><label for="sn">Nama lengkap admin</label><input type="text" id="sn" autocomplete="name" required></div>' +
      '<div class="field"><label for="su">Nama pengguna</label><input type="text" id="su" autocomplete="username" autocapitalize="none" required></div>' +
      '<div class="field"><label for="sp">Kata sandi (minimal 8 karakter)</label><input type="password" id="sp" autocomplete="new-password" minlength="8" required></div>' +
      '<button class="btn primary" type="submit">Buat akun dan mulai</button></form></div>';
  }
  function view(html) { $('#app').innerHTML = html; }

  /* ---------- layout ---------- */
  function shell(content) {
    var admin = S.me.role === 'admin';
    var tabs = [['harian', 'Absensi Harian', 'check'], ['rekap', 'Rekap Bulanan', 'chart'], ['siswa', 'Data Siswa', 'users']];
    if (admin) tabs.push(['pengguna', 'Pengguna', 'shield'], ['sekolah', 'Sekolah', 'school']);
    tabs.push(['akun', 'Akun saya', 'user']);
    var first = S.me.nama.split(' ')[0], sapa = /^(bu|ibu|pak|bapak)$/i.test(first) ? S.me.nama : first;
    return (S.online ? '' : '<div class="offline" role="status">Tidak ada koneksi internet. Perubahan baru bisa disimpan setelah tersambung.</div>') +
      '<header class="top"><div class="top-in"><div class="brand"><span class="logo">' + ICON.logo + '</span><div><h1>' + esc(S.school.nama) + '</h1><span class="sub">' + (S.school.tahun ? 'Tahun ajaran ' + esc(S.school.tahun) : 'Absensi kelas') + '</span></div>' +
      '<span class="save-state" id="saveState" role="status">' + esc(S.saving) + '</span>' +
      '<div class="who"><span>' + esc(S.me.nama) + ' <span class="badge">' + (admin ? 'Admin' : 'Guru') + '</span></span><button class="btn small" data-act="logout">Keluar</button></div></div>' +
      '<p class="greet">' + greeting() + ', ' + esc(sapa) + '. Hari ini ' + esc(tglPanjang(today)) + '.</p>' +
      '<nav class="tabs" role="tablist" aria-label="Menu utama">' + tabs.map(function (t) { return '<button role="tab" data-tab="' + t[0] + '" aria-selected="' + (S.tab === t[0]) + '">' + ICON[t[2]] + t[1] + '</button>'; }).join('') + '</nav></div></header>' +
      '<main id="main">' + content + '</main>';
  }
  function greeting() { var h = new Date().getHours(); return h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam'; }
  function svg(inner) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>'; }
  var ICON = {
    logo: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4M16 3v4M8.5 14l2.5 2.5 4.5-5"/></svg>',
    check: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>'),
    chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.8a3.4 3.4 0 010 6.4M18 14.4c2.2.7 3.5 2.6 3.5 5.6"/>'),
    shield: svg('<path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
    school: svg('<path d="M3 21h18M5 21V9l7-5 7 5v12M10 21v-5h4v5"/>'),
    user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>'),
    H: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16.2 9.6"/>'),
    S: svg('<path d="M14 14.8V5a2 2 0 10-4 0v9.8a4 4 0 104 0z"/><path d="M12 9v7"/>'),
    I: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7.5L12 13.5l8.5-6"/>'),
    A: svg('<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>'),
    B: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/>'),
    xls: svg('<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M9.5 12.5l4 5M13.5 12.5l-4 5"/>')
  };
  var LBL = { H: 'Hadir', S: 'Sakit', I: 'Izin', A: 'Alpa', B: 'Belum diisi' };
  function lbl(k) { return '<span class="lbl"><i class="ic">' + ICON[k] + '</i>' + LBL[k] + '</span>'; }
  function legend() { return '<div class="legend">' + ['H', 'S', 'I', 'A', 'B'].map(function (k) { return '<span class="lg lg-' + k + '"><i class="ic">' + ICON[k] + '</i><b>' + (k === 'B' ? '–' : k) + '</b> ' + LBL[k] + (k === 'A' ? ' (tanpa keterangan)' : '') + '</span>'; }).join('') + '</div>'; }
  function kelasSelect(id, sel) { return '<select id="' + id + '">' + S.kelas.map(function (k) { return '<option value="' + k.id + '"' + (k.id === sel ? ' selected' : '') + '>Kelas ' + esc(k.nama) + '</option>'; }).join('') + '</select>'; }
  function kelasName(id) { var k = S.kelas.filter(function (x) { return x.id === id; })[0]; return k ? k.nama : '?'; }
  var noKelas = '<div class="panel empty">Akun Anda belum punya kelas. Minta admin untuk memberi akses kelas di menu Pengguna.</div>';

  function render(anim) {
    if (!S.me) return;
    var fn = { harian: vHarian, rekap: vRekap, siswa: vSiswa, pengguna: vPengguna, sekolah: vSekolah, akun: vAkun }[S.tab];
    var y = anim === true ? 0 : window.scrollY;
    view(shell(fn()));
    var main = $('#main');
    if (anim === true) { main.classList.add('enter'); Array.prototype.forEach.call(main.children, function (c, i) { c.style.setProperty('--d', Math.min(i, 8)); }); }
    window.scrollTo(0, y);
    afterRender();
  }
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function countTo(el, to, suffix) {
    suffix = suffix === undefined ? (el.dataset.suffix || '') : suffix;
    var from = parseFloat(el.textContent) || 0, dec = String(to).indexOf('.') >= 0 ? 1 : 0;
    if (el._raf) cancelAnimationFrame(el._raf);
    if (reduced || from === to) { el.textContent = (dec ? to.toFixed(1) : to) + suffix; return; }
    var t0 = performance.now(), dur = 650;
    (function step(t) {
      var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3), v = from + (to - from) * e;
      el.textContent = (dec ? v.toFixed(1) : Math.round(v)) + suffix;
      if (k < 1) el._raf = requestAnimationFrame(step); else el.textContent = (dec ? to.toFixed(1) : to) + suffix;
    })(t0);
  }
  function afterRender() {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (S.tab === 'harian') paintHarian();
        Array.prototype.forEach.call(document.querySelectorAll('b[data-to]:not([data-k])'), function (b) { countTo(b, parseFloat(b.dataset.to)); });
      });
    });
  }

  function loadTab() {
    var t = S.tab, p = Promise.resolve();
    if (['harian', 'rekap', 'siswa'].indexOf(t) >= 0 && S.kelasId) {
      if (t === 'harian') p = api('GET', '/api/attendance?kelas_id=' + S.kelasId + '&date=' + S.date).then(function (r) { S.rows = r.siswa; S.dirty = {}; });
      if (t === 'rekap') p = api('GET', '/api/rekap?kelas_id=' + S.kelasId + '&month=' + S.month).then(function (r) { S.rekap = r; });
      if (t === 'siswa') p = api('GET', '/api/students?kelas_id=' + S.kelasId).then(function (r) { S.siswa = r.siswa; });
    }
    if (t === 'pengguna') p = api('GET', '/api/users').then(function (r) { S.users = r.users; });
    p.then(function () { render(true); }, function (e) { render(); fail(e); });
  }
  function go(fn) { flush().then(function () { fn(); loadTab(); }); }

  /* ---------- Absensi harian ---------- */
  function vHarian() {
    if (!S.kelasId) return noKelas;
    var d = parseYmd(S.date), we = d.getDay() === 0 || d.getDay() === 6;
    var h = '<div class="toolbar"><div class="field"><label for="fDate">Tanggal</label><input type="date" id="fDate" value="' + S.date + '"></div>' +
      '<div class="field"><label for="fKelas">Kelas</label>' + kelasSelect('fKelas', S.kelasId) + '</div>' +
      '<div class="actions"><button class="btn" data-act="today">Hari ini</button><button class="btn primary" data-act="allH">Tandai semua hadir</button><button class="btn" data-act="clear">Kosongkan</button></div></div>';
    h += '<div><h2>' + esc(tglPanjang(S.date)) + '</h2><p class="muted" style="margin:2px 0 14px">Kelas ' + esc(kelasName(S.kelasId)) + ' · ' + S.rows.length + ' siswa</p></div>';
    if (we) h += '<div class="notice">Tanggal ini jatuh pada akhir pekan. Pastikan memang ada kegiatan belajar.</div>';
    h += '<div class="panel summary"><div class="ring" aria-label="Persentase hadir"><svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#19c389"/><stop offset="1" stop-color="#2fb8ff"/></linearGradient></defs><circle class="bg" cx="50" cy="50" r="44"/><circle class="fg" cx="50" cy="50" r="44"/></svg><div class="num"><span><span class="pct-n">0%</span><small>hadir</small></span></div></div>' +
      '<div><b id="fillTxt">0 dari ' + S.rows.length + ' siswa sudah diisi</b><div class="progress"><i></i></div><span class="muted" style="font-size:.85rem">Perubahan tersimpan otomatis.</span></div></div>';
    h += '<div class="counters">' + ['H', 'S', 'I', 'A', 'B'].map(function (k) { return '<div class="counter c-' + k + '">' + lbl(k) + '<b data-k="' + k + '">0</b></div>'; }).join('') + '</div>';
    if (!S.rows.length) return h + '<div class="panel empty">Belum ada siswa di kelas ini. Tambahkan lewat menu Data Siswa.</div>';
    h += legend() + '<div class="panel rows">';
    S.rows.forEach(function (r, i) {
      h += '<div class="row" data-sid="' + r.id + '" style="--i:' + Math.min(i, 24) + '"><span class="no">' + (i + 1) + '</span><div class="nm">' + esc(r.nama) + '<small>NISN/NIS ' + esc(r.nis || '-') + ' · ' + (r.jk === 'L' ? 'Laki-laki' : 'Perempuan') + '</small></div>' +
        '<div class="seg" role="group" aria-label="Status ' + esc(r.nama) + '">' + Object.keys(STATUS).map(function (k) { return '<button class="' + k + '" data-st="' + k + '" aria-pressed="' + (r.status === k) + '" title="' + STATUS[k] + '" aria-label="' + STATUS[k] + '"><i class="ic">' + ICON[k] + '</i><span>' + k + '</span></button>'; }).join('') + '</div>' +
        '<div class="notewrap"><input type="text" class="note" maxlength="200" placeholder="Keterangan (opsional)" value="' + esc(r.catatan) + '" aria-label="Keterangan ' + esc(r.nama) + '"></div></div>';
    });
    return h + '</div>';
  }
  // Memperbarui angka, cincin, bilah, dan tombol tanpa menggambar ulang halaman
  function paintHarian() {
    var c = { H: 0, S: 0, I: 0, A: 0, B: 0 }, n = S.rows.length, byId = {};
    S.rows.forEach(function (r) { byId[r.id] = r; if (r.status) c[r.status]++; else c.B++; });
    Array.prototype.forEach.call(document.querySelectorAll('.counter b[data-k]'), function (b) { countTo(b, c[b.dataset.k], ''); });
    var fg = $('.ring .fg'); if (fg) { var off = 277 * (1 - (n ? c.H / n : 0)); fg.style.strokeDashoffset = off; fg.style.setProperty('--off', off); }
    var pn = $('.ring .pct-n'); if (pn) pn.textContent = n ? Math.round(c.H / n * 100) + '%' : '–';
    var bar = $('.progress i'); if (bar) bar.style.width = (n ? (n - c.B) / n * 100 : 0) + '%';
    var ft = $('#fillTxt'); if (ft) ft.textContent = (n - c.B) + ' dari ' + n + ' siswa sudah diisi';
    Array.prototype.forEach.call(document.querySelectorAll('.row[data-sid]'), function (row) {
      var r = byId[row.dataset.sid]; if (!r) return;
      Array.prototype.forEach.call(row.querySelectorAll('.seg button'), function (b) { b.setAttribute('aria-pressed', String(r.status === b.dataset.st)); });
    });
  }
  function setSaving(t) { S.saving = t; var el = $('#saveState'); if (el) el.textContent = t; }
  function markDirty(sid) { S.dirty[sid] = true; setSaving('Menyimpan…'); clearTimeout(saveTimer); saveTimer = setTimeout(flush, 500); }
  function flush() {
    clearTimeout(saveTimer);
    var ids = Object.keys(S.dirty);
    if (!ids.length || S.tab !== 'harian') return Promise.resolve();
    var snap = S.dirty, entries = S.rows.filter(function (r) { return snap[r.id]; }).map(function (r) { return { student_id: r.id, status: r.status, catatan: r.status ? r.catatan : '' }; });
    S.dirty = {};
    return api('PUT', '/api/attendance', { kelas_id: S.kelasId, date: S.date, entries: entries }).then(function () {
      if (!Object.keys(S.dirty).length) setSaving('Tersimpan ' + new Date().toTimeString().slice(0, 5));
    }, function (e) {
      Object.keys(snap).forEach(function (k) { S.dirty[k] = true; });
      setSaving('Belum tersimpan. Mencoba lagi…'); clearTimeout(saveTimer); saveTimer = setTimeout(flush, 5000); fail(e);
    });
  }
  window.addEventListener('beforeunload', function (e) { if (Object.keys(S.dirty).length) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('online', function () { S.online = true; render(); flush(); });
  window.addEventListener('offline', function () { S.online = false; render(); });

  /* ---------- Rekap ---------- */
  function vRekap() {
    if (!S.kelasId) return noKelas;
    var r = S.rekap, p = S.month.split('-');
    var h = '<div class="toolbar"><div class="field"><label for="fMonth">Bulan</label><input type="month" id="fMonth" value="' + S.month + '"></div>' +
      '<div class="field"><label for="fKelas">Kelas</label>' + kelasSelect('fKelas', S.kelasId) + '</div>' +
      '<div class="actions"><a class="btn primary" href="/api/rekap.xlsx?kelas_id=' + S.kelasId + '&amp;month=' + S.month + '" download><i class="ic">' + ICON.xls + '</i>Unduh Excel</a></div></div>';
    h += '<h2>Rekap ' + BULAN[+p[1] - 1] + ' ' + p[0] + ' · Kelas ' + esc(kelasName(S.kelasId)) + '</h2><p class="muted" style="margin:2px 0 14px">Persentase kehadiran dihitung dari hari yang sudah diisi. Kolom abu-abu adalah Sabtu dan Minggu.</p>';
    if (!r || !r.siswa.length) return h + '<div class="panel empty">Belum ada siswa di kelas ini.</div>';
    var tot = { H: 0, S: 0, I: 0, A: 0 };
    r.siswa.forEach(function (s) { for (var k in tot) tot[k] += s[k]; });
    var all = tot.H + tot.S + tot.I + tot.A;
    h += '<div class="counters">' + ['H', 'S', 'I', 'A'].map(function (x) { return '<div class="counter c-' + x + '">' + lbl(x) + '<b data-to="' + tot[x] + '">0</b></div>'; }).join('') + '<div class="counter c-B"><span class="lbl"><i class="ic">' + ICON.H + '</i>Kehadiran</span>' + (all ? '<b data-to="' + (Math.round(tot.H / all * 1000) / 10) + '" data-suffix="%">0%</b>' : '<b>–</b>') + '</div></div>';
    h += legend() + '<div class="scroll"><table><thead><tr><th class="name">Nama</th>';
    for (var d = 1; d <= r.jumlah_hari; d++) { var wd = new Date(+p[0], +p[1] - 1, d).getDay(); h += '<th class="' + (wd === 0 || wd === 6 ? 'we' : '') + '">' + d + '</th>'; }
    h += '<th>H</th><th>S</th><th>I</th><th>A</th><th>%</th></tr></thead><tbody>';
    r.siswa.forEach(function (s, si) {
      h += '<tr style="--i:' + Math.min(si, 24) + '"><td class="name">' + esc(s.nama) + '</td>';
      for (var d2 = 1; d2 <= r.jumlah_hari; d2++) { var w = new Date(+p[0], +p[1] - 1, d2).getDay(), c = s.days[d2] || ''; h += '<td class="' + (w === 0 || w === 6 ? 'we ' : '') + (c ? 's-' + c : '') + '">' + c + '</td>'; }
      h += '<td class="s-H">' + s.H + '</td><td class="s-S">' + s.S + '</td><td class="s-I">' + s.I + '</td><td class="s-A">' + s.A + '</td><td class="pct">' + (s.persen === null ? '–' : '<span class="pbar"><i style="width:' + s.persen + '%"></i></span>' + s.persen + '%') + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  /* ---------- Siswa + import ---------- */
  function parseDelimited(text) {
    text = text.replace(/^﻿/, '');
    var first = text.split(/\r?\n/)[0] || '';
    var delim = [',', ';', '\t'].sort(function (a, b) { return first.split(b).length - first.split(a).length; })[0];
    var rows = [], row = [], cur = '', q = false, i, c;
    for (i = 0; i < text.length; i++) {
      c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  function rowsFromTable(arr) {
    var n = function (v) { return String(v == null ? '' : v).trim(); };
    arr = arr.filter(function (r) { return r.some(function (c) { return n(c); }); });
    if (!arr.length) return [];
    var idx = { nama: -1, nis: -1, kelas: -1, jk: -1 };
    arr[0].forEach(function (c, i) {
      var h = n(c).toLowerCase();
      if (/^nama/.test(h) && idx.nama < 0) idx.nama = i; else if (/^nis/.test(h) || h === 'no induk') idx.nis = i;
      else if (/^kelas/.test(h)) idx.kelas = i; else if (/^(jk|l\/p|jenis|gender|sex)/.test(h)) idx.jk = i;
    });
    if (idx.nama >= 0) arr = arr.slice(1); else idx = { nama: 0, nis: 1, kelas: 2, jk: 3 };
    return arr.map(function (r) { return { nama: n(r[idx.nama]), nis: idx.nis >= 0 ? n(r[idx.nis]) : '', kelas: idx.kelas >= 0 ? n(r[idx.kelas]) : '', jk: idx.jk >= 0 ? n(r[idx.jk]) : '' }; });
  }

  function vSiswa() {
    if (!S.kelasId) return noKelas;
    var h = '<div class="toolbar"><div class="field"><label for="fKelas">Kelas</label>' + kelasSelect('fKelas', S.kelasId) + '</div></div>';
    h += '<div class="grid2"><section class="panel"><h3>Tambah siswa</h3><form data-form="addStudent" class="addform" style="margin-top:12px">' +
      '<div class="field" style="grid-column:1/-1"><label for="aNama">Nama lengkap</label><input type="text" id="aNama" maxlength="100" required autocomplete="off"></div>' +
      '<div class="field"><label for="aNis">NISN/NIS</label><input type="text" id="aNis" maxlength="30" inputmode="numeric" autocomplete="off"></div>' +
      '<div class="field"><label for="aJk">Jenis kelamin</label><select id="aJk"><option value="L">Laki-laki</option><option value="P">Perempuan</option></select></div>' +
      '<div><button class="btn primary" type="submit">Tambah ke kelas ' + esc(kelasName(S.kelasId)) + '</button></div></form></section>' + importPanel() + '</div>';
    if (S.impResult) {
      var ir = S.impResult;
      h += '<div class="notice info" style="margin-top:16px"><b>' + ir.added + ' siswa berhasil diimpor.</b>' + (ir.skipped.length ? ' ' + ir.skipped.length + ' baris dilewati: ' + ir.skipped.slice(0, 8).map(function (s) { return 'baris ' + s.baris + (s.nama ? ' (' + esc(s.nama) + ')' : '') + ' ' + esc(s.alasan.toLowerCase()); }).join('; ') + (ir.skipped.length > 8 ? '; dan lainnya.' : '.') : '') + '</div>';
    }
    h += '<h2 style="margin:22px 0 10px">Siswa kelas ' + esc(kelasName(S.kelasId)) + ' (' + S.siswa.length + ')</h2>';
    if (!S.siswa.length) return h + '<div class="panel empty">Belum ada siswa di kelas ini.</div>';
    h += '<div class="scroll"><table><thead><tr><th class="l">No</th><th class="l">Nama</th><th class="l">NISN/NIS</th><th>L/P</th><th>Kelas</th><th></th></tr></thead><tbody>';
    S.siswa.forEach(function (s, i) {
      if (S.editId === s.id) {
        h += '<tr data-sid="' + s.id + '"><td class="l">' + (i + 1) + '</td><td class="l"><input type="text" data-f="nama" value="' + esc(s.nama) + '" maxlength="100" aria-label="Nama"></td><td class="l"><input type="text" data-f="nis" aria-label="NISN/NIS" value="' + esc(s.nis) + '" maxlength="30" aria-label="NIS"></td>' +
          '<td><select data-f="jk" aria-label="Jenis kelamin"><option value="L"' + (s.jk === 'L' ? ' selected' : '') + '>L</option><option value="P"' + (s.jk === 'P' ? ' selected' : '') + '>P</option></select></td><td>' + kelasSelect('', s.kelas_id).replace('<select id=""', '<select data-f="kelas_id" aria-label="Kelas"') + '</td>' +
          '<td><button class="btn small primary" data-act="saveStudent">Simpan</button> <button class="btn small" data-act="cancelEdit">Batal</button></td></tr>';
      } else {
        h += '<tr data-sid="' + s.id + '"><td class="l">' + (i + 1) + '</td><td class="l">' + esc(s.nama) + '</td><td class="l">' + esc(s.nis || '-') + '</td><td>' + s.jk + '</td><td>' + esc(kelasName(s.kelas_id)) + '</td><td><button class="btn small" data-act="editStudent">Ubah</button> <button class="btn small danger" data-act="delStudent">Hapus</button></td></tr>';
      }
    });
    return h + '</tbody></table></div>';
  }
  function importPanel() {
    var im = S.imp, h = '<section class="panel"><h3>Import dari Excel</h3><p class="muted" style="margin:6px 0 12px">Unduh template, isi data siswa, lalu unggah kembali. Kolom: <b>Nama</b>, <b>NISN/NIS</b>, <b>Kelas</b> (boleh kosong), dan <b>JK</b> (L/P). Format <b>.xls</b> dan <b>.xlsx</b> bisa dibaca, CSV juga. Siswa yang NISN/NIS atau namanya sudah ada dilewati.</p>' +
      '<div class="dropzone"><p><b>Tarik file ke sini</b> atau pilih dari komputer</p><input type="file" id="impFile" accept=".xls,.xlsx,.csv,.tsv,.txt" aria-label="Pilih file Excel"></div>' +
      '<div class="actions" style="margin-top:12px"><a class="btn" href="/template-siswa.xls" download="template-siswa.xls">Unduh template (.xls)</a></div>';
    if (im) {
      h += '<p style="margin:16px 0 8px"><b>' + esc(im.name) + '</b>: ' + im.rows.length + ' baris terbaca. Baris tanpa kolom Kelas masuk ke kelas ' + esc(kelasName(S.kelasId)) + '.</p>' +
        '<div class="scroll" style="max-height:260px"><table><thead><tr><th class="l">Nama</th><th class="l">NISN/NIS</th><th>Kelas</th><th>JK</th></tr></thead><tbody>' +
        im.rows.slice(0, 50).map(function (r) { return '<tr><td class="l">' + esc(r.nama || '-') + '</td><td class="l">' + esc(r.nis || '-') + '</td><td>' + esc(r.kelas || '(bawaan)') + '</td><td>' + esc(r.jk || '-') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        (im.rows.length > 50 ? '<p class="muted">Menampilkan 50 baris pertama; semua baris tetap diimpor.</p>' : '') +
        '<div class="actions" style="margin-top:12px"><button class="btn primary" data-act="doImport">Impor ' + im.rows.length + ' baris</button><button class="btn" data-act="cancelImport">Batal</button></div>';
    }
    return h + '</section>';
  }
  function readImportFile(file) {
    if (file.size > 5e6) return toast('File terlalu besar (maksimal 5 MB).');
    var fr = new FileReader();
    fr.onerror = function () { toast('File tidak bisa dibaca.'); };
    fr.onload = function () {
      var buf = fr.result, a = new Uint8Array(buf), binary = (a[0] === 0xD0 && a[1] === 0xCF) || (a[0] === 0x50 && a[1] === 0x4B);
      var p = binary ? window.XLSReader.read(buf) : Promise.resolve(parseDelimited(new TextDecoder('utf-8').decode(buf)));
      p.then(function (table) {
        var rows = rowsFromTable(table);
        if (!rows.length) return toast('File kosong atau kolomnya tidak dikenali. Pakai template agar sesuai.');
        S.imp = { name: file.name, rows: rows }; S.impResult = null; render();
      }, function (e) { toast(e.message || 'File tidak bisa dibaca.'); });
    };
    fr.readAsArrayBuffer(file);
  }

  /* ---------- Pengguna (admin) ---------- */
  function kelasChecks(selected) { return '<div class="checks">' + S.kelas.map(function (k) { return '<label><input type="checkbox" value="' + k.id + '"' + (selected.indexOf(k.id) >= 0 ? ' checked' : '') + '> Kelas ' + esc(k.nama) + '</label>'; }).join('') + '</div>'; }
  function vPengguna() {
    var h = '<section class="panel"><h3>Tambah pengguna</h3><form data-form="addUser" class="addform" style="margin-top:12px">' +
      '<div class="field"><label for="uNama">Nama lengkap</label><input type="text" id="uNama" required maxlength="80"></div>' +
      '<div class="field"><label for="uUser">Nama pengguna</label><input type="text" id="uUser" required maxlength="40" autocapitalize="none" autocomplete="off"></div>' +
      '<div class="field"><label for="uPass">Kata sandi awal</label><input type="text" id="uPass" required minlength="8" autocomplete="off"></div>' +
      '<div class="field"><label for="uRole">Peran</label><select id="uRole"><option value="guru">Guru</option><option value="admin">Admin</option></select></div>' +
      '<div class="field" style="grid-column:1/-1"><label>Kelas yang boleh diakses (untuk guru)</label><div id="uKelas">' + kelasChecks([]) + '</div></div>' +
      '<div><button class="btn primary" type="submit">Tambah pengguna</button></div></form></section>';
    h += '<h2 style="margin:22px 0 6px">Daftar pengguna</h2><section class="panel">';
    (S.users || []).forEach(function (u) {
      var self = u.id === S.me.id;
      h += '<div class="userrow" data-uid="' + u.id + '"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>' + esc(u.nama) + '</b><span class="muted">@' + esc(u.username) + '</span><span class="badge' + (u.aktif ? '' : ' off') + '">' + (u.aktif ? (u.role === 'admin' ? 'Admin' : 'Guru') : 'Nonaktif') + '</span>' + (self ? '<span class="muted">(Anda)</span>' : '') + '</div>' +
        '<div class="addform"><div class="field"><label>Nama lengkap</label><input type="text" data-f="nama" value="' + esc(u.nama) + '" maxlength="80"></div>' +
        '<div class="field"><label>Peran</label><select data-f="role"' + (self ? ' disabled' : '') + '><option value="guru"' + (u.role === 'guru' ? ' selected' : '') + '>Guru</option><option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>Admin</option></select></div>' +
        '<div class="field"><label>Kata sandi baru (kosongkan bila tidak diganti)</label><input type="text" data-f="password" autocomplete="off" minlength="8"></div></div>' +
        (u.role === 'guru' ? '<div class="field"><label>Kelas</label><div data-f="kelas">' + kelasChecks(u.kelas_ids) + '</div></div>' : '<p class="muted" style="margin:0">Admin otomatis bisa mengakses semua kelas.</p>') +
        '<div class="actions"><button class="btn small primary" data-act="saveUser">Simpan</button>' + (self ? '' : '<button class="btn small" data-act="toggleUser">' + (u.aktif ? 'Nonaktifkan' : 'Aktifkan') + '</button><button class="btn small danger" data-act="delUser">Hapus</button>') + '</div></div>';
    });
    return h + '</section>';
  }

  /* ---------- Sekolah (admin) & Akun ---------- */
  function vSekolah() {
    var h = '<div class="grid2"><section class="panel"><h3>Identitas sekolah</h3><form data-form="school" class="addform" style="margin-top:12px;grid-template-columns:1fr">' +
      '<div class="field"><label for="shNama">Nama sekolah</label><input type="text" id="shNama" value="' + esc(S.school.nama) + '" maxlength="100" required></div>' +
      '<div class="field"><label for="shTahun">Tahun ajaran</label><input type="text" id="shTahun" value="' + esc(S.school.tahun) + '" maxlength="20"></div>' +
      '<div><button class="btn primary" type="submit">Simpan</button></div></form></section>' +
      '<section class="panel"><h3>Daftar kelas</h3><p class="muted" style="margin:6px 0 10px">Contoh nama kelas: 1, 2A, 3B. Kelas yang masih berisi siswa tidak bisa dihapus.</p><div class="rows">' +
      S.kelas.map(function (k) { return '<div class="row" style="grid-template-columns:1fr auto" data-kid="' + k.id + '"><span>Kelas ' + esc(k.nama) + '</span><button class="btn small danger" data-act="delKelas">Hapus</button></div>'; }).join('') +
      '</div><form data-form="addKelas" class="actions" style="margin-top:12px"><input type="text" id="kNama" placeholder="Nama kelas baru" maxlength="20" required aria-label="Nama kelas baru"><button class="btn primary" type="submit">Tambah kelas</button></form></section></div>';
    return h;
  }
  function vAkun() {
    return '<div class="grid2"><section class="panel"><h3>Ganti kata sandi</h3><form data-form="password" class="addform" style="margin-top:12px;grid-template-columns:1fr">' +
      '<div class="field"><label for="pLama">Kata sandi lama</label><input type="password" id="pLama" autocomplete="current-password" required></div>' +
      '<div class="field"><label for="pBaru">Kata sandi baru (minimal 8 karakter)</label><input type="password" id="pBaru" autocomplete="new-password" minlength="8" required></div>' +
      '<div><button class="btn primary" type="submit">Ganti kata sandi</button></div></form></section>' +
      '<section class="panel"><h3>Akun</h3><p style="margin:8px 0 0">' + esc(S.me.nama) + '<br><span class="muted">@' + esc(S.me.username) + ' · ' + (S.me.role === 'admin' ? 'Admin' : 'Guru') + '</span></p></section></div>';
  }

  /* ---------- events ---------- */
  var armed = null;
  function confirmClick(btn, label) { if (armed === btn) { armed = null; return true; } armed = btn; btn.dataset.orig = btn.textContent; btn.textContent = label; setTimeout(function () { if (armed === btn) { armed = null; btn.textContent = btn.dataset.orig; } }, 4000); return false; }
  function checked(box) { return Array.prototype.map.call(box.querySelectorAll('input:checked'), function (i) { return Number(i.value); }); }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('nav.tabs button');
    if (t) { var next = t.dataset.tab; return flush().then(function () { S.tab = next; S.impResult = null; S.editId = null; loadTab(); }); }
    var st = e.target.closest('.seg button');
    if (st) {
      var row = st.closest('.row'), r = S.rows.filter(function (x) { return String(x.id) === row.dataset.sid; })[0], v = st.dataset.st;
      r.status = r.status === v ? '' : v; markDirty(r.id); paintHarian();
      if (r.status) { st.classList.add('pop'); st.addEventListener('animationend', function () { st.classList.remove('pop'); }, { once: true }); }
      return;
    }
    var b = e.target.closest('[data-act]'); if (!b) return;
    var a = b.dataset.act, tr = b.closest('tr'), card = b.closest('[data-uid]');
    if (a === 'logout') { return flush().then(function () { return api('POST', '/api/logout'); }).then(function () { S.me = null; boot(); }, fail); }
    if (a === 'today') return go(function () { S.date = today; });
    if (a === 'allH') { S.rows.forEach(function (r) { if (!r.status) { r.status = 'H'; S.dirty[r.id] = true; } }); markDirty(0); delete S.dirty[0]; return paintHarian(); }
    if (a === 'clear') { if (!confirmClick(b, 'Yakin kosongkan?')) return; S.rows.forEach(function (r) { r.status = ''; r.catatan = ''; S.dirty[r.id] = true; }); markDirty(0); delete S.dirty[0]; Array.prototype.forEach.call(document.querySelectorAll('input.note'), function (i) { i.value = ''; }); return paintHarian(); }
    if (a === 'editStudent') { S.editId = Number(tr.dataset.sid); return render(); }
    if (a === 'cancelEdit') { S.editId = null; return render(); }
    if (a === 'saveStudent') {
      var f = function (n) { return tr.querySelector('[data-f="' + n + '"]').value; };
      return api('PATCH', '/api/students/' + tr.dataset.sid, { nama: f('nama'), nis: f('nis'), jk: f('jk'), kelas_id: Number(f('kelas_id')) }).then(function () { S.editId = null; toast('Data siswa disimpan'); loadTab(); }, fail);
    }
    if (a === 'delStudent') { if (!confirmClick(b, 'Yakin hapus?')) return; return api('DELETE', '/api/students/' + tr.dataset.sid).then(function () { toast('Siswa dihapus beserta riwayat absensinya'); loadTab(); }, fail); }
    if (a === 'cancelImport') { S.imp = null; return render(); }
    if (a === 'doImport') {
      b.disabled = true;
      return api('POST', '/api/students/import', { kelas_id: S.kelasId, rows: S.imp.rows }).then(function (r) { S.imp = null; S.impResult = r; loadTab(); }, function (er) { b.disabled = false; fail(er); });
    }
    if (a === 'saveUser') {
      var q = function (n) { var el = card.querySelector('[data-f="' + n + '"]'); return el; };
      var body = { nama: q('nama').value, role: q('role').value };
      if (q('password').value) body.password = q('password').value;
      if (q('kelas')) body.kelas_ids = checked(q('kelas'));
      return api('PATCH', '/api/users/' + card.dataset.uid, body).then(function () { toast('Pengguna disimpan'); loadTab(); }, fail);
    }
    if (a === 'toggleUser') {
      var u = S.users.filter(function (x) { return String(x.id) === card.dataset.uid; })[0];
      return api('PATCH', '/api/users/' + u.id, { aktif: !u.aktif }).then(function () { loadTab(); }, fail);
    }
    if (a === 'delUser') { if (!confirmClick(b, 'Yakin hapus?')) return; return api('DELETE', '/api/users/' + card.dataset.uid).then(function () { toast('Pengguna dihapus'); loadTab(); }, fail); }
    if (a === 'delKelas') {
      if (!confirmClick(b, 'Yakin hapus?')) return;
      return api('DELETE', '/api/kelas/' + b.closest('[data-kid]').dataset.kid).then(function () { toast('Kelas dihapus'); return refreshMe(); }, fail);
    }
  });

  function refreshMe() { return api('GET', '/api/me').then(function (r) { S.school = r.school; S.kelas = r.kelas; if (!S.kelas.some(function (k) { return k.id === S.kelasId; })) S.kelasId = S.kelas.length ? S.kelas[0].id : null; loadTab(); }, fail); }

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'fDate' && t.value) go(function () { S.date = t.value; });
    else if (t.id === 'fMonth' && t.value) go(function () { S.month = t.value; });
    else if (t.id === 'fKelas') go(function () { S.kelasId = Number(t.value); S.impResult = null; S.imp = null; });
    else if (t.id === 'impFile' && t.files && t.files[0]) readImportFile(t.files[0]);
  });

  ['dragover', 'dragleave', 'drop'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      var z = e.target.closest && e.target.closest('.dropzone'); if (!z) return;
      e.preventDefault(); z.classList.toggle('over', ev === 'dragover');
      if (ev === 'drop' && e.dataTransfer.files[0]) readImportFile(e.dataTransfer.files[0]);
    });
  });

  document.addEventListener('input', function (e) {
    var el = e.target; if (!el.classList.contains('note')) return;
    var sid = el.closest('.row').dataset.sid, r = S.rows.filter(function (x) { return String(x.id) === sid; })[0];
    r.catatan = el.value; clearTimeout(noteTimers[sid]);
    noteTimers[sid] = setTimeout(function () { if (r.status) markDirty(r.id); }, 600);
  });

  document.addEventListener('submit', function (e) {
    var form = e.target.closest('form[data-form]'); if (!form) return;
    e.preventDefault();
    var n = form.dataset.form, val = function (id) { return $('#' + id).value; };
    var btn = form.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
    var done = function () { if (btn) btn.disabled = false; };
    if (n === 'login') return api('POST', '/api/login', { username: val('lu'), password: val('lp') }).then(boot, function (er) { view(loginView(er.message)); });
    if (n === 'setup') return api('POST', '/api/setup', { sekolah: val('ss'), tahun: val('st'), nama: val('sn'), username: val('su'), password: val('sp') })
      .then(function () { return api('POST', '/api/login', { username: val('su'), password: val('sp') }); }).then(boot, function (er) { view(setupView(er.message)); });
    if (n === 'addStudent') return api('POST', '/api/students', { kelas_id: S.kelasId, nama: val('aNama'), nis: val('aNis'), jk: val('aJk') }).then(function () { toast('Siswa ditambahkan'); loadTab(); setTimeout(function () { var i = $('#aNama'); if (i) i.focus(); }, 50); }, function (er) { done(); fail(er); });
    if (n === 'addUser') return api('POST', '/api/users', { nama: val('uNama'), username: val('uUser'), password: val('uPass'), role: val('uRole'), kelas_ids: checked($('#uKelas')) }).then(function () { toast('Pengguna ditambahkan'); loadTab(); }, function (er) { done(); fail(er); });
    if (n === 'school') return api('PUT', '/api/school', { nama: val('shNama'), tahun: val('shTahun') }).then(function () { toast('Tersimpan'); return refreshMe(); }, function (er) { done(); fail(er); });
    if (n === 'addKelas') return api('POST', '/api/kelas', { nama: val('kNama') }).then(function () { toast('Kelas ditambahkan'); return refreshMe(); }, function (er) { done(); fail(er); });
    if (n === 'password') return api('POST', '/api/me/password', { lama: val('pLama'), baru: val('pBaru') }).then(function () { toast('Kata sandi diganti'); form.reset(); done(); }, function (er) { done(); fail(er); });
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(function () {});
  boot();
})();
