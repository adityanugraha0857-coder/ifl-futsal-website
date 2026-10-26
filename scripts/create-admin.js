require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'ifl-events.sqlite'));
db.exec(`CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(resolve => rl.question(q, resolve));
(async () => {
  try {
    const username = (process.env.ADMIN_USERNAME || await ask('Username admin: ')).trim();
    const password = process.env.ADMIN_PASSWORD || await ask('Password admin (minimal 12 karakter): ');
    if (!username || password.length < 12) throw new Error('Username wajib diisi dan password minimal 12 karakter.');
    const hash = bcrypt.hashSync(password, 12);
    db.prepare(`INSERT INTO admins(username,password_hash) VALUES(?,?) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash`).run(username, hash);
    console.log(`Admin "${username}" berhasil disiapkan.`);
  } catch (e) { console.error(e.message); process.exitCode = 1; }
  finally { db.close(); rl.close(); }
})();
