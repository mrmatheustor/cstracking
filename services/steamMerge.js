const jwt = require('jsonwebtoken');
const {
  isSteamPlaceholderEmail,
  syncSteamProfileForUser,
  publicSteamFields,
} = require('./steamAuth');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

function isMergeableSteamAccount(user) {
  if (!user) return false;
  if (user.role === 'admin') return false;
  return !!user.login_via_steam || isSteamPlaceholderEmail(user.email);
}

function setSteamMergeCookie(res, payload) {
  const token = jwt.sign(
    {
      purpose: 'steam_merge',
      targetUserId: payload.targetUserId,
      sourceUserId: payload.sourceUserId,
      steamId: payload.steamId,
    },
    JWT_SECRET,
    { expiresIn: '15m' }
  );
  res.setHeader(
    'Set-Cookie',
    `steam_merge=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=900; SameSite=Lax`
  );
}

function clearSteamMergeCookie(res) {
  res.setHeader('Set-Cookie', 'steam_merge=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
}

function readSteamMergePending(req) {
  const raw = req.headers.cookie || '';
  const match = raw.match(/(?:^|;\s*)steam_merge=([^;]*)/);
  if (!match) return null;
  try {
    const decoded = jwt.verify(decodeURIComponent(match[1]), JWT_SECRET);
    if (decoded.purpose !== 'steam_merge') return null;
    return {
      targetUserId: Number(decoded.targetUserId),
      sourceUserId: Number(decoded.sourceUserId),
      steamId: String(decoded.steamId),
    };
  } catch {
    return null;
  }
}

async function mergeSteamAccounts(db, targetUserId, sourceUserId, steamId) {
  const target = await db.get(`SELECT * FROM users WHERE id = ?`, [targetUserId]);
  const source = await db.get(`SELECT * FROM users WHERE id = ?`, [sourceUserId]);

  if (!target || !source) {
    const err = new Error('Conta não encontrada');
    err.status = 404;
    throw err;
  }

  if (source.id === target.id) {
    const err = new Error('Não é possível unir a mesma conta');
    err.status = 400;
    throw err;
  }

  if (source.steam_id !== steamId) {
    const err = new Error('Steam ID não confere com a conta de origem');
    err.status = 409;
    throw err;
  }

  if (!isMergeableSteamAccount(source)) {
    const err = new Error(
      'A outra conta não pode ser unida automaticamente. Use o login Steam ou contate o suporte.'
    );
    err.status = 409;
    throw err;
  }

  if (target.steam_id && target.steam_id !== steamId) {
    const err = new Error('Esta conta já tem outra Steam vinculada');
    err.status = 409;
    throw err;
  }

  await db.run('BEGIN');
  const sourceMatches = await db.all(
    `SELECT id, match_key FROM matches WHERE user_id = ?`,
    [sourceUserId]
  );

  try {
    for (const match of sourceMatches) {
      const clash = await db.get(
        `SELECT id FROM matches WHERE user_id = ? AND match_key = ?`,
        [targetUserId, match.match_key]
      );
      if (clash) {
        await db.run(`DELETE FROM matches WHERE id = ?`, [match.id]);
      } else {
        await db.run(`UPDATE matches SET user_id = ? WHERE id = ?`, [targetUserId, match.id]);
      }
    }

    await db.run(`UPDATE rating_events SET user_id = ? WHERE user_id = ?`, [
      targetUserId,
      sourceUserId,
    ]);

    await db.run(`UPDATE match_rooms SET host_user_id = ? WHERE host_user_id = ?`, [
      targetUserId,
      sourceUserId,
    ]);

    const memberships = await db.all(
      `SELECT room_id FROM match_room_members WHERE user_id = ?`,
      [sourceUserId]
    );
    for (const row of memberships) {
      await db.run(`INSERT OR IGNORE INTO match_room_members (room_id, user_id) VALUES (?, ?)`, [
        row.room_id,
        targetUserId,
      ]);
    }
    await db.run(`DELETE FROM match_room_members WHERE user_id = ?`, [sourceUserId]);

    const nextMmr = Math.max(target.mmr || 1000, source.mmr || 1000);
    const nextAvatar = target.avatar_url || source.avatar_url || null;
    const avatarFromSteam =
      !target.avatar_url && source.avatar_url && source.avatar_from_steam
        ? 1
        : target.avatar_from_steam;

    // Libera steam_id na conta de origem antes de vincular na destino (UNIQUE).
    await db.run(`UPDATE users SET steam_id = NULL WHERE id = ?`, [sourceUserId]);

    const keepEmailLogin = !isSteamPlaceholderEmail(target.email);

    await db.run(
      `UPDATE users SET
        steam_id = ?,
        login_via_steam = ?,
        rated_wins = rated_wins + ?,
        rated_losses = rated_losses + ?,
        level_xp = level_xp + ?,
        mmr = ?,
        avatar_url = ?,
        avatar_from_steam = ?
       WHERE id = ?`,
      [
        steamId,
        keepEmailLogin ? 0 : target.login_via_steam,
        source.rated_wins || 0,
        source.rated_losses || 0,
        source.level_xp || 0,
        nextMmr,
        nextAvatar,
        avatarFromSteam,
        targetUserId,
      ]
    );

    await db.run(`DELETE FROM users WHERE id = ?`, [sourceUserId]);
    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }

  await syncSteamProfileForUser(db, targetUserId, { syncUsername: false });
  const merged = await db.get(`SELECT * FROM users WHERE id = ?`, [targetUserId]);

  return {
    user: merged,
    merged_from_username: source.username,
    matches_moved: sourceMatches.length,
    ...publicSteamFields(merged),
  };
}

module.exports = {
  isMergeableSteamAccount,
  setSteamMergeCookie,
  clearSteamMergeCookie,
  readSteamMergePending,
  mergeSteamAccounts,
};
