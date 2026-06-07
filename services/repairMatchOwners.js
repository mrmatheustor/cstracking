const { toSteamId64 } = require('./steamId');

function normalizeNameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ');
}

function formatStatLine(stat) {
  const sid = toSteamId64(stat.player_steamid) || stat.player_steamid || '(vazio)';
  return `${stat.player_name || '?'} [${sid}]`;
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

/** Primeira linha inserida = payload.player do GSI (dono da sessão). */
function findStatByGsiOrder(stats) {
  if (!stats.length) return null;
  return stats.reduce((min, s) => (s.id < min.id ? s : min), stats[0]);
}

/**
 * Quando owner_steamid aponta para outro jogador, tenta achar a linha real do dono.
 */
function findStatWhenOwnerWrong(stats, userSid, ownerSid) {
  const gsiSelf = findStatByGsiOrder(stats);
  if (!gsiSelf) return null;

  const gsiSid = toSteamId64(gsiSelf.player_steamid);
  if (!gsiSid || gsiSid !== ownerSid) {
    return { stat: gsiSelf, method: 'gsi_player' };
  }

  const withoutOwner = stats.filter((s) => {
    const sid = toSteamId64(s.player_steamid);
    return !sid || sid !== ownerSid;
  });

  if (withoutOwner.length === 1) {
    return { stat: withoutOwner[0], method: 'unico_nao_owner' };
  }

  const emptySteam = withoutOwner.filter((s) => !toSteamId64(s.player_steamid));
  if (emptySteam.length === 1) {
    return { stat: emptySteam[0], method: 'steam_vazio' };
  }

  if (withoutOwner.length > 1) {
    const byOrder = findStatByGsiOrder(withoutOwner);
    if (byOrder && toSteamId64(byOrder.player_steamid) !== ownerSid) {
      return { stat: byOrder, method: 'gsi_excl_owner' };
    }
  }

  return null;
}

async function backfillStatSteamId(db, stat, userSid, apply) {
  if (!stat || !userSid) return;
  if (toSteamId64(stat.player_steamid) === userSid) return;
  if (apply) {
    await db.run(`UPDATE player_stats SET player_steamid = ? WHERE id = ?`, [userSid, stat.id]);
  }
  stat.player_steamid = userSid;
}

function resolveUserStatRow(stats, { userSid, username, ownerSid }) {
  if (!stats?.length) return null;

  let userStat = findStatBySteamId(stats, userSid);
  if (userStat) return { stat: userStat, method: 'steam_id' };

  userStat = findStatByUsername(stats, username);
  if (userStat) return { stat: userStat, method: 'username' };

  const owner = toSteamId64(ownerSid);
  if (userSid && owner && owner !== userSid) {
    const guess = findStatWhenOwnerWrong(stats, userSid, owner);
    if (guess) return guess;
  }

  return null;
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
      `SELECT id, player_steamid, player_name, kills, deaths FROM player_stats WHERE match_id = ? ORDER BY id ASC`,
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
        players: stats.map(formatStatLine).join(', '),
      });
      continue;
    }

    let userStat = null;
    let method = null;

    const resolved = resolveUserStatRow(stats, {
      userSid,
      username: match.username,
      ownerSid: match.owner_steamid,
    });
    if (resolved) {
      userStat = resolved.stat;
      method = resolved.method;
    }

    if (userStat && method !== 'steam_id') {
      await backfillStatSteamId(db, userStat, userSid, apply);
    }

    if (!userStat) {
      const soloForeign =
        stats.length === 1 &&
        userSid &&
        toSteamId64(stats[0].player_steamid) &&
        toSteamId64(stats[0].player_steamid) !== userSid;

      skipped.push({
        matchId: match.id,
        map: match.map_name,
        user: match.username,
        reason: soloForeign
          ? 'partida gravada só com stats de outro jogador — suas stats não foram salvas; apague ou jogue de novo após o deploy'
          : 'seu Steam ID/nome não aparece no placar desta partida',
        userSteam: userSid || null,
        players: stats.map(formatStatLine).join(', '),
        recoverable: false,
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
      method,
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

module.exports = {
  repairMatchOwners,
  normalizePlayerSteamIds,
  resolveUserStatRow,
};
