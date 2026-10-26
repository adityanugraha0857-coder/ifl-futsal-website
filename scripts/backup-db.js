const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'ifl-events.sqlite');
if (!fs.existsSync(dbPath)) {
  console.error('Database belum ada. Jalankan server dan buat data terlebih dahulu.');
  process.exit(1);
}
const backupDir = path.join(dataDir, 'backups');
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(backupDir, `ifl-events-${stamp}.sqlite`);
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  db.backup(target).then(() => {
    console.log(`Backup berhasil dibuat: ${target}`);
    db.close();
  }).catch(err => {
    console.error('Backup gagal:', err.message);
    db.close();
    process.exitCode = 1;
  });
} catch (err) {
  console.error('Backup gagal:', err.message);
  db.close();
  process.exitCode = 1;
}
