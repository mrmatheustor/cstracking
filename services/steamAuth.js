const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { resolveGsiBaseUrl } = require('./gsiConfig');

const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';
const STEAM_ID_PATTERN = /\/openid\/id\/(\d+)$/;
const STEAM_SYNC_STALE_MS = 24 * 60 * 60 * 1000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

function resolveAppBaseUrl(req) {
  return resolveGsiBaseUrl(req);
}

function buildSteamProfileUrl(steamId) {
  if (!steamId) return null;
  return `https://steamcommunity.com/profiles/${steamId}`;
}

function buildSteamLoginUrl(req) {
  const base = resolveAppBaseUrl(req);
  const returnUrl = `${base}/api/auth/steam/callback`;
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnUrl,
    'openid.realm': `${base}/`,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return `${STEAM_OPENID_URL}?${params.toString()}`;
}

function extractSteamIdFromClaimedId(claimedId) {
  const match = String(claimedId || '').match(STEAM_ID_PATTERN);
  return match ? match[1] : null;
}

async function verifySteamOpenIdCallback(query) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (key.startsWith('openid.')) {
      body.append(key, value);
    }
  }
  body.set('openid.mode', 'check_authentication');

  const res = await fetch(STEAM_OPENID_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const text = await res.text();
  return /\bis_valid\s*:\s*true\b/i.test(text);
}

async function fetchSteamProfile(steamId) {
  const apiKey = (process.env.STEAM_API_KEY || '').trim();
  if (!apiKey) {
    return { personaname: null, avatarfull: null };
  }

  const url = new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('steamids', steamId);

  const res = await fetch(url);
  if (!res.ok) {
    return { personaname: null, avatarfull: null };
  }

  const data = await res.json();
  const player = data?.response?.players?.[0];
  return {
    personaname: player?.personaname || null,
    avatarfull: player?.avatarfull || null,
  };
}

function sanitizeUsername(name, steamId) {
  let base = String(name || '')
    .replace(/[^\w\s\-_.àáâãäåèéêëìíîïòóôõöùúûüçñÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÇÑ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 24);

  if (base.length < 3) {
    base = `Player ${String(steamId).slice(-6)}`;
  }
  return base;
}

async function pickUniqueUsername(db, baseName, steamId, excludeUserId = null) {
  let candidate = sanitizeUsername(baseName, steamId);
  let suffix = 0;

  while (true) {
    const taken = await db.get(
      excludeUserId
        ? `SELECT id FROM users WHERE username = ? AND id != ?`
        : `SELECT id FROM users WHERE username = ?`,
      excludeUserId ? [candidate, excludeUserId] : [candidate]
    );
    if (!taken) return candidate;
    suffix += 1;
    candidate = `${sanitizeUsername(baseName, steamId).slice(0, 18)}_${suffix}`;
  }
}

function steamPlaceholderEmail(steamId) {
  return `steam+${steamId}@login.cstracking`;
}

function isSteamPlaceholderEmail(email) {
  return /^steam\+\d+@login\.cstracking$/i.test(String(email || '').trim());
}

function randomPasswordHash() {
  const bcrypt = require('bcryptjs');
  const secret = crypto.randomBytes(32).toString('hex');
  return bcrypt.hash(secret, 10);
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  const pattern = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`);
  const match = raw.match(pattern);
  return match ? decodeURIComponent(match[1]) : null;
}

function setSteamLinkCookie(res, userId) {
  const token = jwt.sign({ sub: userId, purpose: 'steam_link' }, JWT_SECRET, { expiresIn: '10m' });
  res.setHeader(
    'Set-Cookie',
    `steam_link=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax`
  );
}

function clearSteamLinkCookie(res) {
  res.setHeader('Set-Cookie', 'steam_link=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
}

function readSteamLinkUserId(req) {
  const token = getCookie(req, 'steam_link');
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.purpose !== 'steam_link' || !decoded.sub) return null;
    return Number(decoded.sub);
  } catch {
    return null;
  }
}

function isSteamProfileStale(user) {
  if (!user?.steam_id) return false;
  if (!user.steam_profile_synced_at) return true;
  const synced = new Date(user.steam_profile_synced_at).getTime();
  if (Number.isNaN(synced)) return true;
  return Date.now() - synced > STEAM_SYNC_STALE_MS;
}

function publicSteamFields(user) {
  const linked = !!(user?.steam_id);
  return {
    steam_linked: linked,
    steam_profile_url: linked ? buildSteamProfileUrl(user.steam_id) : null,
  };
}

async function syncSteamProfileForUser(db, userId, options = {}) {
  const { syncUsername = false } = options;
  const user = await db.get(`SELECT * FROM users WHERE id = ?`, [userId]);
  if (!user?.steam_id) {
    return { user, synced: false, reason: 'no_steam_id' };
  }

  const profile = await fetchSteamProfile(user.steam_id);
  const updates = [];
  const params = [];

  const canUpdateAvatar = !user.avatar_url || user.avatar_from_steam;
  if (profile.avatarfull && canUpdateAvatar) {
    updates.push('avatar_url = ?');
    params.push(profile.avatarfull);
    updates.push('avatar_from_steam = 1');
  }

  if (syncUsername && profile.personaname) {
    const nextUsername = await pickUniqueUsername(db, profile.personaname, user.steam_id, userId);
    if (nextUsername !== user.username) {
      updates.push('username = ?');
      params.push(nextUsername);
    }
  }

  updates.push(`steam_profile_synced_at = datetime('now')`);

  if (updates.length) {
    params.push(userId);
    await db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
  }

  const updated = await db.get(`SELECT * FROM users WHERE id = ?`, [userId]);
  return {
    user: updated,
    synced: true,
    avatar_updated: !!(profile.avatarfull && canUpdateAvatar),
    username_updated: syncUsername && updates.some((u) => u.startsWith('username')),
    steam_persona: profile.personaname || null,
  };
}

async function maybeSyncStaleSteamProfile(db, user) {
  if (!isSteamProfileStale(user)) return user;
  const result = await syncSteamProfileForUser(db, user.id, { syncUsername: false });
  return result.user || user;
}

async function linkSteamToUser(db, userId, steamId, profile) {
  const user = await db.get(`SELECT * FROM users WHERE id = ?`, [userId]);
  if (!user) {
    const err = new Error('Usuário não encontrado');
    err.status = 404;
    throw err;
  }

  if (user.steam_id && user.steam_id === steamId) {
    await syncSteamProfileForUser(db, userId, { syncUsername: false });
    return db.get(`SELECT * FROM users WHERE id = ?`, [userId]);
  }

  if (user.steam_id && user.steam_id !== steamId) {
    const err = new Error('Esta conta já tem outra Steam vinculada');
    err.status = 409;
    throw err;
  }

  const other = await db.get(`SELECT id, username FROM users WHERE steam_id = ? AND id != ?`, [
    steamId,
    userId,
  ]);
  if (other) {
    const err = new Error(
      'Esta Steam já está em outra conta. Entre com Steam ou use aquela conta.'
    );
    err.status = 409;
    throw err;
  }

  await db.run(`UPDATE users SET steam_id = ? WHERE id = ?`, [steamId, userId]);
  await syncSteamProfileForUser(db, userId, { syncUsername: false });
  return db.get(`SELECT * FROM users WHERE id = ?`, [userId]);
}

module.exports = {
  STEAM_SYNC_STALE_MS,
  resolveAppBaseUrl,
  buildSteamProfileUrl,
  buildSteamLoginUrl,
  extractSteamIdFromClaimedId,
  verifySteamOpenIdCallback,
  fetchSteamProfile,
  pickUniqueUsername,
  steamPlaceholderEmail,
  isSteamPlaceholderEmail,
  randomPasswordHash,
  getCookie,
  setSteamLinkCookie,
  clearSteamLinkCookie,
  readSteamLinkUserId,
  isSteamProfileStale,
  publicSteamFields,
  syncSteamProfileForUser,
  maybeSyncStaleSteamProfile,
  linkSteamToUser,
};
