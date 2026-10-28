require('dotenv').config();

const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const ExcelJS = require('exceljs');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const TEAM_LOGOS_DIR = path.join(DATA_DIR, 'team-logos');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(TEAM_LOGOS_DIR, { recursive: true });

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
    categories TEXT NOT NULL DEFAULT '[]',
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
    home_logo TEXT,
    away_logo TEXT,
    event_category TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS match_rosters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL,
    team_side TEXT NOT NULL CHECK(team_side IN ('home', 'away')),
    player_name TEXT NOT NULL,
    jersey_number INTEGER NOT NULL,
    position TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS match_officials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL,
    team_side TEXT NOT NULL CHECK(team_side IN ('home', 'away')),
    official_name TEXT NOT NULL,
    role TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);
const matchColumns = new Set(db.pragma('table_info(matches)').map(column => column.name));
for (const column of ['home_logo', 'away_logo']) {
  if (!matchColumns.has(column)) db.exec(`ALTER TABLE matches ADD COLUMN ${column} TEXT`);
}
if (!matchColumns.has('event_category')) db.exec("ALTER TABLE matches ADD COLUMN event_category TEXT NOT NULL DEFAULT ''");
const eventColumns = new Set(db.pragma('table_info(events)').map(column => column.name));
if (!eventColumns.has('categories')) db.exec("ALTER TABLE events ADD COLUMN categories TEXT NOT NULL DEFAULT '[]'");

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
      imgSrc: ["'self'", 'data:', 'blob:'],
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
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function apiError(res, message, code = 400) {
  return res.status(code).json({ error: message });
}

function parseCategories(value) {
  try {
    const categories = JSON.parse(value || '[]');
    return Array.isArray(categories) ? categories.filter(category => typeof category === 'string') : [];
  } catch {
    return [];
  }
}
function cleanCategories(value) {
  if (!Array.isArray(value)) return null;
  const categories = [];
  const seen = new Set();
  for (const item of value) {
    const name = cleanText(item, 40);
    if (!name) continue;
    const key = name.toLocaleLowerCase('id-ID');
    if (seen.has(key)) return null;
    seen.add(key);
    categories.push(name);
  }
  return categories.length <= 20 ? categories : null;
}
function validEventCategory(eventId, value) {
  const category = cleanText(value, 40);
  if (!eventId) return category ? null : '';
  const event = db.prepare('SELECT categories FROM events WHERE id=?').get(eventId);
  if (!event) return null;
  const match = parseCategories(event.categories).find(item => item.toLocaleLowerCase('id-ID') === category.toLocaleLowerCase('id-ID'));
  return category ? match || null : '';
}
function getPublicMatches(eventId = null) {
  const matches = db.prepare(`
    SELECT m.*, e.title AS event_title FROM matches m
    LEFT JOIN events e ON e.id=m.event_id
    ${eventId === null ? '' : 'WHERE m.event_id=?'}
    ORDER BY m.match_date ASC, m.match_time ASC, m.id DESC
  `).all(...(eventId === null ? [] : [eventId]));
  const lineups = db.prepare('SELECT * FROM match_rosters ORDER BY sort_order, id').all();
  const officials = db.prepare('SELECT * FROM match_officials ORDER BY sort_order, id').all();
  const matchById = new Map(matches.map(match => [match.id, {
    ...match,
    lineups: { home: [], away: [] },
    officials: { home: [], away: [] }
  }]));
  for (const player of lineups) {
    const match = matchById.get(player.match_id);
    if (match) match.lineups[player.team_side].push({
      name: player.player_name,
      number: player.jersey_number,
      position: player.position
    });
  }
  for (const official of officials) {
    const match = matchById.get(official.match_id);
    if (match) match.officials[official.team_side].push({
      name: official.official_name,
      role: official.role
    });
  }
  return [...matchById.values()];
}
function publicEvent(event) {
  return { ...event, categories: parseCategories(event.categories) };
}
app.get('/api/public', (req, res) => {
  const events = db.prepare(`SELECT * FROM events ORDER BY start_date ASC, id DESC`).all().map(publicEvent);
  const matches = getPublicMatches();
  const settings = Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(x => [x.key, x.value]));
  res.json({ events, matches, settings });
});
app.get('/api/public/events/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return apiError(res, 'ID event tidak valid.');
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(id);
  if (!event) return apiError(res, 'Event tidak ditemukan.', 404);
  res.json({ event: publicEvent(event), matches: getPublicMatches(id) });
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
  const events = db.prepare('SELECT * FROM events ORDER BY start_date DESC, id DESC').all().map(publicEvent);
  const matches = db.prepare(`SELECT m.*, e.title AS event_title FROM matches m LEFT JOIN events e ON e.id=m.event_id ORDER BY m.match_date DESC,m.match_time DESC,m.id DESC`).all();
  const settings = Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(x => [x.key, x.value]));
  res.json({ events, matches, settings, username: req.session.username });
});

app.get('/api/admin/lineups/template', requireAdmin, async (req, res, next) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const instructions = workbook.addWorksheet('Petunjuk');
    instructions.addRows([
      ['PANDUAN FORM LINEUP & OFISIAL'],
      ['Isi satu baris untuk satu pemain atau ofisial. Jangan mengubah nama kolom pada sheet Data.'],
      ['Tanggal Pertandingan menggunakan format YYYY-MM-DD, misalnya 2026-11-08.'],
      ['Tim Home dan Tim Away harus sama persis dengan nama tim pada jadwal di website.'],
      ['Kategori Event opsional; isi untuk mengelompokkan pertandingan ke divisi event yang telah dibuat.'],
      ['Sisi Tim isi Home atau Away. Jenis isi Pemain atau Ofisial.'],
      ['Pemain wajib memiliki Nama dan Nomor Punggung (angka 0-99); Posisi/Jabatan boleh dikosongkan.'],
      ['Ofisial wajib memiliki Nama dan Posisi/Jabatan (contoh: Pelatih, Manajer); Nomor Punggung dikosongkan.'],
      ['Jam Pertandingan opsional. Isi jika tanggal dan pasangan tim yang sama memiliki lebih dari satu pertandingan.'],
      ['Impor mengganti daftar pemain/ofisial untuk sisi dan jenis yang dicantumkan; data lain yang tidak dicantumkan tetap.'],
      ['Simpan file sebagai .xlsx sebelum mengunggahnya melalui panel admin.']
    ]);
    instructions.getColumn(1).width = 110;
    instructions.getRow(1).font = { bold: true, size: 14 };
    const data = workbook.addWorksheet('Data');
    data.columns = [
      { header: 'Tanggal Pertandingan', key: 'match_date', width: 23 },
      { header: 'Jam Pertandingan', key: 'match_time', width: 20 },
      { header: 'Tim Home', key: 'home_team', width: 28 },
      { header: 'Tim Away', key: 'away_team', width: 28 },
      { header: 'Sisi Tim', key: 'team_side', width: 16 },
      { header: 'Jenis', key: 'entry_type', width: 16 },
      { header: 'Nama', key: 'name', width: 30 },
      { header: 'Nomor Punggung', key: 'jersey_number', width: 20 },
      { header: 'Posisi / Jabatan', key: 'position', width: 24 },
      { header: 'Kategori Event', key: 'event_category', width: 24 }
    ];
    data.getColumn(1).numFmt = 'yyyy-mm-dd';
    data.getColumn(2).numFmt = 'hh:mm';
    data.getColumn(8).numFmt = '0';
    data.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    data.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF80652E' } };
    data.views = [{ state: 'frozen', ySplit: 1 }];
    data.autoFilter = { from: 'A1', to: 'J1' };
    const buffer = await workbook.xlsx.writeBuffer();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="template-lineup-ofisial.xlsx"'
    });
    res.send(Buffer.from(buffer));
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/lineups/import', requireAdmin, express.raw({
  type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  limit: '2mb'
}), async (req, res, next) => {
  if (!Buffer.isBuffer(req.body)) return apiError(res, 'Unggah file Excel .xlsx yang valid.', 415);

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(req.body);
  } catch {
    return apiError(res, 'File Excel tidak dapat dibaca. Pastikan file berformat .xlsx yang valid.');
  }

  const sheet = workbook.getWorksheet('Data');
  if (!sheet) return apiError(res, 'Sheet "Data" tidak ditemukan. Gunakan template resmi dari panel admin.');
  if (sheet.actualRowCount > 501) return apiError(res, 'Maksimal 500 baris data dapat diimpor sekaligus.');

  const headers = [
    'Tanggal Pertandingan', 'Jam Pertandingan', 'Tim Home', 'Tim Away',
    'Sisi Tim', 'Jenis', 'Nama', 'Nomor Punggung', 'Posisi / Jabatan', 'Kategori Event'
  ];
  const normalizeHeader = value => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const columnByHeader = new Map();
  sheet.getRow(1).eachCell((cell, column) => columnByHeader.set(normalizeHeader(cell.value), column));
  const columns = headers.map(header => columnByHeader.get(normalizeHeader(header)));
  if (columns.slice(0, -1).some(column => !column)) return apiError(res, 'Kolom pada sheet "Data" tidak lengkap. Unduh dan gunakan template resmi.');
  const hasCategoryColumn = Boolean(columns[columns.length - 1]);

  const cellText = (value, columnIndex) => {
    if (value instanceof Date) {
      if (columnIndex === 0) return value.toISOString().slice(0, 10);
      if (columnIndex === 1) return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
      return '';
    }
    if (value && typeof value === 'object') {
      if ('formula' in value || 'richText' in value || 'hyperlink' in value) throw new Error('Gunakan nilai teks biasa, bukan formula atau tautan.');
      return '';
    }
    return String(value ?? '').trim();
  };
  const normalizeTeam = value => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('id-ID');
  const matchIndex = new Map();
  for (const match of db.prepare('SELECT id,event_id,match_date,match_time,home_team,away_team FROM matches').all()) {
    const key = [match.match_date, normalizeTeam(match.home_team), normalizeTeam(match.away_team)].join('|');
    const found = matchIndex.get(key) || [];
    found.push(match);
    matchIndex.set(key, found);
  }
  const entries = [];
  const categoryUpdates = new Map();
  try {
    for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const values = columns.map((column, index) => column ? cellText(row.getCell(column).value, index) : '');
      if (values.every(value => !value)) continue;
      const [matchDate, matchTime, homeTeam, awayTeam, sideValue, typeValue, name, numberValue, position, eventCategoryValue] = values;
      if (!validDate(matchDate) || !homeTeam || !awayTeam || !name) {
        return apiError(res, `Baris ${rowNumber}: tanggal, kedua nama tim, dan nama wajib diisi.`);
      }
      const timeParts = matchTime && /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(matchTime);
      if (matchTime && !timeParts) return apiError(res, `Baris ${rowNumber}: Jam Pertandingan harus berformat HH:MM.`);
      const normalizedMatchTime = timeParts ? `${timeParts[1]}:${timeParts[2]}` : '';
      if (homeTeam.length > 100 || awayTeam.length > 100 || name.length > 100 || position.length > 100) {
        return apiError(res, `Baris ${rowNumber}: nama atau posisi/jabatan melebihi 100 karakter.`);
      }
      const candidates = matchIndex.get([matchDate, normalizeTeam(homeTeam), normalizeTeam(awayTeam)].join('|')) || [];
      const matching = candidates.filter(match => !normalizedMatchTime || match.match_time === normalizedMatchTime);
      if (matching.length !== 1) {
        const reason = matching.length ? 'Pertandingan ambigu; isi Jam Pertandingan untuk membedakannya.' : 'Pertandingan tidak ditemukan.';
        return apiError(res, `Baris ${rowNumber}: ${reason} Periksa tanggal dan nama tim.`);
      }
      const eventCategory = validEventCategory(matching[0].event_id, eventCategoryValue);
      if (eventCategory === null) return apiError(res, `Baris ${rowNumber}: Kategori Event tidak tersedia di event pertandingan tersebut.`);
      if (hasCategoryColumn) {
        const previous = categoryUpdates.get(matching[0].id);
        if (previous !== undefined && previous !== eventCategory) {
          return apiError(res, `Baris ${rowNumber}: satu pertandingan tidak boleh memiliki lebih dari satu Kategori Event.`);
        }
        categoryUpdates.set(matching[0].id, eventCategory);
      }
      const side = sideValue.trim().toLowerCase();
      const teamSide = ['home', 'kandang'].includes(side) ? 'home' : ['away', 'tandang'].includes(side) ? 'away' : '';
      if (!teamSide) return apiError(res, `Baris ${rowNumber}: Sisi Tim harus Home atau Away.`);
      const type = typeValue.trim().toLowerCase();
      const entryType = ['pemain', 'player'].includes(type) ? 'player' : ['ofisial', 'official'].includes(type) ? 'official' : '';
      if (!entryType) return apiError(res, `Baris ${rowNumber}: Jenis harus Pemain atau Ofisial.`);
      if (entryType === 'player') {
        if (!/^\d{1,2}$/.test(numberValue) || Number(numberValue) > 99) {
          return apiError(res, `Baris ${rowNumber}: Nomor Punggung pemain harus angka 0-99.`);
        }
      } else if (!position) {
        return apiError(res, `Baris ${rowNumber}: Posisi / Jabatan wajib diisi untuk ofisial.`);
      }
      entries.push({
        matchId: matching[0].id,
        teamSide,
        entryType,
        name,
        number: entryType === 'player' ? Number(numberValue) : null,
        position
      });
    }
  } catch (error) {
    return apiError(res, `File Excel berisi data yang tidak didukung: ${error.message}`);
  }
  if (!entries.length) return apiError(res, 'Tidak ada data pemain atau ofisial pada sheet "Data".');

  const replaceGroups = new Map();
  for (const entry of entries) {
    const key = `${entry.matchId}|${entry.teamSide}|${entry.entryType}`;
    if (!replaceGroups.has(key)) replaceGroups.set(key, []);
    replaceGroups.get(key).push(entry);
  }
  for (const [key, group] of replaceGroups) {
    if (group[0].entryType !== 'player') continue;
    const numbers = group.map(entry => entry.number);
    if (new Set(numbers).size !== numbers.length) {
      return apiError(res, 'Nomor punggung pemain harus unik untuk setiap sisi tim dalam satu pertandingan.');
    }
  }

  const saveLineup = db.transaction(() => {
    if (hasCategoryColumn) {
      const updateCategory = db.prepare('UPDATE matches SET event_category=? WHERE id=?');
      for (const [matchId, category] of categoryUpdates) updateCategory.run(category, matchId);
    }
    for (const [key, group] of replaceGroups) {
      const [matchId, teamSide, entryType] = key.split('|');
      if (entryType === 'player') {
        db.prepare('DELETE FROM match_rosters WHERE match_id=? AND team_side=?').run(matchId, teamSide);
        const insert = db.prepare(`INSERT INTO match_rosters(match_id,team_side,player_name,jersey_number,position,sort_order)
          VALUES(?,?,?,?,?,?)`);
        group.forEach((entry, index) => insert.run(entry.matchId, entry.teamSide, entry.name, entry.number, entry.position, index));
      } else {
        db.prepare('DELETE FROM match_officials WHERE match_id=? AND team_side=?').run(matchId, teamSide);
        const insert = db.prepare(`INSERT INTO match_officials(match_id,team_side,official_name,role,sort_order)
          VALUES(?,?,?,?,?)`);
        group.forEach((entry, index) => insert.run(entry.matchId, entry.teamSide, entry.name, entry.position, index));
      }
    }
  });
  try {
    saveLineup();
  } catch (error) {
    return next(error);
  }
  res.json({ ok: true, imported: entries.length, matches: new Set(entries.map(entry => entry.matchId)).size });
});

app.post('/api/admin/events', requireAdmin, (req, res) => {
  const b = req.body || {};
  const categories = cleanCategories(b.categories ?? []);
  const title = cleanText(b.title, 120);
  const category = cleanText(b.category || 'Turnamen', 60);
  const location = cleanText(b.location || 'Pontianak', 160);
  const startDate = cleanText(b.start_date, 10);
  const endDate = b.end_date ? cleanText(b.end_date, 10) : null;
  const status = cleanText(b.status || 'Akan Datang', 40);
  const description = cleanText(b.description, 2000);
  if (!title || !validDate(startDate) || !categories) return apiError(res, 'Nama event, kategori event, atau tanggal mulai tidak valid. Maksimal 20 kategori, nama kategori unik, dan 40 karakter per kategori.');
  if (endDate && (!validDate(endDate) || endDate < startDate)) return apiError(res, 'Tanggal selesai tidak valid.');
  const info = db.prepare(`INSERT INTO events(title,category,location,start_date,end_date,status,description,categories) VALUES(?,?,?,?,?,?,?,?)`)
    .run(title, category, location, startDate, endDate, status, description, JSON.stringify(categories));
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});
app.put('/api/admin/events/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const categories = cleanCategories(b.categories ?? []);
  const title = cleanText(b.title, 120);
  const startDate = cleanText(b.start_date, 10);
  const endDate = b.end_date ? cleanText(b.end_date, 10) : null;
  if (!Number.isInteger(id) || id < 1 || !title || !validDate(startDate) || !categories) return apiError(res, 'Data event atau kategori event tidak valid. Maksimal 20 kategori, nama kategori unik, dan 40 karakter per kategori.');
  if (endDate && (!validDate(endDate) || endDate < startDate)) return apiError(res, 'Tanggal selesai tidak valid.');
  const updateEvent = db.transaction(() => {
    const info = db.prepare(`UPDATE events SET title=?,category=?,location=?,start_date=?,end_date=?,status=?,description=?,categories=? WHERE id=?`)
      .run(title, cleanText(b.category || 'Turnamen',60), cleanText(b.location || 'Pontianak',160), startDate, endDate, cleanText(b.status || 'Akan Datang',40), cleanText(b.description,2000), JSON.stringify(categories), id);
    if (info.changes) {
      const retained = new Set(categories.map(category => category.toLocaleLowerCase('id-ID')));
      const assigned = db.prepare("SELECT DISTINCT event_category FROM matches WHERE event_id=? AND event_category<>''").all(id);
      const clearCategory = db.prepare("UPDATE matches SET event_category='' WHERE event_id=? AND event_category=?");
      for (const row of assigned) {
        if (!retained.has(row.event_category.toLocaleLowerCase('id-ID'))) clearCategory.run(id, row.event_category);
      }
    }
    return info;
  });
  const info = updateEvent();
  if (!info.changes) return apiError(res, 'Event tidak ditemukan.', 404);
  res.json({ ok: true });
});
app.delete('/api/admin/events/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return apiError(res, 'ID tidak valid.');
  const info = db.transaction(() => {
    db.prepare("UPDATE matches SET event_category='' WHERE event_id=?").run(id);
    return db.prepare('DELETE FROM events WHERE id=?').run(id);
  })();
  if (!info.changes) return apiError(res, 'Event tidak ditemukan.', 404);
  res.json({ ok: true });
});

app.use('/team-logos', express.static(TEAM_LOGOS_DIR, {
  dotfiles: 'deny',
  index: false,
  fallthrough: true,
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}));

const logoContentTypes = new Map([
  ['image/png', { extension: 'png', signature: buffer => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) }],
  ['image/jpeg', { extension: 'jpg', signature: buffer => buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 }],
  ['image/webp', { extension: 'webp', signature: buffer => buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' }]
]);
const storedLogoName = name => typeof name === 'string' && /^[0-9a-f-]{36}\.(?:png|jpg|webp)$/i.test(name);
async function removeStoredLogo(name) {
  if (!storedLogoName(name)) return;
  try {
    await fs.promises.unlink(path.join(TEAM_LOGOS_DIR, name));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

app.put('/api/admin/matches/:id/logos/:side', requireAdmin, express.raw({
  type: ['image/png', 'image/jpeg', 'image/webp'],
  limit: '1mb'
}), async (req, res, next) => {
  const id = Number(req.params.id);
  const side = req.params.side;
  if (!Number.isInteger(id) || id < 1 || !['home', 'away'].includes(side)) return apiError(res, 'Pertandingan atau sisi tim tidak valid.');
  const match = db.prepare('SELECT home_logo,away_logo FROM matches WHERE id=?').get(id);
  if (!match) return apiError(res, 'Pertandingan tidak ditemukan.', 404);
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return apiError(res, 'Pilih file logo PNG, JPG, atau WEBP.');
  const image = logoContentTypes.get(req.get('content-type'));
  if (!image || !image.signature(req.body)) return apiError(res, 'File tidak valid. Gunakan gambar PNG, JPG, atau WEBP.');

  const filename = `${randomUUID()}.${image.extension}`;
  const previousFilename = match[`${side}_logo`];
  try {
    await fs.promises.writeFile(path.join(TEAM_LOGOS_DIR, filename), req.body, { flag: 'wx' });
    db.prepare(`UPDATE matches SET ${side}_logo=? WHERE id=?`).run(filename, id);
    try {
      await removeStoredLogo(previousFilename);
    } catch (error) {
      console.error('Gagal menghapus file logo lama:', error);
    }
  } catch (error) {
    try {
      await removeStoredLogo(filename);
    } catch (cleanupError) {
      console.error('Gagal membersihkan unggahan logo yang tidak tersimpan:', cleanupError);
    }
    return next(error);
  }
  res.json({ ok: true, filename });
});

app.delete('/api/admin/matches/:id/logos/:side', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  const side = req.params.side;
  if (!Number.isInteger(id) || id < 1 || !['home', 'away'].includes(side)) return apiError(res, 'Pertandingan atau sisi tim tidak valid.');
  const match = db.prepare(`SELECT ${side}_logo AS logo FROM matches WHERE id=?`).get(id);
  if (!match) return apiError(res, 'Pertandingan tidak ditemukan.', 404);
  db.prepare(`UPDATE matches SET ${side}_logo=NULL WHERE id=?`).run(id);
  try {
    await removeStoredLogo(match.logo);
  } catch (error) {
    return next(error);
  }
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
  if (eventId && (!Number.isInteger(eventId) || !db.prepare('SELECT id FROM events WHERE id=?').get(eventId))) return apiError(res, 'Event yang dipilih tidak ditemukan.');
  const eventCategory = validEventCategory(eventId, b.event_category);
  if (eventCategory === null) return apiError(res, 'Kategori pertandingan tidak sesuai dengan kategori event yang dipilih.');
  const status = cleanText(b.status || (homeScore !== null && awayScore !== null ? 'Selesai' : 'Terjadwal'), 30);
  const info = db.prepare(`INSERT INTO matches(event_id,match_date,match_time,home_team,away_team,home_score,away_score,venue,status,round_name,event_category)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(eventId, matchDate, cleanText(b.match_time,5), home, away, homeScore, awayScore, cleanText(b.venue,160), status, cleanText(b.round_name,100), eventCategory);
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
  if (eventId && (!Number.isInteger(eventId) || !db.prepare('SELECT id FROM events WHERE id=?').get(eventId))) return apiError(res, 'Event yang dipilih tidak ditemukan.');
  const eventCategory = validEventCategory(eventId, b.event_category);
  if (eventCategory === null) return apiError(res, 'Kategori pertandingan tidak sesuai dengan kategori event yang dipilih.');
  const info = db.prepare(`UPDATE matches SET event_id=?,match_date=?,match_time=?,home_team=?,away_team=?,home_score=?,away_score=?,venue=?,status=?,round_name=?,event_category=? WHERE id=?`)
    .run(eventId, matchDate, cleanText(b.match_time,5), home, away, homeScore, awayScore, cleanText(b.venue,160), cleanText(b.status || (homeScore !== null && awayScore !== null ? 'Selesai' : 'Terjadwal'),30), cleanText(b.round_name,100), eventCategory, id);
  if (!info.changes) return apiError(res, 'Pertandingan tidak ditemukan.', 404);
  res.json({ ok: true });
});
app.delete('/api/admin/matches/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return apiError(res, 'ID tidak valid.');
  const match = db.prepare('SELECT home_logo,away_logo FROM matches WHERE id=?').get(id);
  if (!match) return apiError(res, 'Pertandingan tidak ditemukan.', 404);
  const info = db.prepare('DELETE FROM matches WHERE id=?').run(id);
  for (const filename of [match.home_logo, match.away_logo]) {
    removeStoredLogo(filename).catch(error => console.error('Gagal menghapus file logo pertandingan:', error));
  }
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
app.get('/event/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'event.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  if (err.type === 'entity.too.large') return apiError(res, req.path.includes('/logos/') ? 'Ukuran setiap file logo maksimal 1 MB.' : 'Ukuran file maksimal 2 MB.', 413);
  if (err.status === 415) return apiError(res, 'Format file tidak didukung.', 415);
  res.status(500).json({ error: 'Terjadi kesalahan server. Periksa log aplikasi.' });
});

app.listen(PORT, () => console.log(`IFL Event website aktif di http://localhost:${PORT}`));
