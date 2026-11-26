'use strict';
/* Penulis berkas Excel (.xlsx) tanpa library: paket ZIP berisi XML. Dipakai untuk unduhan rekap bulanan. */
const zlib = require('node:zlib');

const xmlEsc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colName = (i) => { let n = i + 1, s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

function zip(files) {
  const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const locals = [], central = []; let offset = 0;
  for (const [name, text] of files) {
    const nameB = Buffer.from(name, 'utf8'), raw = Buffer.from(text, 'utf8'), comp = zlib.deflateRawSync(raw), crc = zlib.crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nameB.length, 26);
    locals.push(lh, nameB, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, nameB);
    offset += lh.length + nameB.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/* Gaya sel (indeks cellXfs) */
const ST = { def: 0, title: 1, sub: 2, head: 3, headWe: 4, name: 5, cell: 6, H: 7, S: 8, I: 9, A: 10, we: 11, num: 12, pct: 13, text: 14, note: 15, total: 16 };

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0&quot;%&quot;"/></numFmts>
<fonts count="9">
<font><sz val="11"/><color rgb="FF17324D"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="15"/><color rgb="FF17324D"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF0F9F6E"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFC27A00"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF6B46E0"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFD6365B"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF17324D"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="10"/><color rgb="FF5F7A93"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="9">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF4F8DF7"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD5DEE8"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD9F8EA"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF1C9"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFECE5FF"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFE1E8"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEDF3FA"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFC9D8E6"/></left><right style="thin"><color rgb="FFC9D8E6"/></right><top style="thin"><color rgb="FFC9D8E6"/></top><bottom style="thin"><color rgb="FFC9D8E6"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="17">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="8" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="7" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="7" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="6" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="7" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="8" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="1" fontId="7" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/* rows: array of arrays dengan sel { v, s } (v: teks, angka, atau null untuk sel kosong bergaya). */
function sheetXml(rows, { cols, merges, freeze, rowHeights }) {
  let maxC = 0; rows.forEach((r) => { if (r.length > maxC) maxC = r.length; });
  const cx = (cols || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const out = rows.map((r, ri) => {
    const h = rowHeights && rowHeights[ri] ? ` ht="${rowHeights[ri]}" customHeight="1"` : '';
    const cells = r.map((c, ci) => {
      if (!c) return '';
      const ref = colName(ci) + (ri + 1), s = c.s ? ` s="${c.s}"` : '';
      if (c.v === null || c.v === undefined || c.v === '') return `<c r="${ref}"${s}/>`;
      if (typeof c.v === 'number') return `<c r="${ref}"${s}><v>${c.v}</v></c>`;
      return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(c.v)}</t></is></c>`;
    }).join('');
    return `<row r="${ri + 1}"${h}>${cells}</row>`;
  }).join('');
  const pane = freeze ? `<sheetViews><sheetView workbookViewId="0"><pane xSplit="${freeze.x}" ySplit="${freeze.y}" topLeftCell="${colName(freeze.x)}${freeze.y + 1}" activePane="bottomRight" state="frozen"/><selection pane="topRight"/><selection pane="bottomLeft"/><selection pane="bottomRight" activeCell="${colName(freeze.x)}${freeze.y + 1}" sqref="${colName(freeze.x)}${freeze.y + 1}"/></sheetView></sheetViews>` : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const mg = merges && merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${colName(Math.max(maxC - 1, 0))}${rows.length}"/>${pane}<sheetFormatPr defaultRowHeight="18"/>${cx ? `<cols>${cx}</cols>` : ''}<sheetData>${out}</sheetData>${mg}<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToHeight="0"/></worksheet>`;
}

function workbook(sheetName, rows, opts) {
  const name = xmlEsc(String(sheetName).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Rekap');
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', STYLES],
    ['xl/worksheets/sheet1.xml', sheetXml(rows, opts)],
  ]);
}

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

/* Susun lembar rekap bulanan dari hasil buildRekap */
function rekapWorkbook(rekap, sekolah) {
  const [y, m] = rekap.month.split('-').map(Number), n = rekap.jumlah_hari, total = 3 + n + 5;
  const isWeekend = (d) => { const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return w === 0 || w === 6; };
  const T = (v, s) => ({ v, s });
  const rows = [];
  rows.push([T(`Rekap Absensi Kelas ${rekap.kelas.nama} · ${BULAN[m - 1]} ${y}`, ST.title)]);
  rows.push([T(`${sekolah.nama}${sekolah.tahun ? ' · Tahun ajaran ' + sekolah.tahun : ''}`, ST.sub)]);
  rows.push([]);
  const head = [T('No', ST.head), T('Nama', ST.head), T('NISN/NIS', ST.head)];
  for (let d = 1; d <= n; d++) head.push(T(d, isWeekend(d) ? ST.headWe : ST.head));
  ['Hadir', 'Sakit', 'Izin', 'Alpa', '% Hadir'].forEach((t) => head.push(T(t, ST.head)));
  rows.push(head);
  const sum = { H: 0, S: 0, I: 0, A: 0 };
  rekap.siswa.forEach((s, i) => {
    const r = [T(i + 1, ST.num), T(s.nama, ST.name), T(s.nis || '', ST.text)];
    for (let d = 1; d <= n; d++) { const c = s.days[d]; r.push(c ? T(c, ST[c]) : T(null, isWeekend(d) ? ST.we : ST.cell)); }
    r.push(T(s.H, ST.num), T(s.S, ST.num), T(s.I, ST.num), T(s.A, ST.num), s.persen === null ? T(null, ST.cell) : T(s.persen, ST.pct));
    ['H', 'S', 'I', 'A'].forEach((k) => { sum[k] += s[k]; });
    rows.push(r);
  });
  const all = sum.H + sum.S + sum.I + sum.A;
  const tr = [T(null, ST.total), T('Jumlah', ST.total), T(null, ST.total)]; for (let d = 0; d < n; d++) tr.push(T(null, ST.total));
  tr.push(T(sum.H, ST.total), T(sum.S, ST.total), T(sum.I, ST.total), T(sum.A, ST.total), all ? T(Math.round(sum.H / all * 1000) / 10, ST.pct) : T(null, ST.total));
  rows.push(tr);
  rows.push([]);
  rows.push([T('Keterangan: H = Hadir, S = Sakit, I = Izin, A = Alpa. Kolom abu-abu adalah Sabtu dan Minggu. Persentase dihitung dari hari yang sudah diisi.', ST.note)]);
  const cols = [5, 30, 15]; for (let d = 0; d < n; d++) cols.push(4.2); cols.push(8, 8, 8, 8, 10);
  const lastCol = colName(total - 1);
  return workbook(`Kelas ${rekap.kelas.nama}`, rows, { cols, merges: [`A1:${lastCol}1`, `A2:${lastCol}2`, `A${rows.length}:${lastCol}${rows.length}`], freeze: { x: 3, y: 4 }, rowHeights: { 3: 26 } });
}

module.exports = { rekapWorkbook, workbook, zip };
