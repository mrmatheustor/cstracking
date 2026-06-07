const { toSteamId64 } = require('./steamId');

function normalizeNameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ');
}

async function normalizePlayerSteamIds(db, apply) {
  const allStats = await db.all(
    `SELECT id, player_steamid FROM player_stats WHERE player_steamid IS NOT NULL AND player_steamid != ''`
  );

  let count = 0;
  for (const row of allStats) {
    const norm = toSteamId64(row.player_steamid);
    if (!norm || norm === row.player_steamid) continue;
    count += 1;
    if (apply) {
      await db.run(`UPDATE player_stats SET player_steamid = ? WHERE id = ?`, [norm, row.id]);
    }
  }
  return count;
}

function findStatBySteamId(stats, steamId) {
  const sid = toSteamId64(steamId);
  if (!sid) return null;
  return stats.find((s) => toSteamId64(s.player_steamid) === sid) || null;
}

function findStatByUsername(stats, username) {
  const key = normalizeNameKey(username);
  if (!key) return null;
  const hits = stats.filter((s) => normalizeNameKey(s.player_name) === key);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * @param {object} db - API do getDb()
 * @param {{ apply?: boolean }} options
 */
async function repairMatchOwners(db, options = {}) {
  const apply = !!options.apply;

  const dbPath = db.DB_PATH || process.env.DATA_DIR || './data';
  const normalizedStats = await normalizePlayerSteamIds(db, apply);

  const totalMatches = await db.get(`SELECT COUNT(*) AS c FROM matches WHERE finished = 1`);
  const usersWithSteam = await db.get(
    `SELECT COUNT(*) AS c FROM users WHERE steam_id IS NOT NULL AND steam_id != ''`
  );

  const matches = await db.all(`
    SELECT m.id, m.user_id, m.owner_steamid, m.map_name, m.updated_at,
           u.username, u.steam_id
    FROM matches m
    JOIN users u ON u.id = m.user_id
    WHERE m.finished = 1
    ORDER BY m.id
  `);

  const changes = [];
  const skipped = [];
  let fixed = 0;

  for (const match of matches) {
    const userSid = toSteamId64(match.steam_id);
    const stats = await db.all(
      `SELECT id, player_steamid, player_name, kills, deaths FROM player_stats WHERE match_id = ?`,
      [match.id]
    );

    if (!stats.length) {
      skipped.push({ matchId: match.id, reason: 'sem player_stats' });
      continue;
    }

    if (!userSid) {
      skipped.push({
        matchId: match.id,
        map: match.map_name,
        user: match.username,
        reason: 'conta sem steam_id — vincule Steam em Configurações',
      });
      continue;
    }

    let userStat = findStatBySteamId(stats, userSid);

    if (!userStat) {
      userStat = findStatByUsername(stats, match.username);
      if (userStat && apply) {
        await db.run(`UPDATE player_stats SET player_steamid = ? WHERE id = ?`, [
          userSid,
          userStat.id,
        ]);
        userStat.player_steamid = userSid;
      }
    }

    if (!userStat) {
      skipped.push({
        matchId: match.id,
        map: match.map_name,
        user: match.username,
        reason: 'seu Steam ID/nome não aparece no placar desta partida',
        players: stats.map((s) => s.player_name).join(', '),
      });
      continue;
    }

    const currentOwner = toSteamId64(match.owner_steamid);
    if (currentOwner === userSid) {
      continue;
    }

    const wrongName =
      stats.find((s) => toSteamId64(s.player_steamid) === currentOwner)?.player_name || '—';

    fixed += 1;
    changes.push({
      matchId: match.id,
      user: match.username,
      map: match.map_name,
      from: currentOwner || null,
      fromName: wrongName,
      to: userSid,
      toName: userStat.player_name,
    });

    if (apply) {
      await db.run(`UPDATE matches SET owner_steamid = ? WHERE id = ?`, [userSid, match.id]);
    }
  }

  return {
    apply,
    dbPath,
    summary: {
      totalFinishedMatches: totalMatches?.c || 0,
      usersWithSteam: usersWithSteam?.c || 0,
      scanned: matches.length,
      fixed,
      skipped: skipped.length,
      normalizedStats,
    },
    changes,
    skipped,
  };
}

module.exports = { repairMatchOwners, normalizePlayerSteamIds };
