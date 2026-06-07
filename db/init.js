const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'cstracking.db');

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function initDatabase() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const db = new sqlite3.Database(DB_PATH);
  console.log(`[DB] SQLite: ${DB_PATH}`);

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      gsi_token TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      match_key TEXT NOT NULL,
      map_name TEXT,
      map_phase TEXT,
      score_ct INTEGER DEFAULT 0,
      score_t INTEGER DEFAULT 0,
      finished INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, match_key)
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS player_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL,
      player_steamid TEXT,
      player_name TEXT,
      kills INTEGER DEFAULT 0,
      assists INTEGER DEFAULT 0,
      deaths INTEGER DEFAULT 0,
      mvps INTEGER DEFAULT 0,
      score INTEGER DEFAULT 0,
      FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
    )`
  );

  await run(db, `CREATE INDEX IF NOT EXISTS idx_matches_user ON matches(user_id)`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_player_stats_match ON player_stats(match_id)`);

  const userCols = await all(db, `PRAGMA table_info(users)`);
  if (!userCols.some((c) => c.name === 'role')) {
    await run(db, `ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`);
  }

  let matchCols = await all(db, `PRAGMA table_info(matches)`);
  if (!matchCols.some((c) => c.name === 'game_mode')) {
    await run(db, `ALTER TABLE matches ADD COLUMN game_mode TEXT DEFAULT 'unknown'`);
  }
  if (!matchCols.some((c) => c.name === 'owner_steamid')) {
    await run(db, `ALTER TABLE matches ADD COLUMN owner_steamid TEXT`);
  }
  if (!matchCols.some((c) => c.name === 'room_id')) {
    await run(db, `ALTER TABLE matches ADD COLUMN room_id INTEGER REFERENCES match_rooms(id) ON DELETE SET NULL`);
  }
  matchCols = await all(db, `PRAGMA table_info(matches)`);
  if (!matchCols.some((c) => c.name === 'owner_team')) {
    await run(db, `ALTER TABLE matches ADD COLUMN owner_team TEXT`);
  }

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS match_rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      host_user_id INTEGER NOT NULL,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      closed_at TEXT,
      FOREIGN KEY (host_user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS match_room_members (
      room_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (room_id, user_id),
      FOREIGN KEY (room_id) REFERENCES match_rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  );

  await run(db, `CREATE INDEX IF NOT EXISTS idx_matches_room ON matches(room_id)`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_rooms_code ON match_rooms(code)`);

  let roomCols = await all(db, `PRAGMA table_info(match_rooms)`);
  if (!roomCols.some((c) => c.name === 'map_name')) {
    await run(db, `ALTER TABLE match_rooms ADD COLUMN map_name TEXT`);
  }
  roomCols = await all(db, `PRAGMA table_info(match_rooms)`);
  if (!roomCols.some((c) => c.name === 'lobby_password')) {
    await run(db, `ALTER TABLE match_rooms ADD COLUMN lobby_password TEXT`);
  }
  roomCols = await all(db, `PRAGMA table_info(match_rooms)`);
  if (!roomCols.some((c) => c.name === 'join_password_hash')) {
    await run(db, `ALTER TABLE match_rooms ADD COLUMN join_password_hash TEXT`);
  }

  const userColsSteam = await all(db, `PRAGMA table_info(users)`);
  if (!userColsSteam.some((c) => c.name === 'steam_id')) {
    await run(db, `ALTER TABLE users ADD COLUMN steam_id TEXT`);
  }

  let userColsRating = await all(db, `PRAGMA table_info(users)`);
  if (!userColsRating.some((c) => c.name === 'mmr')) {
    await run(db, `ALTER TABLE users ADD COLUMN mmr INTEGER NOT NULL DEFAULT 1000`);
  }
  userColsRating = await all(db, `PRAGMA table_info(users)`);
  if (!userColsRating.some((c) => c.name === 'level_xp')) {
    await run(db, `ALTER TABLE users ADD COLUMN level_xp INTEGER NOT NULL DEFAULT 0`);
  }
  userColsRating = await all(db, `PRAGMA table_info(users)`);
  if (!userColsRating.some((c) => c.name === 'rated_wins')) {
    await run(db, `ALTER TABLE users ADD COLUMN rated_wins INTEGER NOT NULL DEFAULT 0`);
  }
  userColsRating = await all(db, `PRAGMA table_info(users)`);
  if (!userColsRating.some((c) => c.name === 'rated_losses')) {
    await run(db, `ALTER TABLE users ADD COLUMN rated_losses INTEGER NOT NULL DEFAULT 0`);
  }
  userColsRating = await all(db, `PRAGMA table_info(users)`);
  if (!userColsRating.some((c) => c.name === 'avatar_icon')) {
    await run(db, `ALTER TABLE users ADD COLUMN avatar_icon TEXT NOT NULL DEFAULT 'default'`);
  }
  userColsRating = await all(db, `PRAGMA table_info(users)`);
  if (!userColsRating.some((c) => c.name === 'avatar_url')) {
    await run(db, `ALTER TABLE users ADD COLUMN avatar_url TEXT`);
  }

  let userColsGsi = await all(db, `PRAGMA table_info(users)`);
  if (!userColsGsi.some((c) => c.name === 'gsi_auth_token')) {
    await run(db, `ALTER TABLE users ADD COLUMN gsi_auth_token TEXT`);
  }
  const { v4: uuidv4 } = require('uuid');
  const usersNeedGsiAuth = await all(
    db,
    `SELECT id FROM users WHERE gsi_auth_token IS NULL OR gsi_auth_token = ''`
  );
  for (const row of usersNeedGsiAuth) {
    await run(db, `UPDATE users SET gsi_auth_token = ? WHERE id = ?`, [
      uuidv4().replace(/-/g, ''),
      row.id,
    ]);
  }

  let userColsSteamLogin = await all(db, `PRAGMA table_info(users)`);
  if (!userColsSteamLogin.some((c) => c.name === 'login_via_steam')) {
    await run(db, `ALTER TABLE users ADD COLUMN login_via_steam INTEGER NOT NULL DEFAULT 0`);
  }

  await run(
    db,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_steam_id ON users(steam_id) WHERE steam_id IS NOT NULL AND steam_id != ''`
  );

  let userColsAvatarSteam = await all(db, `PRAGMA table_info(users)`);
  if (!userColsAvatarSteam.some((c) => c.name === 'avatar_from_steam')) {
    await run(db, `ALTER TABLE users ADD COLUMN avatar_from_steam INTEGER NOT NULL DEFAULT 0`);
  }
  userColsAvatarSteam = await all(db, `PRAGMA table_info(users)`);
  if (!userColsAvatarSteam.some((c) => c.name === 'steam_profile_synced_at')) {
    await run(db, `ALTER TABLE users ADD COLUMN steam_profile_synced_at TEXT`);
  }

  matchCols = await all(db, `PRAGMA table_info(matches)`);
  if (!matchCols.some((c) => c.name === 'rating_applied')) {
    await run(db, `ALTER TABLE matches ADD COLUMN rating_applied INTEGER NOT NULL DEFAULT 0`);
  }

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS rating_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      match_id INTEGER NOT NULL UNIQUE,
      won INTEGER NOT NULL,
      performance REAL,
      opponent_mmr INTEGER,
      mmr_before INTEGER NOT NULL,
      mmr_delta INTEGER NOT NULL,
      mmr_after INTEGER NOT NULL,
      xp_before INTEGER NOT NULL,
      xp_delta INTEGER NOT NULL,
      xp_after INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
    )`
  );
  await run(db, `CREATE INDEX IF NOT EXISTS idx_rating_events_user ON rating_events(user_id)`);

  const adminEmails = [
    (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
    'mrmatheustor@gmail.com',
  ].filter(Boolean);

  const uniqueAdminEmails = [...new Set(adminEmails)];
  for (const email of uniqueAdminEmails) {
    await run(db, `UPDATE users SET role = 'admin' WHERE email = ?`, [email]);
  }

  return {
    db,
    run: (sql, params = []) => run(db, sql, params),
    get: (sql, params = []) => get(db, sql, params),
    all: (sql, params = []) => all(db, sql, params),
    DB_PATH,
  };
}

module.exports = { initDatabase, DB_PATH };
