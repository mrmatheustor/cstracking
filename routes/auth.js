const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { signToken, authMiddleware } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const {
  resolveAppBaseUrl,
  buildSteamLoginUrl,
  extractSteamIdFromClaimedId,
  verifySteamOpenIdCallback,
  fetchSteamProfile,
  pickUniqueUsername,
  steamPlaceholderEmail,
  isSteamPlaceholderEmail,
  randomPasswordHash,
  setSteamLinkCookie,
  clearSteamLinkCookie,
  readSteamLinkUserId,
  syncSteamProfileForUser,
  linkSteamToUser,
} = require('../services/steamAuth');
const {
  isMergeableSteamAccount,
  setSteamMergeCookie,
  clearSteamMergeCookie,
  mergeSteamAccounts,
} = require('../services/steamMerge');

const router = express.Router();

function authUserPayload(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role || 'user',
    has_gsi: !!user.gsi_token,
    steam_id: user.steam_id || null,
    login_via_steam: !!user.login_via_steam,
    steam_linked: !!user.steam_id,
  };
}

function steamCallbackRedirect(req, token, errorCode) {
  const base = resolveAppBaseUrl(req);
  if (errorCode) {
    return `${base}/auth/steam?error=${encodeURIComponent(errorCode)}`;
  }
  return `${base}/auth/steam#token=${encodeURIComponent(token)}`;
}

function settingsRedirect(req, query) {
  const base = resolveAppBaseUrl(req);
  return `${base}/configuracoes?${query}`;
}

async function findOrCreateSteamUser(db, steamId, profile) {
  let user = await db.get(`SELECT * FROM users WHERE steam_id = ?`, [steamId]);

  if (user) {
    await syncSteamProfileForUser(db, user.id, { syncUsername: false });
    return db.get(`SELECT * FROM users WHERE id = ?`, [user.id]);
  }

  const username = await pickUniqueUsername(db, profile?.personaname, steamId);
  const email = steamPlaceholderEmail(steamId);
  const passwordHash = await randomPasswordHash();
  const gsiToken = uuidv4().replace(/-/g, '');
  const gsiAuthToken = uuidv4().replace(/-/g, '');

  const result = await db.run(
    `INSERT INTO users (username, email, password_hash, gsi_token, gsi_auth_token, steam_id, login_via_steam, avatar_url, avatar_from_steam, role, steam_profile_synced_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 'user', datetime('now'))`,
    [
      username,
      email,
      passwordHash,
      gsiToken,
      gsiAuthToken,
      steamId,
      profile?.avatarfull || null,
      profile?.avatarfull ? 1 : 0,
    ]
  );

  return db.get(`SELECT * FROM users WHERE id = ?`, [result.lastID]);
}

router.get(
  '/steam',
  asyncHandler(async (req, res) => {
    if (!(process.env.STEAM_API_KEY || '').trim()) {
      return res.status(503).json({
        error: 'Login Steam não configurado no servidor (STEAM_API_KEY ausente)',
      });
    }
    // Login pela home — não reutilizar cookie de “vincular Steam” de outra sessão.
    clearSteamLinkCookie(res);
    clearSteamMergeCookie(res);
    res.redirect(buildSteamLoginUrl(req));
  })
);

router.get(
  '/steam/link',
  authMiddleware,
  asyncHandler(async (req, res) => {
    if (!(process.env.STEAM_API_KEY || '').trim()) {
      return res.status(503).json({
        error: 'Login Steam não configurado no servidor (STEAM_API_KEY ausente)',
      });
    }

    const db = await getDb();
    const user = await db.get(`SELECT id, steam_id FROM users WHERE id = ?`, [req.user.id]);
    if (user?.steam_id) {
      return res.redirect(settingsRedirect(req, 'steam_link_error=already_linked'));
    }

    setSteamLinkCookie(res, req.user.id);
    res.redirect(buildSteamLoginUrl(req));
  })
);

function signInUserRedirect(req, user) {
  const token = signToken({
    id: user.id,
    username: user.username,
    role: user.role || 'user',
  });
  return steamCallbackRedirect(req, token);
}

router.get(
  '/steam/callback',
  asyncHandler(async (req, res) => {
    try {
      if (!(process.env.STEAM_API_KEY || '').trim()) {
        return res.redirect(steamCallbackRedirect(req, null, 'steam_not_configured'));
      }

      const valid = await verifySteamOpenIdCallback(req.query);
      if (!valid) {
        clearSteamLinkCookie(res);
        clearSteamMergeCookie(res);
        return res.redirect(steamCallbackRedirect(req, null, 'steam_auth_failed'));
      }

      const steamId = extractSteamIdFromClaimedId(
        req.query['openid.claimed_id'] || req.query['openid.identity']
      );
      if (!steamId) {
        clearSteamLinkCookie(res);
        clearSteamMergeCookie(res);
        return res.redirect(steamCallbackRedirect(req, null, 'steam_id_missing'));
      }

      const profile = await fetchSteamProfile(steamId);
      const db = await getDb();
      const linkUserId = readSteamLinkUserId(req);
      clearSteamLinkCookie(res);

      if (linkUserId) {
        const target = await db.get(`SELECT * FROM users WHERE id = ?`, [linkUserId]);

        // Conta já unificada — trata como login normal nesta conta.
        if (target?.steam_id === steamId) {
          clearSteamMergeCookie(res);
          await syncSteamProfileForUser(db, target.id, { syncUsername: false });
          const fresh = await db.get(`SELECT * FROM users WHERE id = ?`, [target.id]);
          return res.redirect(signInUserRedirect(req, fresh));
        }

        const other = await db.get(
          `SELECT id, username, email, login_via_steam, role, steam_id FROM users WHERE steam_id = ? AND id != ?`,
          [steamId, linkUserId]
        );

        if (other) {
          if (isMergeableSteamAccount(other)) {
            setSteamMergeCookie(res, {
              targetUserId: linkUserId,
              sourceUserId: other.id,
              steamId,
            });
            return res.redirect(
              settingsRedirect(
                req,
                `steam_merge_offer=1&from=${encodeURIComponent(other.username)}`
              )
            );
          }
          return res.redirect(settingsRedirect(req, 'steam_link_error=steam_already_used'));
        }

        try {
          const linked = await linkSteamToUser(db, linkUserId, steamId, profile);
          clearSteamMergeCookie(res);
          return res.redirect(signInUserRedirect(req, linked));
        } catch (err) {
          return res.redirect(settingsRedirect(req, 'steam_link_error=steam_link_failed'));
        }
      }

      clearSteamMergeCookie(res);
      const user = await findOrCreateSteamUser(db, steamId, profile);
      res.redirect(signInUserRedirect(req, user));
    } catch (err) {
      console.error('[Steam auth]', err.message);
      clearSteamLinkCookie(res);
      res.redirect(steamCallbackRedirect(req, null, 'steam_auth_error'));
    }
  })
);

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'username, email e password são obrigatórios' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });
    }

    const { run, get } = await getDb();
    const existing = await get(
      `SELECT id FROM users WHERE username = ? OR email = ?`,
      [username.trim(), email.trim().toLowerCase()]
    );

    if (existing) {
      return res.status(409).json({ error: 'Usuário ou e-mail já cadastrado' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const gsiToken = uuidv4().replace(/-/g, '');
    const gsiAuthToken = uuidv4().replace(/-/g, '');

    const emailNorm = email.trim().toLowerCase();
    const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const role = adminEmail && emailNorm === adminEmail ? 'admin' : 'user';

    const result = await run(
      `INSERT INTO users (username, email, password_hash, gsi_token, gsi_auth_token, role) VALUES (?, ?, ?, ?, ?, ?)`,
      [username.trim(), emailNorm, passwordHash, gsiToken, gsiAuthToken, role]
    );

    const token = signToken({ id: result.lastID, username: username.trim(), role });

    res.status(201).json({
      message: 'Cadastro realizado',
      token,
      user: authUserPayload({
        id: result.lastID,
        username: username.trim(),
        email: emailNorm,
        role,
        gsi_token: gsiToken,
        login_via_steam: 0,
      }),
    });
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'email e password são obrigatórios' });
    }

    const { get } = await getDb();
    const emailNorm = email.trim().toLowerCase();
    const user = await get(`SELECT * FROM users WHERE email = ?`, [emailNorm]);

    if (!user) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    if (isSteamPlaceholderEmail(user.email)) {
      return res.status(400).json({ error: 'Esta conta usa login Steam. Clique em Entrar com Steam.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const role = user.role || 'user';
    const token = signToken({ id: user.id, username: user.username, role });

    res.json({
      token,
      user: authUserPayload(user),
    });
  })
);

module.exports = router;
