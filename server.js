'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { open } = require('./src/db');
const auth = require('./src/auth');
const { routes, HttpError } = require('./src/routes');

const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.xls': 'application/vnd.ms-excel',
  '.ico': 'image/x-icon'
};
const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

async function initAdminIfNeeded(db) {
  if (process.env.ADMIN_USER && process.env.ADMIN_PASSWORD) {
    const row = await db.prepare('SELECT COUNT(*) c FROM users').get();
    if (Number(row.c) === 0) {
      await db.prepare('INSERT INTO users (username, nama, role, password_hash) VALUES (?,?,?,?)').run(
        process.env.ADMIN_USER,
        process.env.ADMIN_NAME || 'Administrator',
        'admin',
        auth.hashPassword(process.env.ADMIN_PASSWORD)
      );
      for (const k of ['1', '2', '3', '4', '5', '6']) {
        await db.prepare('INSERT OR IGNORE INTO kelas (nama) VALUES (?)').run(k);
      }
      await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('school_nama', ?)").run(process.env.SCHOOL_NAME || 'Sekolah Dasar');
      console.log('Akun admin awal dibuat dari variabel lingkungan.');
    }
  }
}

function createServer({
  dbFile = process.env.DB_PATH || (process.env.VERCEL ? '/tmp/absensi.db' : path.join(__dirname, 'data', 'absensi.db')),
  trustProxy = process.env.TRUST_PROXY === '1' || Boolean(process.env.VERCEL)
} = {}) {
  const db = open(dbFile);
  const initPromise = (async () => {
    await db.ready;
    await initAdminIfNeeded(db);
    await auth.purgeExpired(db);
  })().catch((err) => console.error('Database init error:', err));

  const purge = setInterval(() => { auth.purgeExpired(db).catch(() => {}); }, 6 * 3600e3);
  purge.unref();

  function send(res, status, body, headers = {}) {
    res.writeHead(status, { ...HEADERS, ...headers });
    res.end(body);
  }
  const sendJson = (res, status, obj, extra) =>
    send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });

  function readBody(req, limit = 1.5e6) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) {
          reject(new HttpError(413, 'Data terlalu besar.'));
          req.destroy();
        } else {
          chunks.push(c);
        }
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
        } catch {
          reject(new HttpError(400, 'Format data tidak valid.'));
        }
      });
      req.on('error', reject);
    });
  }

  function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 404, 'Tidak ditemukan');
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, 'Tidak ditemukan', { 'Content-Type': 'text/plain; charset=utf-8' });
      const ext = path.extname(file);
      send(res, 200, req.method === 'HEAD' ? '' : data, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      await db.ready;
      await initPromise;

      const url = new URL(req.url, 'http://x');
      const pathname = url.pathname;
      if (pathname === '/healthz') return sendJson(res, 200, { ok: true });
      if (!pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Metode tidak didukung');
        return serveStatic(req, res, pathname);
      }
      const route = routes.map((r) => {
        const m = r.method === req.method && r.re.exec(pathname);
        return m && { r, params: m.groups || {} };
      }).find(Boolean);
      if (!route) return sendJson(res, 404, { error: 'Alamat API tidak ditemukan.' });

      const cookies = auth.parseCookies(req.headers.cookie);
      const proto = trustProxy ? String(req.headers['x-forwarded-proto'] || '').split(',')[0] : '';
      const ip = trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress : req.socket.remoteAddress;
      const setCookies = [];
      const ctx = {
        ip,
        token: cookies[auth.COOKIE],
        secure: proto === 'https' || process.env.COOKIE_SECURE === '1' || Boolean(process.env.VERCEL),
        setCookie: (c) => setCookies.push(c),
        raw: (body, type, filename) => ({ __raw: true, body, type, filename })
      };

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Permintaan ditolak.');
      }
      const user = await auth.userFromToken(db, ctx.token);
      if (route.r.authLevel && !user) throw new HttpError(401, 'Silakan masuk terlebih dahulu.');
      if (route.r.authLevel === 'admin' && user.role !== 'admin') throw new HttpError(403, 'Hanya admin yang boleh melakukan ini.');
      const body = req.method === 'GET' || req.method === 'HEAD' ? {} : await readBody(req);
      const query = Object.fromEntries(url.searchParams);
      const out = await route.r.handler({ db, user, body, query, params: route.params, ctx });
      const extra = setCookies.length ? { 'Set-Cookie': setCookies } : {};
      if (out && out.__raw) {
        return send(res, 200, out.body, {
          'Content-Type': out.type,
          'Content-Disposition': `attachment; filename="${out.filename}"`,
          'Cache-Control': 'no-store',
          ...extra
        });
      }
      return sendJson(res, 200, out, extra);
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
      if (e && /UNIQUE/.test(String(e.message))) return sendJson(res, 409, { error: 'Data sudah ada.' });
      console.error(e);
      return sendJson(res, 500, { error: 'Terjadi kesalahan di server.' });
    }
  });

  server.db = db;
  server.on('close', () => {
    clearInterval(purge);
    try { db.close(); } catch {}
  });
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const server = createServer();
  server.listen(port, '0.0.0.0', () => console.log(`Absensi SD berjalan di http://localhost:${port}`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
} else {
  const server = createServer();
  server.createServer = createServer;
  module.exports = server;
}
