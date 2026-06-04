const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = process.argv[2];
const email = (process.argv[3] || '').trim().toLowerCase();

if (!dbPath || !email) {
  console.error('Uso: node scripts/get-gsi-token.js <db> <email>');
  process.exit(1);
}

const db = new sqlite3.Database(dbPath);
db.get('SELECT gsi_token, username FROM users WHERE email = ?', [email], (err, row) => {
  if (err) {
    console.error(err.message);
    process.exit(1);
  }
  if (!row) {
    console.error('EMAIL_NOT_FOUND');
    process.exit(2);
  }
  console.log(JSON.stringify(row));
  process.exit(0);
});
