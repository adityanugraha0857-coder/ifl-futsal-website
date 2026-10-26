require('dotenv').config();

const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || (process.env.SESSION_SECRET.includes('ganti-dengan') || process.env.SESSION_SECRET.includes('ISI_DENGAN'))) {
  if (process.env.NODE_ENV === 'production') {
    console.error('SESSION_SECRET wajib berupa rahasia acak minimal 32 karakter di production.');
    process.exit(1);
  }
  console.warn('PERINGATAN: set SESSION_SECRET acak minimal 32 karakter di file .env sebelum deploy.');
}

const db = new Database(path.join(DATA_DIR, 'ifl-events.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Turnamen',
    location TEXT NOT NULL DEFAULT 'Pontianak',
    start_date TEXT NOT NULL,
    end_date TEXT,
    status TEXT NOT NULL DEFAULT 'Akan Datang',
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER,
    match_date TEXT NOT NULL,
    match_time TEXT NOT NULL DEFAULT '',
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    home_score INTEGER,
    away_score INTEGER,
    venue TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Terjadwal',
    round_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const seedSettings = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)');
[
  ['contact_name', 'Panitia IFL Event'],
  ['contact_phone', 'Isi nomor WhatsApp panitia melalui panel admin'],
  ['contact_email', ''],
  ['venue', 'Pontianak, Kalimantan Barat'],
  ['about', 'IFL Event menghadirkan kompetisi futsal, kegiatan komunitas, expo, dan seminar. Bersama Fafage Academy Pontianak, kami mendukung perkembangan talenta futsal dan semangat sportivitas.']
].forEach(row => seedSettings.run(...row));

const adminCount = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
if (adminCount === 0) {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (username && password && password.length >= 12) {
    db.prepare('INSERT INTO admins(username,password_hash) VALUES (?,?)')
      .run(username, bcrypt.hashSync(password, 12));
    console.log(`Akun admin awal dibuat untuk username "${username}". Ganti password setelah login pertama.`);
  } else {
    console.warn('Belum ada admin. Jalankan: npm run init-admin');
  }
}

app.disable('x-powered-by');
// Hosting Node.js umumnya berada di belakang reverse proxy. Aktifkan hanya saat production.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: null
    }
  }
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));

const SQLiteStore = SQLiteStoreFactory(session);
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: DATA_DIR, table: 'sessions' }),
  secret: process.env.SESSION_SECRET || 'development-only-secret-not-for-production-123456',
  resave: false,
  saveUninitialized: false,
  name: 'ifl.sid',
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 4
  }
}));

// Cegah permintaan perubahan data lintas situs. Pada production, permintaan mutasi browser
// harus membawa Origin yang persis sama dengan host aplikasi.
function requireSameOriginForWrites(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (process.env.NODE_ENV !== 'production' && !req.get('origin')) return next();
  const origin = req.get('origin');
  if (!origin) return res.status(403).json({ error: 'Permintaan ditolak: Origin tidak ada.' });
  try {
    const parsed = new URL(origin);
    const expectedProtocol = req.secure ? 'https:' : 'http:';
    if (parsed.origin !== `${expectedProtocol}//${req.get('host')}`) {
      return res.status(403).json({ error: 'Permintaan ditolak: Origin tidak sesuai.' });
    }
  } catch { return res.status(403).json({ error: 'Header Origin tidak valid.' }); }
  next();
}
app.use('/api', requireSameOriginForWrites);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' }
});

function requireAdmin(req, res, next) {
  if (!req.session.adminId) return res.status(401).json({ error: 'Sesi admin berakhir. Silakan login kembali.' });
  next();
}
function cleanText(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}
function apiError(res, message, code = 400) {
  return res.status(code).json({ error: message });
}

app.get('/api/public', (req, res) => {
  const events = db.prepare(`SELECT * FROM events ORDER BY start_date ASC, id DESC`).all();
  const matches = db.prepare(`
    SELECT m.*, e.title AS event_title FROM matches m
    LEFT JOIN events e ON e.id=m.event_id
    ORDER BY m.match_date ASC, m.match_time ASC, m.id DESC
  `).all();
  const settings = Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(x => [x.key, x.value]));
  res.json({ events, matches, settings });
});

app.post('/api/login', loginLimiter, (req, res, next) => {
  const username = cleanText(req.body.username, 80);
  const password = String(req.body.password ?? '');
  const admin = db.prepare('SELECT * FROM admins WHERE username=?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return apiError(res, 'Username atau password salah.', 401);
  }
  req.session.regenerate(err => {
    if (err) return next(err);
    req.session.adminId = admin.id;
    req.session.username = admin.username;
    req.session.save(err2 => {
      if (err2) return next(err2);
      res.json({ ok: true, username: admin.username });
    });
  });
});
app.get('/api/session', (req, res) => {
  res.json({ authenticated: Boolean(req.session.adminId), username: req.session.username || '' });
});
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('ifl.sid', { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' });
    res.json({ ok: true });
  });
});

app.get('/api/admin/data', requireAdmin, (req, res) => {
  const events = db.prepare('SELECT * FROM events ORDER BY start_date DESC, id DESC').all();
  const matches = db.prepare(`SELECT m.*, e.title AS event_title FROM matches m LEFT JOIN events e ON e.id=m.event_id ORDER BY m.match_date DESC,m.match_time DESC,m.id DESC`).all();
  const settings = Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(x => [x.key, x.value]));
  res.json({ events, matches, settings, username: req.session.username });
});

app.post('/api/admin/events', requireAdmin, (req, res) => {
  const b = req.body || {};
  const title = cleanText(b.title, 120);
  const category = cleanText(b.category || 'Turnamen', 60);
  const location = cleanText(b.location || 'Pontianak', 160);
  const startDate = cleanText(b.start_date, 10);
  const endDate = b.end_date ? cleanText(b.end_date, 10) : null;
  const status = cleanText(b.status || 'Akan Datang', 40);
  const description = cleanText(b.description, 2000);
  if (!title || !validDate(startDate)) return apiError(res, 'Nama event dan tanggal mulai wajib diisi dengan benar.');
  if (endDate && (!validDate(endDate) || endDate < startDate)) return apiError(res, 'Tanggal selesai tidak valid.');
  const info = db.prepare(`INSERT INTO events(title,category,location,start_date,end_date,status,description) VALUES(?,?,?,?,?,?,?)`)
    .run(title, category, location, startDate, endDate, status, description);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});
app.put('/api/admin/events/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const title = cleanText(b.title, 120);
  const startDate = cleanText(b.start_date, 10);
  const endDate = b.end_date ? cleanText(b.end_date, 10) : null;
  if (!Number.isInteger(id) || id < 1 || !title || !validDate(startDate)) return apiError(res, 'Data event tidak valid.');
  if (endDate && (!validDate(endDate) || endDate < startDate)) return apiError(res, 'Tanggal selesai tidak valid.');
  const info = db.prepare(`UPDATE events SET title=?,category=?,location=?,start_date=?,end_date=?,status=?,description=? WHERE id=?`)
    .run(title, cleanText(b.category || 'Turnamen',60), cleanText(b.location || 'Pontianak',160), startDate, endDate, cleanText(b.status || 'Akan Datang',40), cleanText(b.description,2000), id);
  if (!info.changes) return apiError(res, 'Event tidak ditemukan.', 404);
  res.json({ ok: true });
});
app.delete('/api/admin/events/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return apiError(res, 'ID tidak valid.');
  const info = db.prepare('DELETE FROM events WHERE id=?').run(id);
  if (!info.changes) return apiError(res, 'Event tidak ditemukan.', 404);
  res.json({ ok: true });
});

app.post('/api/admin/matches', requireAdmin, (req, res) => {
  const b = req.body || {};
  const matchDate = cleanText(b.match_date, 10);
  const home = cleanText(b.home_team, 100);
  const away = cleanText(b.away_team, 100);
  const homeScore = b.home_score === '' || b.home_score == null ? null : Number(b.home_score);
  const awayScore = b.away_score === '' || b.away_score == null ? null : Number(b.away_score);
  if (!validDate(matchDate) || !home || !away || home === away) return apiError(res, 'Tanggal dan dua nama tim wajib diisi. Nama tim harus berbeda.');
  if ((homeScore !== null && (!Number.isInteger(homeScore) || homeScore < 0 || homeScore > 99)) ||
      (awayScore !== null && (!Number.isInteger(awayScore) || awayScore < 0 || awayScore > 99))) return apiError(res, 'Skor harus berupa angka 0–99.');
  const eventId = b.event_id ? Number(b.event_id) : null;
  if (eventId && !db.prepare('SELECT id FROM events WHERE id=?').get(eventId)) return apiError(res, 'Event yang dipilih tidak ditemukan.');
  const status = cleanText(b.status || (homeScore !== null && awayScore !== null ? 'Selesai' : 'Terjadwal'), 30);
  const info = db.prepare(`INSERT INTO matches(event_id,match_date,match_time,home_team,away_team,home_score,away_score,venue,status,round_name)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(eventId, matchDate, cleanText(b.match_time,5), home, away, homeScore, awayScore, cleanText(b.venue,160), status, cleanText(b.round_name,100));
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});
app.put('/api/admin/matches/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const matchDate = cleanText(b.match_date, 10);
  const home = cleanText(b.home_team, 100);
  const away = cleanText(b.away_team, 100);
  const homeScore = b.home_score === '' || b.home_score == null ? null : Number(b.home_score);
  const awayScore = b.away_score === '' || b.away_score == null ? null : Number(b.away_score);
  if (!Number.isInteger(id) || id < 1 || !validDate(matchDate) || !home || !away || home === away) return apiError(res, 'Data pertandingan tidak valid.');
  if ((homeScore !== null && (!Number.isInteger(homeScore) || homeScore < 0 || homeScore > 99)) ||
      (awayScore !== null && (!Number.isInteger(awayScore) || awayScore < 0 || awayScore > 99))) return apiError(res, 'Skor harus berupa angka 0–99.');
  const eventId = b.event_id ? Number(b.event_id) : null;
  if (eventId && !db.prepare('SELECT id FROM events WHERE id=?').get(eventId)) return apiError(res, 'Event yang dipilih tidak ditemukan.');
  const info = db.prepare(`UPDATE matches SET event_id=?,match_date=?,match_time=?,home_team=?,away_team=?,home_score=?,away_score=?,venue=?,status=?,round_name=? WHERE id=?`)
    .run(eventId, matchDate, cleanText(b.match_time,5), home, away, homeScore, awayScore, cleanText(b.venue,160), cleanText(b.status || (homeScore !== null && awayScore !== null ? 'Selesai' : 'Terjadwal'),30), cleanText(b.round_name,100), id);
  if (!info.changes) return apiError(res, 'Pertandingan tidak ditemukan.', 404);
  res.json({ ok: true });
});
app.delete('/api/admin/matches/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return apiError(res, 'ID tidak valid.');
  const info = db.prepare('DELETE FROM matches WHERE id=?').run(id);
  if (!info.changes) return apiError(res, 'Pertandingan tidak ditemukan.', 404);
  res.json({ ok: true });
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const b = req.body || {};
  const allowed = ['contact_name','contact_phone','contact_email','venue','about'];
  const upsert = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const tx = db.transaction(() => {
    for (const key of allowed) if (Object.prototype.hasOwnProperty.call(b, key)) upsert.run(key, cleanText(b[key], key === 'about' ? 2000 : 250));
  });
  tx();
  res.json({ ok: true });
});
app.post('/api/admin/change-password', requireAdmin, (req, res) => {
  const current = String(req.body.current_password ?? '');
  const next = String(req.body.new_password ?? '');
  if (next.length < 12 || next.length > 200) return apiError(res, 'Password baru harus 12–200 karakter.');
  const admin = db.prepare('SELECT * FROM admins WHERE id=?').get(req.session.adminId);
  if (!admin || !bcrypt.compareSync(current, admin.password_hash)) return apiError(res, 'Password saat ini salah.', 401);
  db.prepare('UPDATE admins SET password_hash=? WHERE id=?').run(bcrypt.hashSync(next, 12), admin.id);
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Terjadi kesalahan server. Periksa log aplikasi.' });
});

app.listen(PORT, () => console.log(`IFL Event website aktif di http://localhost:${PORT}`));
