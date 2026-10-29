require('dotenv').config();

const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { randomBytes, randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const ExcelJS = require('exceljs');
const {
  bracketSeedPositions,
  bracketSize,
  buildGroupStandings,
  competitionRoundName,
  isFinished,
  selectQualifiers
} = require('./lib/competition');

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
    registration_token TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS event_teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    team_name TEXT NOT NULL,
    logo_name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS event_teams_event_id_idx ON event_teams(event_id, sort_order, id);
  CREATE TABLE IF NOT EXISTS team_roster_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_team_id INTEGER NOT NULL UNIQUE,
    token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(event_team_id) REFERENCES event_teams(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS team_roster_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_team_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'replaced')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TEXT,
    FOREIGN KEY(event_team_id) REFERENCES event_teams(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS team_roster_submissions_team_idx
    ON team_roster_submissions(event_team_id, status, created_at, id);
  CREATE TABLE IF NOT EXISTS team_roster_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL,
    player_name TEXT NOT NULL,
    jersey_number INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(submission_id) REFERENCES team_roster_submissions(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS team_roster_staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL,
    staff_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('Pelatih', 'Ofisial')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(submission_id) REFERENCES team_roster_submissions(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS participant_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    team_name TEXT NOT NULL,
    logo_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'replaced')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TEXT,
    FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS participant_roster_intakes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    registration_id INTEGER NOT NULL UNIQUE,
    players_json TEXT NOT NULL,
    staff_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(registration_id) REFERENCES participant_registrations(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS participant_registrations_event_idx
    ON participant_registrations(event_id, status, created_at, id);
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
    phase TEXT NOT NULL DEFAULT 'other',
    group_name TEXT NOT NULL DEFAULT '',
    home_penalty_score INTEGER,
    away_penalty_score INTEGER,
    generated_bracket INTEGER NOT NULL DEFAULT 0,
    bracket_round INTEGER,
    bracket_position INTEGER,
    home_source_match_id INTEGER REFERENCES matches(id) ON DELETE SET NULL,
    away_source_match_id INTEGER REFERENCES matches(id) ON DELETE SET NULL,
    home_qualifier_seed INTEGER,
    away_qualifier_seed INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS competition_configs (
    event_id INTEGER NOT NULL,
    event_category TEXT NOT NULL,
    competition_format TEXT NOT NULL DEFAULT 'groups',
    qualification_mode TEXT NOT NULL DEFAULT 'group_winners',
    best_runner_up_count INTEGER NOT NULL DEFAULT 0,
    group_stage_confirmed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(event_id, event_category),
    FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
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
  CREATE TABLE IF NOT EXISTS match_roster_sources (
    match_id INTEGER NOT NULL,
    team_side TEXT NOT NULL CHECK(team_side IN ('home', 'away')),
    event_team_id INTEGER NOT NULL,
    submission_id INTEGER NOT NULL,
    PRIMARY KEY(match_id, team_side),
    FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE,
    FOREIGN KEY(event_team_id) REFERENCES event_teams(id) ON DELETE CASCADE,
    FOREIGN KEY(submission_id) REFERENCES team_roster_submissions(id) ON DELETE CASCADE
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
for (const [column, definition] of Object.entries({
  phase: "TEXT NOT NULL DEFAULT 'other'",
  group_name: "TEXT NOT NULL DEFAULT ''",
  home_penalty_score: 'INTEGER',
  away_penalty_score: 'INTEGER',
  generated_bracket: 'INTEGER NOT NULL DEFAULT 0',
  bracket_round: 'INTEGER',
  bracket_position: 'INTEGER',
  home_source_match_id: 'INTEGER REFERENCES matches(id) ON DELETE SET NULL',
  away_source_match_id: 'INTEGER REFERENCES matches(id) ON DELETE SET NULL',
  home_qualifier_seed: 'INTEGER',
  away_qualifier_seed: 'INTEGER'
})) {
  if (!matchColumns.has(column)) db.exec(`ALTER TABLE matches ADD COLUMN ${column} ${definition}`);
}
const competitionConfigColumns = new Set(db.pragma('table_info(competition_configs)').map(column => column.name));
if (!competitionConfigColumns.has('competition_format')) {
  db.exec("ALTER TABLE competition_configs ADD COLUMN competition_format TEXT NOT NULL DEFAULT 'groups'");
}
if (!competitionConfigColumns.has('group_stage_confirmed')) {
  db.exec('ALTER TABLE competition_configs ADD COLUMN group_stage_confirmed INTEGER NOT NULL DEFAULT 0');
}
const eventColumns = new Set(db.pragma('table_info(events)').map(column => column.name));
if (!eventColumns.has('categories')) db.exec("ALTER TABLE events ADD COLUMN categories TEXT NOT NULL DEFAULT '[]'");
if (!eventColumns.has('registration_token')) db.exec('ALTER TABLE events ADD COLUMN registration_token TEXT');
const registrationColumns = new Set(db.pragma('table_info(participant_registrations)').map(column => column.name));
if (registrationColumns.has('roster_token')) db.exec('UPDATE participant_registrations SET roster_token=NULL');
if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='team_roster_links'").get()) {
  db.exec('DELETE FROM team_roster_links');
}

const seedSettings = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)');
[
  ['contact_name', 'Panitia IFL Event'],
  ['contact_phone', 'Isi nomor WhatsApp panitia melalui panel admin'],
  ['contact_phone_2', ''],
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
const participantRegistrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan pendaftaran. Silakan coba lagi dalam 15 menit.' }
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
function clearAppliedRoster(matchId, teamSide) {
  db.prepare('DELETE FROM match_rosters WHERE match_id=? AND team_side=?').run(matchId, teamSide);
  db.prepare('DELETE FROM match_officials WHERE match_id=? AND team_side=?').run(matchId, teamSide);
  db.prepare('DELETE FROM match_roster_sources WHERE match_id=? AND team_side=?').run(matchId, teamSide);
}
function clearAppliedRostersForTeam(teamId) {
  const sources = db.prepare('SELECT match_id,team_side FROM match_roster_sources WHERE event_team_id=?').all(teamId);
  for (const source of sources) clearAppliedRoster(source.match_id, source.team_side);
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
function getCompetitionConfig(eventId, eventCategory) {
  return db.prepare('SELECT * FROM competition_configs WHERE event_id=? AND event_category=?').get(eventId, eventCategory);
}
function unifiedStandings(config) {
  return ['student_24', 'community_shield'].includes(config?.competition_format);
}
function qualificationMode(config) {
  return unifiedStandings(config) ? config.competition_format : config?.qualification_mode;
}
function buildCompetitionStandings(matches, config) {
  return buildGroupStandings(matches, { unified: unifiedStandings(config) });
}
function competitionFormatWarning(config, groups) {
  const teams = groups[0]?.teams || [];
  if (config?.competition_format === 'student_24' &&
      (teams.length !== 24 || teams.some(team => team.played !== 3))) {
    return 'Format Pelajar 24 tim memerlukan tepat 24 tim dan setiap tim harus menyelesaikan 3 pertandingan fase grup.';
  }
  if (config?.competition_format === 'community_shield' && teams.length !== 8) {
    return 'Format Community Shield memerlukan tepat 8 tim dalam satu klasemen liga.';
  }
  return '';
}
function getGroupMatches(eventId, eventCategory) {
  return db.prepare(`SELECT * FROM matches
    WHERE event_id=? AND event_category=? AND phase='group'
    ORDER BY group_name, match_date, match_time, id`).all(eventId, eventCategory);
}
function matchWinner(match) {
  if (!isFinished(match)) return null;
  if (match.home_score > match.away_score) return match.home_team;
  if (match.away_score > match.home_score) return match.away_team;
  if (match.home_penalty_score > match.away_penalty_score) return match.home_team;
  if (match.away_penalty_score > match.home_penalty_score) return match.away_team;
  return null;
}
function getBracketProgress(eventId, eventCategory) {
  const config = getCompetitionConfig(eventId, eventCategory);
  if (!config) return { generated: false, warning: '' };
  const existing = db.prepare(`SELECT COUNT(*) AS count FROM matches
    WHERE event_id=? AND event_category=? AND generated_bracket=1`).get(eventId, eventCategory).count;
  const groupMatches = getGroupMatches(eventId, eventCategory);
  if (existing) {
    const complete = Boolean(config.group_stage_confirmed) &&
      groupMatches.length > 0 && groupMatches.every(isFinished);
    const formatWarning = complete
      ? competitionFormatWarning(config, buildCompetitionStandings(groupMatches, config))
      : '';
    const changed = syncGeneratedBracket(eventId, eventCategory);
    const warning = formatWarning
      ? `${formatWarning} Peserta bagan dikosongkan dan hasil babak gugur direset.`
      : changed ? 'Peserta bagan berubah; hasil babak gugur yang terdampak telah direset.'
        : complete ? '' : 'Bagan menunggu semua hasil fase grup yang telah dikonfirmasi.';
    return { generated: false, warning };
  }
  if (!config.group_stage_confirmed) {
    return { generated: false, warning: '' };
  }
  if (!groupMatches.length || !groupMatches.every(isFinished)) {
    return { generated: false, warning: 'Konfirmasi tersimpan. Bagan dibuat otomatis setelah semua hasil fase grup lengkap.' };
  }
  const groups = buildCompetitionStandings(groupMatches, config);
  const formatWarning = competitionFormatWarning(config, groups);
  if (formatWarning) return { generated: false, warning: formatWarning };
  const qualifiers = selectQualifiers(groups, qualificationMode(config), config.best_runner_up_count);
  if (qualifiers.length < 2) {
    return { generated: false, warning: 'Bagan belum dibuat: minimal dua tim harus lolos.' };
  }
  if (qualifiers.length > 32) {
    return { generated: false, warning: 'Bagan otomatis mendukung maksimal 32 tim lolos.' };
  }

  const size = bracketSize(qualifiers.length);
  const seedPositions = bracketSeedPositions(size);
  const slots = Array(size).fill(null);
  qualifiers.forEach((qualifier, index) => {
    slots[seedPositions.indexOf(index + 1)] = {
      team: qualifier.team,
      qualifierSeed: index + 1
    };
  });
  const rounds = Math.log2(size);
  const createMatches = db.transaction(() => {
    let participants = slots;
    for (let roundIndex = 0; roundIndex < rounds; roundIndex++) {
      const nextRound = [];
      for (let index = 0; index < participants.length; index += 2) {
        const home = participants[index];
        const away = participants[index + 1];
        if (!home && !away) {
          nextRound.push(null);
          continue;
        }
        if (!home || !away) {
          nextRound.push(home || away);
          continue;
        }
        const position = index / 2 + 1;
        const roundName = competitionRoundName(config.competition_format, qualifiers.length, roundIndex);
        const homeName = home.team || `Pemenang pertandingan ${home.sourceMatchId}`;
        const awayName = away.team || `Pemenang pertandingan ${away.sourceMatchId}`;
        const result = db.prepare(`INSERT INTO matches(
          event_id,match_date,match_time,home_team,away_team,venue,status,round_name,event_category,
          phase,group_name,generated_bracket,bracket_round,bracket_position,
          home_source_match_id,away_source_match_id,home_qualifier_seed,away_qualifier_seed
        ) VALUES(?, '', '', ?, ?, '', 'Terjadwal', ?, ?, 'knockout', '', 1, ?, ?, ?, ?, ?, ?)`)
          .run(eventId, homeName, awayName, roundName, eventCategory, roundIndex + 1, position,
            home.sourceMatchId || null, away.sourceMatchId || null,
            home.qualifierSeed || null, away.qualifierSeed || null);
        const matchId = Number(result.lastInsertRowid);
        nextRound.push({ sourceMatchId: matchId, team: null });
      }
      participants = nextRound;
    }
  });
  createMatches();
  syncGeneratedBracket(eventId, eventCategory);
  return { generated: true, warning: '' };
}
function syncGeneratedBracket(eventId, eventCategory) {
  const groupMatches = getGroupMatches(eventId, eventCategory);
  const config = getCompetitionConfig(eventId, eventCategory);
  const groupStageComplete = Boolean(config?.group_stage_confirmed) &&
    groupMatches.length > 0 && groupMatches.every(isFinished);
  const standings = groupStageComplete && config ? buildCompetitionStandings(groupMatches, config) : [];
  const qualifiers = groupStageComplete && config && !competitionFormatWarning(config, standings)
    ? selectQualifiers(
      standings,
      qualificationMode(config),
      config.best_runner_up_count
    )
    : [];
  const bracketMatches = db.prepare(`SELECT * FROM matches
    WHERE event_id=? AND event_category=? AND generated_bracket=1
    ORDER BY bracket_round, bracket_position, id`).all(eventId, eventCategory);
  const byId = new Map(bracketMatches.map(match => [match.id, match]));
  const update = db.prepare(`UPDATE matches SET home_team=?,away_team=?,home_logo=?,away_logo=?,
    home_score=?,away_score=?,home_penalty_score=?,away_penalty_score=?,status=? WHERE id=?`);
  let participantsChanged = false;
  for (const match of bracketMatches) {
    const resolve = (side, team) => {
      const sourceId = match[`${side}_source_match_id`];
      if (sourceId) {
        const source = byId.get(sourceId);
        const winner = source && matchWinner(source);
        return winner || `Pemenang ${source?.round_name || 'pertandingan'} ${source?.bracket_position || ''}`.trim();
      }
      const seed = match[`${side}_qualifier_seed`];
      if (seed) return groupStageComplete
        ? qualifiers[seed - 1]?.team || 'Slot kosong'
        : 'Menunggu hasil fase grup';
      return team;
    };
    const homeTeam = resolve('home', match.home_team);
    const awayTeam = resolve('away', match.away_team);
    const homeLogo = getEventTeamLogo(eventId, homeTeam);
    const awayLogo = getEventTeamLogo(eventId, awayTeam);
    const matchParticipantsChanged = homeTeam !== match.home_team || awayTeam !== match.away_team;
    const matchLogosChanged = homeLogo !== match.home_logo || awayLogo !== match.away_logo;
    if (matchParticipantsChanged || matchLogosChanged) {
      participantsChanged = true;
      update.run(homeTeam, awayTeam, homeLogo, awayLogo,
        null, null, null, null, 'Terjadwal', match.id);
      match.home_team = homeTeam;
      match.away_team = awayTeam;
      match.home_logo = homeLogo;
      match.away_logo = awayLogo;
      match.home_score = null;
      match.away_score = null;
      match.home_penalty_score = null;
      match.away_penalty_score = null;
      match.status = 'Terjadwal';
    }
  }
  return participantsChanged;
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
  const participantCount = db.prepare('SELECT COUNT(*) AS count FROM event_teams WHERE event_id=?').get(event.id).count;
  const { registration_token, ...publicDetails } = event;
  return { ...publicDetails, categories: parseCategories(event.categories), participant_count: participantCount };
}
function normalizeTeamName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('id-ID');
}
function getEventTeamLogo(eventId, teamName) {
  if (!eventId || !teamName) return null;
  const normalizedName = normalizeTeamName(teamName);
  return db.prepare('SELECT team_name,logo_name FROM event_teams WHERE event_id=?').all(eventId)
    .find(team => normalizeTeamName(team.team_name) === normalizedName)?.logo_name || null;
}
function resolveMatchLogo(eventId, teamName, existing, side) {
  const participantLogo = getEventTeamLogo(eventId, teamName);
  if (participantLogo) return participantLogo;
  if (existing && existing.event_id === eventId &&
      normalizeTeamName(existing[`${side}_team`]) === normalizeTeamName(teamName)) {
    return existing[`${side}_logo`];
  }
  return null;
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
  const participants = db.prepare('SELECT id,team_name AS name,logo_name AS logo FROM event_teams WHERE event_id=? ORDER BY sort_order,id').all(id);
  const matches = getPublicMatches(id);
  const categories = [...new Set(matches.filter(match => match.phase === 'group').map(match => match.event_category))];
  const standings = Object.fromEntries(categories.map(category => [
    category,
    buildCompetitionStandings(
      matches.filter(match => match.event_category === category),
      getCompetitionConfig(id, category)
    )
  ]));
  res.json({ event: publicEvent(event), matches, participants, standings });
});
app.get('/api/public/registrations/:token', (req, res) => {
  const token = String(req.params.token || '');
  if (!/^[a-f0-9]{48}$/.test(token)) return apiError(res, 'Link pendaftaran tidak valid.', 404);
  const event = db.prepare('SELECT id,title,start_date,end_date,location FROM events WHERE registration_token=?').get(token);
  if (!event) return apiError(res, 'Link pendaftaran tidak aktif atau sudah diganti.', 404);
  res.json({ event });
});
app.post('/api/public/registrations/:token', participantRegistrationLimiter, express.raw({
  type: ['image/png', 'image/jpeg', 'image/webp'],
  limit: '1mb'
}), async (req, res, next) => {
  const token = String(req.params.token || '');
  if (!/^[a-f0-9]{48}$/.test(token)) return apiError(res, 'Link pendaftaran tidak valid.', 404);
  const event = db.prepare('SELECT id FROM events WHERE registration_token=?').get(token);
  if (!event) return apiError(res, 'Link pendaftaran tidak aktif atau sudah diganti.', 404);
  const name = cleanText(req.query.team_name, 100);
  if (!name || name !== String(req.query.team_name || '').trim()) {
    return apiError(res, 'Nama tim wajib diisi dan maksimal 100 karakter.');
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return apiError(res, 'Logo tim wajib diunggah.');
  const image = logoContentTypes.get(req.get('content-type'));
  if (!image || !image.signature(req.body)) return apiError(res, 'File logo tidak valid. Gunakan PNG, JPG, atau WEBP.');

  const normalizedName = name.replace(/\s+/g, ' ').toLocaleLowerCase('id-ID');
  const approvedNames = db.prepare('SELECT team_name FROM event_teams WHERE event_id=?').all(event.id);
  const pendingNames = db.prepare(`SELECT team_name FROM participant_registrations
    WHERE event_id=? AND status='pending'`).all(event.id);
  if ([...approvedNames, ...pendingNames].some(team =>
    team.team_name.replace(/\s+/g, ' ').toLocaleLowerCase('id-ID') === normalizedName
  )) return apiError(res, 'Nama tim ini sudah terdaftar atau sedang menunggu persetujuan.');

  const teamCount = db.prepare(`SELECT
    (SELECT COUNT(*) FROM event_teams WHERE event_id=?) +
    (SELECT COUNT(*) FROM participant_registrations WHERE event_id=? AND status='pending') AS count`).get(event.id, event.id).count;
  if (teamCount >= 200) return apiError(res, 'Pendaftaran event ini sudah mencapai batas 200 tim.', 409);

  const filename = `${randomUUID()}.${image.extension}`;
  try {
    await fs.promises.writeFile(path.join(TEAM_LOGOS_DIR, filename), req.body, { flag: 'wx' });
    const duplicate = [
      ...db.prepare('SELECT team_name FROM event_teams WHERE event_id=?').all(event.id),
      ...db.prepare(`SELECT team_name FROM participant_registrations
        WHERE event_id=? AND status='pending'`).all(event.id)
    ].some(team => team.team_name.replace(/\s+/g, ' ').toLocaleLowerCase('id-ID') === normalizedName);
    if (duplicate) {
      await removeStoredLogo(filename);
      return apiError(res, 'Nama tim ini sudah terdaftar atau sedang menunggu persetujuan.', 409);
    }
    const currentCount = db.prepare(`SELECT
      (SELECT COUNT(*) FROM event_teams WHERE event_id=?) +
      (SELECT COUNT(*) FROM participant_registrations WHERE event_id=? AND status='pending') AS count`).get(event.id, event.id).count;
    if (currentCount >= 200) {
      await removeStoredLogo(filename);
      return apiError(res, 'Pendaftaran event ini sudah mencapai batas 200 tim.', 409);
    }
    db.prepare(`INSERT INTO participant_registrations(event_id,team_name,logo_name)
      VALUES(?,?,?)`).run(event.id, name, filename);
  } catch (error) {
    try { await removeStoredLogo(filename); }
    catch (cleanupError) { console.error('Gagal membersihkan logo pendaftaran yang tidak tersimpan:', cleanupError); }
    return next(error);
  }
  res.status(201).json({ ok: true, message: 'Pendaftaran terkirim dan menunggu persetujuan panitia.' });
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
  const events = db.prepare(`SELECT e.*,
    (SELECT COUNT(*) FROM participant_registrations r WHERE r.event_id=e.id AND r.status='pending') AS pending_registration_count
    FROM events e ORDER BY e.start_date DESC, e.id DESC`).all().map(event => ({
    ...publicEvent(event),
    registration_token: event.registration_token,
    pending_registration_count: event.pending_registration_count
  }));
  const matches = db.prepare(`SELECT m.*, e.title AS event_title FROM matches m LEFT JOIN events e ON e.id=m.event_id ORDER BY m.match_date DESC,m.match_time DESC,m.id DESC`).all();
  const event_teams = db.prepare(`SELECT event_id,id,team_name,logo_name FROM event_teams ORDER BY event_id,sort_order,id`).all();
  const settings = Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(x => [x.key, x.value]));
  const competition_configs = db.prepare('SELECT * FROM competition_configs ORDER BY event_id,event_category').all();
  const participant_registrations = db.prepare(`SELECT r.*,e.title AS event_title
    FROM participant_registrations r JOIN events e ON e.id=r.event_id
    WHERE r.status IN ('pending','approved')
    ORDER BY r.created_at DESC,r.id DESC`).all();
  res.json({ events, matches, event_teams, settings, competition_configs, participant_registrations, username: req.session.username });
});

app.put('/api/admin/competition-settings', requireAdmin, (req, res) => {
  const body = req.body || {};
  const eventId = Number(body.event_id);
  const category = validEventCategory(eventId, body.event_category);
  const mode = cleanText(body.qualification_mode, 30);
  const bestRunnerUpCount = Number(body.best_runner_up_count || 0);
  const groupStageConfirmed = body.group_stage_confirmed === true;
  if (!Number.isInteger(eventId) || !db.prepare('SELECT id FROM events WHERE id=?').get(eventId) || !category) {
    return apiError(res, 'Event dan kategori wajib dipilih.');
  }
  const competitionFormat = cleanText(body.competition_format || 'groups', 30);
  if (!['groups', 'student_24', 'community_shield'].includes(competitionFormat)) {
    return apiError(res, 'Format kompetisi tidak valid.');
  }
  if (!['group_winners', 'top_two', 'best_runners_up'].includes(mode)) {
    return apiError(res, 'Pilihan tim lolos tidak valid.');
  }
  if (!Number.isInteger(bestRunnerUpCount) || bestRunnerUpCount < 0 || bestRunnerUpCount > 16 ||
      (mode === 'best_runners_up' && bestRunnerUpCount < 1)) {
    return apiError(res, 'Jumlah runner-up terbaik harus 1–16.');
  }
  const existing = getCompetitionConfig(eventId, category);
  const generated = db.prepare(`SELECT COUNT(*) AS count FROM matches
    WHERE event_id=? AND event_category=? AND generated_bracket=1`).get(eventId, category).count;
  if (generated && existing &&
      (existing.competition_format !== competitionFormat ||
       existing.qualification_mode !== mode ||
       existing.best_runner_up_count !== bestRunnerUpCount)) {
    return apiError(res, 'Aturan lolos tidak dapat diubah setelah bagan otomatis dibuat.', 409);
  }
  db.prepare(`INSERT INTO competition_configs(event_id,event_category,competition_format,qualification_mode,best_runner_up_count,group_stage_confirmed)
    VALUES(?,?,?,?,?,?) ON CONFLICT(event_id,event_category) DO UPDATE SET
    competition_format=excluded.competition_format,qualification_mode=excluded.qualification_mode,best_runner_up_count=excluded.best_runner_up_count,
    group_stage_confirmed=excluded.group_stage_confirmed`)
    .run(eventId, category, competitionFormat, mode, bestRunnerUpCount, groupStageConfirmed ? 1 : 0);
  const bracket = getBracketProgress(eventId, category);
  res.json({ ok: true, ...bracket });
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
      db.prepare('DELETE FROM match_roster_sources WHERE match_id=? AND team_side=?').run(matchId, teamSide);
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
app.delete('/api/admin/events/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return apiError(res, 'ID tidak valid.');
    const logoNames = [
      ...db.prepare('SELECT logo_name FROM event_teams WHERE event_id=?').all(id),
      ...db.prepare('SELECT logo_name FROM participant_registrations WHERE event_id=?').all(id)
    ].map(row => row.logo_name);
    const info = db.transaction(() => {
      db.prepare("UPDATE matches SET event_category='' WHERE event_id=?").run(id);
      return db.prepare('DELETE FROM events WHERE id=?').run(id);
    })();
    if (!info.changes) return apiError(res, 'Event tidak ditemukan.', 404);
    await Promise.all(logoNames.map(async filename => {
      try { await removeStoredLogo(filename); }
      catch (error) { console.error('Gagal menghapus logo peserta event:', error); }
    }));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.put('/api/admin/events/:id/registration-link', requireAdmin, (req, res) => {
  const eventId = Number(req.params.id);
  if (!Number.isInteger(eventId) || eventId < 1) return apiError(res, 'ID event tidak valid.');
  const token = randomBytes(24).toString('hex');
  const result = db.prepare('UPDATE events SET registration_token=? WHERE id=?').run(token, eventId);
  if (!result.changes) return apiError(res, 'Event tidak ditemukan.', 404);
  res.json({ ok: true, token });
});
app.delete('/api/admin/events/:id/registration-link', requireAdmin, (req, res) => {
  const eventId = Number(req.params.id);
  if (!Number.isInteger(eventId) || eventId < 1) return apiError(res, 'ID event tidak valid.');
  const result = db.prepare('UPDATE events SET registration_token=NULL WHERE id=?').run(eventId);
  if (!result.changes) return apiError(res, 'Event tidak ditemukan.', 404);
  res.json({ ok: true });
});
app.delete('/api/admin/participant-registrations/:id', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return apiError(res, 'ID pendaftaran tidak valid.');
  const registration = db.prepare('SELECT * FROM participant_registrations WHERE id=?').get(id);
  if (!registration) return apiError(res, 'Pendaftaran tidak ditemukan.', 404);
  if (registration.status !== 'approved') return apiError(res, 'Hanya pendaftaran tim yang sudah disetujui yang dapat dihapus.', 409);
  const team = db.prepare('SELECT id FROM event_teams WHERE event_id=? AND team_name=?').get(
    registration.event_id, registration.team_name
  );
  if (!team) return apiError(res, 'Data tim yang disetujui tidak ditemukan.', 404);
  try {
    const removeTeam = db.transaction(() => {
      clearAppliedRostersForTeam(team.id);
      db.prepare('DELETE FROM event_teams WHERE id=?').run(team.id);
      db.prepare('DELETE FROM participant_registrations WHERE id=?').run(id);
    });
    removeTeam();
    await removeLogoIfUnused(registration.logo_name);
  } catch (error) {
    return next(error);
  }
  res.json({ ok: true });
});
app.put('/api/admin/participant-registrations/:id', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  const status = cleanText(req.body?.status, 20);
  if (!Number.isInteger(id) || id < 1 || !['approved', 'rejected'].includes(status)) {
    return apiError(res, 'Data persetujuan pendaftaran tidak valid.');
  }
  const registration = db.prepare('SELECT * FROM participant_registrations WHERE id=?').get(id);
  if (!registration) return apiError(res, 'Pendaftaran tidak ditemukan.', 404);
  if (registration.status !== 'pending') return apiError(res, 'Pendaftaran ini sudah ditinjau.', 409);

  if (status === 'rejected') {
    try {
      db.prepare('DELETE FROM participant_registrations WHERE id=?').run(id);
      await removeLogoIfUnused(registration.logo_name);
    } catch (error) {
      return next(error);
    }
    return res.json({ ok: true, status, deleted: true });
  }

  if (status === 'approved') {
    const eventTeamCount = db.prepare('SELECT COUNT(*) AS count FROM event_teams WHERE event_id=?').get(registration.event_id).count;
    if (eventTeamCount >= 200) return apiError(res, 'Daftar peserta event sudah mencapai batas 200 tim.', 409);
    const normalizedName = registration.team_name.replace(/\s+/g, ' ').toLocaleLowerCase('id-ID');
    const duplicate = db.prepare('SELECT team_name FROM event_teams WHERE event_id=?').all(registration.event_id)
      .some(team => team.team_name.replace(/\s+/g, ' ').toLocaleLowerCase('id-ID') === normalizedName);
    if (duplicate) return apiError(res, 'Nama tim sudah ada di daftar peserta event. Tolak pendaftaran duplikat.');
  }

  try {
    db.transaction(() => {
      if (status === 'approved') {
        const sortOrder = db.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 AS next FROM event_teams WHERE event_id=?')
          .get(registration.event_id).next;
        const teamResult = db.prepare('INSERT INTO event_teams(event_id,team_name,logo_name,sort_order) VALUES(?,?,?,?)')
          .run(registration.event_id, registration.team_name, registration.logo_name, sortOrder);
      }
      db.prepare(`UPDATE participant_registrations SET status=?,reviewed_at=CURRENT_TIMESTAMP
        WHERE id=? AND status='pending'`).run(status, id);
    })();
  } catch (error) {
    return next(error);
  }

  res.json({ ok: true, status });
});
app.get('/api/admin/events/:id/participants/export', requireAdmin, async (req, res, next) => {
  const eventId = Number(req.params.id);
  if (!Number.isInteger(eventId) || eventId < 1) return apiError(res, 'ID event tidak valid.');
  const event = db.prepare('SELECT title FROM events WHERE id=?').get(eventId);
  if (!event) return apiError(res, 'Event tidak ditemukan.', 404);
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Peserta');
    sheet.columns = [
      { header: 'Nama Tim', key: 'team_name', width: 36 },
      { header: 'Status', key: 'status', width: 20 },
      { header: 'Tanggal Daftar', key: 'created_at', width: 24 },
      { header: 'Logo Tim', key: 'logo', width: 18 }
    ];
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF80652E' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: 'A1', to: 'D1' };

    const registrations = db.prepare(`SELECT id,team_name,logo_name,status,created_at
      FROM participant_registrations WHERE event_id=? AND status IN ('pending','approved')
      ORDER BY created_at,id`).all(eventId);
    const registrationLogos = new Set(registrations.map(row => row.logo_name));
    const imported = db.prepare('SELECT team_name,logo_name FROM event_teams WHERE event_id=? ORDER BY sort_order,id')
      .all(eventId)
      .filter(team => !registrationLogos.has(team.logo_name))
      .map(team => ({ ...team, status: 'Peserta impor/manual', created_at: '' }));
    const rows = [...registrations, ...imported];
    for (const [index, participant] of rows.entries()) {
      const excelRow = index + 2;
      sheet.addRow({
        team_name: participant.team_name,
        status: participant.status === 'approved' ? 'Disetujui'
          : participant.status === 'pending' ? 'Menunggu persetujuan'
            : participant.status === 'rejected' ? 'Ditolak'
              : participant.status,
        created_at: participant.created_at
      }).height = 52;
      if (participant.logo_name) {
        const logoPath = path.join(TEAM_LOGOS_DIR, participant.logo_name);
        const buffer = await fs.promises.readFile(logoPath);
        const extension = path.extname(participant.logo_name).slice(1);
        const imageId = workbook.addImage({ buffer, extension });
        sheet.addImage(imageId, { tl: { col: 3, row: excelRow - 1 }, ext: { width: 64, height: 48 } });
      }
    }
    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `peserta-${event.title.replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').slice(0, 60)}.xlsx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`
    });
    res.send(Buffer.from(buffer));
  } catch (error) {
    next(error);
  }
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
async function removeLogoIfUnused(name) {
  if (!name) return;
  const referenced = db.prepare(`SELECT 1 FROM event_teams WHERE logo_name=?
    UNION ALL SELECT 1 FROM participant_registrations WHERE logo_name=?
    UNION ALL SELECT 1 FROM matches WHERE home_logo=? OR away_logo=? LIMIT 1`)
    .get(name, name, name, name);
  if (!referenced) await removeStoredLogo(name);
}

app.get('/api/admin/participants/template', requireAdmin, async (req, res, next) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const instructions = workbook.addWorksheet('Petunjuk');
    instructions.addRows([
      ['PANDUAN IMPOR PESERTA TIM'],
      ['Isi satu baris untuk setiap tim pada sheet Data. Jangan mengubah judul kolom.'],
      ['Masukkan satu logo PNG atau JPG ke kolom Logo Tim pada baris yang sama dengan nama tim.'],
      ['Untuk menambahkan gambar di Excel: Sisipkan > Gambar, lalu letakkan gambar di dalam sel kolom B pada baris tim tersebut.'],
      ['Impor mengganti seluruh daftar peserta tim pada event yang dipilih. Maksimal 200 tim dan 1 MB per logo.'],
      ['Simpan file sebagai .xlsx sebelum mengunggahnya melalui panel admin.']
    ]);
    instructions.getColumn(1).width = 110;
    instructions.getRow(1).font = { bold: true, size: 14 };
    const data = workbook.addWorksheet('Data');
    data.columns = [
      { header: 'Nama Tim', key: 'team_name', width: 36 },
      { header: 'Logo Tim', key: 'team_logo', width: 24 }
    ];
    data.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    data.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF80652E' } };
    data.getRow(2).height = 70;
    data.views = [{ state: 'frozen', ySplit: 1 }];
    data.autoFilter = { from: 'A1', to: 'B1' };
    const buffer = await workbook.xlsx.writeBuffer();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="template-peserta-tim.xlsx"'
    });
    res.send(Buffer.from(buffer));
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/events/:id/participants/import', requireAdmin, express.raw({
  type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  limit: '10mb'
}), async (req, res, next) => {
  const eventId = Number(req.params.id);
  if (!Number.isInteger(eventId) || eventId < 1) return apiError(res, 'ID event tidak valid.');
  if (!db.prepare('SELECT id FROM events WHERE id=?').get(eventId)) return apiError(res, 'Event tidak ditemukan.', 404);
  if (!Buffer.isBuffer(req.body)) return apiError(res, 'Unggah file Excel .xlsx yang valid.', 415);

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(req.body);
  } catch {
    return apiError(res, 'File Excel tidak dapat dibaca. Pastikan file berformat .xlsx yang valid.');
  }
  const sheet = workbook.getWorksheet('Data');
  if (!sheet) return apiError(res, 'Sheet "Data" tidak ditemukan. Gunakan template resmi dari panel admin.');
  if (sheet.actualRowCount > 201) return apiError(res, 'Maksimal 200 tim untuk satu event.');

  const normalizeHeader = value => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const headers = new Map();
  sheet.getRow(1).eachCell((cell, column) => headers.set(normalizeHeader(cell.value), column));
  const nameColumn = headers.get('namatim');
  const logoColumn = headers.get('logotim');
  if (nameColumn !== 1 || logoColumn !== 2) return apiError(res, 'Kolom pada sheet "Data" tidak lengkap atau berubah. Unduh dan gunakan template resmi.');

  const imageByRow = new Map();
  let totalImageBytes = 0;
  for (const image of sheet.getImages()) {
    const rowIndex = Math.floor(image.range.tl.row);
    const columnIndex = Math.floor(image.range.tl.col);
    const rowNumber = rowIndex + 1;
    if (rowIndex < 1 || columnIndex !== 1 || rowNumber > 201) {
      return apiError(res, 'Setiap logo harus ditempatkan di kolom B pada baris tim yang sesuai.');
    }
    if (imageByRow.has(rowNumber)) return apiError(res, `Baris ${rowNumber}: hanya satu logo yang boleh dipasang.`);

    const media = workbook.getImage(image.imageId);
    const extension = String(media?.extension || '').toLowerCase();
    const buffer = media?.buffer;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > 1024 * 1024) {
      return apiError(res, `Baris ${rowNumber}: logo wajib berukuran maksimal 1 MB.`);
    }
    const isPng = extension === 'png' && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = ['jpg', 'jpeg'].includes(extension) && buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
    if (!isPng && !isJpeg) return apiError(res, `Baris ${rowNumber}: gunakan logo PNG atau JPG yang valid.`);
    totalImageBytes += buffer.length;
    if (totalImageBytes > 8 * 1024 * 1024) return apiError(res, 'Ukuran gabungan logo maksimal 8 MB.');
    imageByRow.set(rowNumber, { buffer, extension: isPng ? 'png' : 'jpg' });
  }

  const entries = [];
  const seenNames = new Set();
  try {
    for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber++) {
      const value = sheet.getRow(rowNumber).getCell(nameColumn).value;
      if (value == null || value === '') {
        if (imageByRow.has(rowNumber)) return apiError(res, `Baris ${rowNumber}: nama tim belum diisi.`);
        continue;
      }
      if (typeof value !== 'string') return apiError(res, `Baris ${rowNumber}: nama tim harus berupa teks biasa.`);
      const name = cleanText(value, 100);
      if (!name || name !== value.trim()) return apiError(res, `Baris ${rowNumber}: nama tim wajib diisi dan maksimal 100 karakter.`);
      const normalizedName = name.replace(/\s+/g, ' ').toLocaleLowerCase('id-ID');
      if (seenNames.has(normalizedName)) return apiError(res, `Baris ${rowNumber}: nama tim duplikat.`);
      seenNames.add(normalizedName);
      const logo = imageByRow.get(rowNumber);
      if (!logo) return apiError(res, `Baris ${rowNumber}: logo tim belum dipasang di kolom B.`);
      entries.push({ name, ...logo });
    }
  } catch (error) {
    return apiError(res, `File Excel berisi data yang tidak didukung: ${error.message}`);
  }
  if (!entries.length) return apiError(res, 'Tidak ada data tim pada sheet "Data".');
  for (const rowNumber of imageByRow.keys()) {
    if (rowNumber > sheet.actualRowCount) return apiError(res, `Baris ${rowNumber}: logo tidak memiliki nama tim.`);
  }

  const filenames = entries.map(entry => `${randomUUID()}.${entry.extension}`);
  const oldLogos = db.prepare('SELECT logo_name FROM event_teams WHERE event_id=?').all(eventId).map(row => row.logo_name);
  try {
    for (let index = 0; index < entries.length; index++) {
      await fs.promises.writeFile(path.join(TEAM_LOGOS_DIR, filenames[index]), entries[index].buffer, { flag: 'wx' });
    }
    const saveParticipants = db.transaction(() => {
      db.prepare(`UPDATE participant_registrations SET status='replaced',reviewed_at=CURRENT_TIMESTAMP
        WHERE event_id=? AND status='approved'`).run(eventId);
      db.prepare('DELETE FROM event_teams WHERE event_id=?').run(eventId);
      const insert = db.prepare('INSERT INTO event_teams(event_id,team_name,logo_name,sort_order) VALUES(?,?,?,?)');
      entries.forEach((entry, index) => insert.run(eventId, entry.name, filenames[index], index));
    });
    saveParticipants();
  } catch (error) {
    await Promise.all(filenames.map(async filename => {
      try { await removeStoredLogo(filename); }
      catch (cleanupError) { console.error('Gagal membersihkan logo peserta yang tidak tersimpan:', cleanupError); }
    }));
    return next(error);
  }
  await Promise.all(oldLogos.map(async filename => {
    try { await removeLogoIfUnused(filename); }
    catch (error) { console.error('Gagal menghapus logo peserta lama:', error); }
  }));
  res.json({ ok: true, imported: entries.length });
});

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
      await removeLogoIfUnused(previousFilename);
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
    await removeLogoIfUnused(match.logo);
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
  const homePenaltyScore = b.home_penalty_score === '' || b.home_penalty_score == null ? null : Number(b.home_penalty_score);
  const awayPenaltyScore = b.away_penalty_score === '' || b.away_penalty_score == null ? null : Number(b.away_penalty_score);
  const phase = cleanText(b.phase || 'other', 20);
  const groupName = cleanText(b.group_name, 40);
  if (!validDate(matchDate) || !home || !away || home === away) return apiError(res, 'Tanggal dan dua nama tim wajib diisi. Nama tim harus berbeda.');
  if ((homeScore !== null && (!Number.isInteger(homeScore) || homeScore < 0 || homeScore > 99)) ||
      (awayScore !== null && (!Number.isInteger(awayScore) || awayScore < 0 || awayScore > 99))) return apiError(res, 'Skor harus berupa angka 0–99.');
  if ((homePenaltyScore !== null && (!Number.isInteger(homePenaltyScore) || homePenaltyScore < 0 || homePenaltyScore > 99)) ||
      (awayPenaltyScore !== null && (!Number.isInteger(awayPenaltyScore) || awayPenaltyScore < 0 || awayPenaltyScore > 99))) return apiError(res, 'Skor adu penalti harus berupa angka 0–99.');
  if (!['other', 'group', 'knockout'].includes(phase)) return apiError(res, 'Fase pertandingan tidak valid.');
  const eventId = b.event_id ? Number(b.event_id) : null;
  if (eventId && (!Number.isInteger(eventId) || !db.prepare('SELECT id FROM events WHERE id=?').get(eventId))) return apiError(res, 'Event yang dipilih tidak ditemukan.');
  const eventCategory = validEventCategory(eventId, b.event_category);
  if (eventCategory === null) return apiError(res, 'Kategori pertandingan tidak sesuai dengan kategori event yang dipilih.');
  if (phase === 'group' && (!eventId || !eventCategory)) {
    return apiError(res, 'Fase grup memerlukan event dan kategori.');
  }
  const status = cleanText(b.status || (homeScore !== null && awayScore !== null ? 'Selesai' : 'Terjadwal'), 30);
  if ((homeScore === null) !== (awayScore === null)) return apiError(res, 'Isi kedua skor pertandingan atau kosongkan keduanya.');
  if (status === 'Selesai' && (homeScore === null || awayScore === null)) return apiError(res, 'Pertandingan selesai harus memiliki kedua skor.');
  if (phase === 'knockout' && status === 'Selesai' && homeScore === awayScore &&
      (homePenaltyScore === null || awayPenaltyScore === null || homePenaltyScore === awayPenaltyScore)) {
    return apiError(res, 'Skor imbang di babak gugur harus diputuskan dengan skor adu penalti yang berbeda.');
  }
  if ((homePenaltyScore !== null || awayPenaltyScore !== null) &&
      (phase !== 'knockout' || homeScore === null || homeScore !== awayScore ||
       homePenaltyScore === null || awayPenaltyScore === null)) {
    return apiError(res, 'Skor adu penalti hanya diisi untuk skor imbang pada babak gugur.');
  }
  const homeLogo = getEventTeamLogo(eventId, home);
  const awayLogo = getEventTeamLogo(eventId, away);
  const info = db.prepare(`INSERT INTO matches(
    event_id,match_date,match_time,home_team,away_team,home_score,away_score,venue,status,round_name,event_category,phase,group_name,home_penalty_score,away_penalty_score,home_logo,away_logo
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    eventId, matchDate, cleanText(b.match_time,5), home, away, homeScore, awayScore,
    cleanText(b.venue,160), status, cleanText(b.round_name,100), eventCategory,
    phase, groupName, homePenaltyScore, awayPenaltyScore, homeLogo, awayLogo
  );
  const bracket = phase === 'group' ? getBracketProgress(eventId, eventCategory) : { generated: false, warning: '' };
  if (eventId && eventCategory) syncGeneratedBracket(eventId, eventCategory);
  res.status(201).json({ id: Number(info.lastInsertRowid), ...bracket });
});
app.put('/api/admin/matches/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const existing = Number.isInteger(id) && id > 0 ? db.prepare('SELECT * FROM matches WHERE id=?').get(id) : null;
  if (!existing) return apiError(res, 'Pertandingan tidak ditemukan.', 404);
  const generated = Boolean(existing.generated_bracket);
  const matchDate = cleanText(b.match_date, 10);
  const home = generated ? existing.home_team : cleanText(b.home_team, 100);
  const away = generated ? existing.away_team : cleanText(b.away_team, 100);
  const homeScore = b.home_score === '' || b.home_score == null ? null : Number(b.home_score);
  const awayScore = b.away_score === '' || b.away_score == null ? null : Number(b.away_score);
  const homePenaltyScore = b.home_penalty_score === '' || b.home_penalty_score == null ? null : Number(b.home_penalty_score);
  const awayPenaltyScore = b.away_penalty_score === '' || b.away_penalty_score == null ? null : Number(b.away_penalty_score);
  const phase = generated ? existing.phase : cleanText(b.phase || 'other', 20);
  const groupName = generated ? existing.group_name : cleanText(b.group_name, 40);
  const eventId = generated ? existing.event_id : (b.event_id ? Number(b.event_id) : null);
  const eventCategory = generated ? existing.event_category : validEventCategory(eventId, b.event_category);
  const status = cleanText(b.status || (homeScore !== null && awayScore !== null ? 'Selesai' : 'Terjadwal'), 30);
  if (!validDate(matchDate) || !home || !away || home === away) return apiError(res, 'Data pertandingan tidak valid.');
  if ((homeScore !== null && (!Number.isInteger(homeScore) || homeScore < 0 || homeScore > 99)) ||
      (awayScore !== null && (!Number.isInteger(awayScore) || awayScore < 0 || awayScore > 99))) return apiError(res, 'Skor harus berupa angka 0–99.');
  if ((homePenaltyScore !== null && (!Number.isInteger(homePenaltyScore) || homePenaltyScore < 0 || homePenaltyScore > 99)) ||
      (awayPenaltyScore !== null && (!Number.isInteger(awayPenaltyScore) || awayPenaltyScore < 0 || awayPenaltyScore > 99))) return apiError(res, 'Skor adu penalti harus berupa angka 0–99.');
  if (!generated && !['other', 'group', 'knockout'].includes(phase)) return apiError(res, 'Fase pertandingan tidak valid.');
  if (eventId && (!Number.isInteger(eventId) || !db.prepare('SELECT id FROM events WHERE id=?').get(eventId))) return apiError(res, 'Event yang dipilih tidak ditemukan.');
  if (eventCategory === null) return apiError(res, 'Kategori pertandingan tidak sesuai dengan kategori event yang dipilih.');
  if (phase === 'group' && (!eventId || !eventCategory)) {
    return apiError(res, 'Fase grup memerlukan event dan kategori.');
  }
  if ((homeScore === null) !== (awayScore === null)) return apiError(res, 'Isi kedua skor pertandingan atau kosongkan keduanya.');
  if (status === 'Selesai' && (homeScore === null || awayScore === null)) return apiError(res, 'Pertandingan selesai harus memiliki kedua skor.');
  if (phase === 'knockout' && status === 'Selesai' && homeScore === awayScore &&
      (homePenaltyScore === null || awayPenaltyScore === null || homePenaltyScore === awayPenaltyScore)) {
    return apiError(res, 'Skor imbang di babak gugur harus diputuskan dengan skor adu penalti yang berbeda.');
  }
  if ((homePenaltyScore !== null || awayPenaltyScore !== null) &&
      (phase !== 'knockout' || homeScore === null || homeScore !== awayScore ||
       homePenaltyScore === null || awayPenaltyScore === null)) {
    return apiError(res, 'Skor adu penalti hanya diisi untuk skor imbang pada babak gugur.');
  }
  if (status === 'Selesai') {
    for (const side of ['home', 'away']) {
      const sourceId = existing[`${side}_source_match_id`];
      if (sourceId && !matchWinner(db.prepare('SELECT * FROM matches WHERE id=?').get(sourceId))) {
        return apiError(res, 'Pertandingan babak gugur belum dapat diselesaikan karena pemenang babak sebelumnya belum tersedia.');
      }
    }
    if (generated && existing.home_qualifier_seed &&
        !getGroupMatches(eventId, eventCategory).every(isFinished)) {
      return apiError(res, 'Babak grup harus selesai sebelum hasil babak gugur dapat dimasukkan.');
    }
  }
  const oldEventId = existing.event_id;
  const oldCategory = existing.event_category;
  const homeLogo = generated ? existing.home_logo : resolveMatchLogo(eventId, home, existing, 'home');
  const awayLogo = generated ? existing.away_logo : resolveMatchLogo(eventId, away, existing, 'away');
  db.prepare(`UPDATE matches SET event_id=?,match_date=?,match_time=?,home_team=?,away_team=?,home_score=?,away_score=?,
    venue=?,status=?,round_name=?,event_category=?,phase=?,group_name=?,home_penalty_score=?,away_penalty_score=?,
    home_logo=?,away_logo=? WHERE id=?`)
    .run(eventId, matchDate, cleanText(b.match_time,5), home, away, homeScore, awayScore,
      cleanText(b.venue,160), status, generated ? existing.round_name : cleanText(b.round_name,100),
      eventCategory, phase, groupName, homePenaltyScore, awayPenaltyScore, homeLogo, awayLogo, id);
  for (const filename of [existing.home_logo, existing.away_logo]) {
    if (filename && filename !== homeLogo && filename !== awayLogo) {
      removeLogoIfUnused(filename).catch(error => console.error('Gagal menghapus logo pertandingan yang tidak terpakai:', error));
    }
  }
  const oldBracket = oldEventId && oldCategory && (oldEventId !== eventId || oldCategory !== eventCategory)
    ? getBracketProgress(oldEventId, oldCategory)
    : null;
  const bracket = phase === 'group' ? getBracketProgress(eventId, eventCategory) : { generated: false, warning: '' };
  if (oldEventId && oldCategory) syncGeneratedBracket(oldEventId, oldCategory);
  if (eventId && eventCategory) syncGeneratedBracket(eventId, eventCategory);
  res.json({ ok: true, ...(oldBracket && oldBracket.generated ? oldBracket : bracket) });
});
app.delete('/api/admin/matches/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return apiError(res, 'ID tidak valid.');
  const match = db.prepare('SELECT * FROM matches WHERE id=?').get(id);
  if (!match) return apiError(res, 'Pertandingan tidak ditemukan.', 404);
  if (match.generated_bracket) return apiError(res, 'Pertandingan bagan otomatis tidak dapat dihapus. Edit jadwal atau hasilnya.');
  const info = db.prepare('DELETE FROM matches WHERE id=?').run(id);
  if (match.phase === 'group' && match.event_id && match.event_category) {
    getBracketProgress(match.event_id, match.event_category);
    syncGeneratedBracket(match.event_id, match.event_category);
  }
  for (const filename of [match.home_logo, match.away_logo]) {
    removeLogoIfUnused(filename).catch(error => console.error('Gagal menghapus file logo pertandingan:', error));
  }
  res.json({ ok: true });
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const b = req.body || {};
  const allowed = ['contact_name','contact_phone','contact_phone_2','contact_email','venue','about'];
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
app.get('/daftar/:token', (req, res) => {
  if (!/^[a-f0-9]{48}$/.test(String(req.params.token || ''))) return res.status(404).send('Link pendaftaran tidak ditemukan.');
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  if (err.type === 'entity.too.large') return apiError(res, req.path.includes('/logos/') ? 'Ukuran setiap file logo maksimal 1 MB.' : req.path.includes('/participants/import') ? 'Ukuran file Excel maksimal 10 MB.' : 'Ukuran file maksimal 2 MB.', 413);
  if (err.status === 415) return apiError(res, 'Format file tidak didukung.', 415);
  res.status(500).json({ error: 'Terjadi kesalahan server. Periksa log aplikasi.' });
});

app.listen(PORT, () => console.log(`IFL Event website aktif di http://localhost:${PORT}`));
