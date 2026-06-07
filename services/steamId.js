/** Normaliza Steam ID / account ID para SteamID64 comparável. */

const STEAM64_BASE = 76561197960265728n;

function toSteamId64(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';

  if (/^7656119[0-9]{10}$/.test(s)) return s;

  if (/^\d+$/.test(s)) {
    try {
      const n = BigInt(s);
      if (n < STEAM64_BASE) return String(STEAM64_BASE + n);
      return s;
    } catch {
      return s;
    }
  }

  const legacy = s.match(/^STEAM_[0-5]:([01]):(\d+)$/i);
  if (legacy) {
    const y = BigInt(legacy[1]);
    const z = BigInt(legacy[2]);
    return String(STEAM64_BASE + z * 2n + y);
  }

  const steam3 = s.match(/^\[U:1:(\d+)\]$/i);
  if (steam3) {
    return String(STEAM64_BASE + BigInt(steam3[1]));
  }

  return s;
}

function steamIdsEqual(a, b) {
  const left = toSteamId64(a);
  const right = toSteamId64(b);
  if (!left || !right) return false;
  return left === right;
}

function findPlayerStatBySteamIds(stats, ...ids) {
  const ordered = ids.map(toSteamId64).filter(Boolean);
  const unique = [...new Set(ordered)];
  if (!unique.length || !stats?.length) return null;

  for (const id of unique) {
    for (const stat of stats) {
      const sid = toSteamId64(stat.player_steamid);
      if (sid && sid === id) return stat;
    }
  }

  return null;
}

module.exports = { toSteamId64, steamIdsEqual, findPlayerStatBySteamIds };
