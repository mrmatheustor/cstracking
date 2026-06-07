/** Identifica a linha de estatísticas do dono da partida (conta GSI) via Steam ID. */

const { findPlayerStatBySteamIds, toSteamId64 } = require('./steamId');
const { resolveUserStatRow } = require('./repairMatchOwners');

function pickSelfStats(match, playerStats, options = {}) {
  const stats = playerStats || [];
  if (!stats.length) return null;

  const userSid = toSteamId64(options.userSteamId || match?.user_steam_id);
  const ownerSid = toSteamId64(match?.owner_steamid);

  if (userSid) {
    const byUser = findPlayerStatBySteamIds(stats, userSid);
    if (byUser) return byUser;

    const resolved = resolveUserStatRow(stats, {
      userSid,
      username: match?.owner_username || match?.username,
      ownerSid: match?.owner_steamid,
    });
    if (resolved?.stat) return resolved.stat;

    if (stats.length === 1) return stats[0];
    return match?.self_stat || null;
  }

  const byOwner = findPlayerStatBySteamIds(stats, ownerSid);
  if (byOwner) return byOwner;

  if (match?.self_stat) {
    const linked = findPlayerStatBySteamIds(
      stats,
      match.self_stat.player_steamid,
      ownerSid
    );
    if (linked) return linked;
  }

  if (stats.length === 1) return stats[0];
  return null;
}

function isSelfStatRow(match, player, options = {}) {
  if (!player) return false;
  const self = pickSelfStats(match, match?.player_stats || [player], options);
  if (!self) return false;
  if (self === player) return true;
  const a = toSteamId64(self.player_steamid);
  const b = toSteamId64(player.player_steamid);
  if (a && b && a === b) return true;
  return self.player_name === player.player_name;
}

function sortStatsForDisplay(stats, match, options = {}) {
  const copy = [...stats];
  copy.sort((a, b) => {
    const aSelf = isSelfStatRow({ ...match, player_stats: stats }, a, options);
    const bSelf = isSelfStatRow({ ...match, player_stats: stats }, b, options);
    if (aSelf !== bSelf) return aSelf ? -1 : 1;
    return (b.score || 0) - (a.score || 0) || (b.kills || 0) - (a.kills || 0);
  });
  return copy;
}

module.exports = { pickSelfStats, sortStatsForDisplay, isSelfStatRow };
