const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { authMiddleware, signToken } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const profileStats = require('../services/profileStats');
const dashboardStats = require('../services/dashboardStats');
const roomService = require('../services/roomService');
const { toPublicProfile } = require('../services/publicProfile');
const { getPublicRank, getAdminRating } = require('../services/playerRating');
const { buildInstallerBat, CFG_NAME } = require('../services/gsiInstaller');
const { resolveGsiBaseUrl, buildGsiUri, buildGsiCfgContent } = require('../services/gsiConfig');
const liveStore = require('../services/gsiLiveStore');
const avatarStorage = require('../services/avatarStorage');
const { isSteamPlaceholderEmail, maybeSyncStaleSteamProfile, syncSteamProfileForUser, publicSteamFields, buildSteamLoginUrl, setSteamLinkCookie } = require('../services/steamAuth');
const { readSteamMergePending, clearSteamMergeCookie, mergeSteamAccounts } = require('../services/steamMerge');

const router = express.Router();
const GSI_CONNECTED_MS = 120000;

async function getGsiUser(db, userId) {
  return db.get(
    `SELECT gsi_token, gsi_auth_token, username FROM users WHERE id = ?`,
    [userId]
  );
}

router.get(
  '/profile',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    let user = await db.get(
      `SELECT id, username, email, gsi_token, role, steam_id, avatar_url, avatar_from_steam, created_at, login_via_steam, steam_profile_synced_at FROM users WHERE id = ?`,
      [req.user.id]
    );

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    user = await maybeSyncStaleSteamProfile(db, user);

    const baseUrl = resolveGsiBaseUrl(req);

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: isSteamPlaceholderEmail(user.email) ? null : user.email,
        role: user.role,
        avatar_url: user.avatar_url || null,
        avatar_from_steam: !!user.avatar_from_steam,
        created_at: user.created_at,
        has_gsi: !!user.gsi_token,
        login_via_steam: !!user.login_via_steam,
        gsi_base_url: baseUrl,
        steam_profile_synced_at: user.steam_profile_synced_at || null,
        ...publicSteamFields(user),
      },
    });
  })
);

router.post(
  '/link-steam',
  authMiddleware,
  asyncHandler(async (req, res) => {
    if (!(process.env.STEAM_API_KEY || '').trim()) {
      return res.status(503).json({
        error: 'Login Steam não configurado no servidor (STEAM_API_KEY ausente)',
      });
    }

    const db = await getDb();
    const user = await db.get(`SELECT id, steam_id FROM users WHERE id = ?`, [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    if (user.steam_id) {
      return res.status(409).json({ error: 'Esta conta já tem Steam vinculada' });
    }

    setSteamLinkCookie(res, req.user.id);
    res.json({ redirect: buildSteamLoginUrl(req) });
  })
);

router.get(
  '/merge-steam/pending',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const pending = readSteamMergePending(req);
    if (!pending || pending.targetUserId !== req.user.id) {
      return res.json({ pending: false });
    }

    const db = await getDb();
    const source = await db.get(`SELECT id, username FROM users WHERE id = ?`, [pending.sourceUserId]);
    if (!source) {
      clearSteamMergeCookie(res);
      return res.json({ pending: false });
    }

    res.json({
      pending: true,
      source_username: source.username,
      steam_id: pending.steamId,
    });
  })
);

router.post(
  '/merge-steam',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const pending = readSteamMergePending(req);
    if (!pending || pending.targetUserId !== req.user.id) {
      return res.status(400).json({
        error: 'Nenhuma união pendente. Clique em Vincular Steam e confirme na Steam novamente.',
      });
    }

    const db = await getDb();
    const target = await db.get(`SELECT * FROM users WHERE id = ?`, [req.user.id]);
    if (!target) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const needsPassword = !target.login_via_steam && !isSteamPlaceholderEmail(target.email);
    if (needsPassword) {
      const { current_password } = req.body || {};
      if (!current_password) {
        return res.status(400).json({ error: 'Informe sua senha para confirmar a união das contas' });
      }
      const valid = await bcrypt.compare(String(current_password), target.password_hash);
      if (!valid) {
        return res.status(403).json({ error: 'Senha incorreta' });
      }
    }

    try {
      const result = await mergeSteamAccounts(
        db,
        pending.targetUserId,
        pending.sourceUserId,
        pending.steamId
      );
      clearSteamMergeCookie(res);
      const token = signToken({
        id: result.user.id,
        username: result.user.username,
        role: result.user.role || 'user',
      });
      res.json({
        message: `Contas unidas. A conta "${result.merged_from_username}" foi incorporada aqui. E-mail e Steam entram na mesma conta.`,
        merged_from_username: result.merged_from_username,
        token,
        user: {
          id: result.user.id,
          username: result.user.username,
          avatar_url: result.user.avatar_url || null,
          steam_profile_synced_at: result.user.steam_profile_synced_at,
          steam_linked: true,
          login_via_steam: !!result.user.login_via_steam,
          ...publicSteamFields(result.user),
        },
      });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'Falha ao unir contas' });
    }
  })
);

router.post(
  '/sync-steam',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const user = await db.get(`SELECT id, steam_id FROM users WHERE id = ?`, [req.user.id]);
    if (!user?.steam_id) {
      return res.status(400).json({ error: 'Nenhuma Steam vinculada a esta conta' });
    }

    const syncUsername = !!req.body?.sync_username;
    const result = await syncSteamProfileForUser(db, user.id, { syncUsername });

    res.json({
      message: 'Perfil Steam atualizado',
      avatar_updated: result.avatar_updated,
      username_updated: result.username_updated,
      steam_persona: result.steam_persona,
      user: {
        id: result.user.id,
        username: result.user.username,
        avatar_url: result.user.avatar_url || null,
        avatar_from_steam: !!result.user.avatar_from_steam,
        steam_profile_synced_at: result.user.steam_profile_synced_at,
        ...publicSteamFields(result.user),
      },
    });
  })
);

router.get(
  '/gsi-status',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const lastAt = liveStore.getLastGsiAt(req.user.id);
    const lastInGame = liveStore.getLastInGameAt(req.user.id);
    const now = Date.now();

    res.json({
      gsi_connected: !!(lastAt && now - lastAt < GSI_CONNECTED_MS),
      in_game: !!(lastInGame && now - lastInGame < GSI_CONNECTED_MS),
      last_gsi_at: lastAt ? new Date(lastAt).toISOString() : null,
      live_match: !!liveStore.getLiveMatch(req.user.id),
    });
  })
);

router.post(
  '/avatar',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const image = req.body?.image;
    if (!image) {
      return res.status(400).json({ error: 'Envie uma imagem' });
    }

    let avatar_url;
    try {
      avatar_url = avatarStorage.saveFromDataUrl(req.user.id, image);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }

    const { run } = await getDb();
    await run(`UPDATE users SET avatar_url = ?, avatar_from_steam = 0 WHERE id = ?`, [
      avatar_url,
      req.user.id,
    ]);
    res.json({ avatar_url, avatar_version: Date.now() });
  })
);

router.delete(
  '/avatar',
  authMiddleware,
  asyncHandler(async (req, res) => {
    avatarStorage.deleteForUser(req.user.id);
    const { run } = await getDb();
    await run(`UPDATE users SET avatar_url = NULL, avatar_from_steam = 0 WHERE id = ?`, [
      req.user.id,
    ]);
    res.json({ avatar_url: null, avatar_version: Date.now() });
  })
);

router.get(
  '/gsi-preview',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const user = await getGsiUser(db, req.user.id);

    if (!user?.gsi_token) {
      return res.status(404).json({ error: 'Token GSI não encontrado' });
    }

    const baseUrl = resolveGsiBaseUrl(req);
    const cfg_content = buildGsiCfgContent(user.gsi_token, baseUrl, user.gsi_auth_token);

    res.json({
      cfg_name: CFG_NAME,
      cfg_content,
      cfg_folder: 'game/csgo/cfg',
      uri_host: baseUrl,
      has_auth: !!user.gsi_auth_token,
    });
  })
);

router.post(
  '/regenerate-gsi',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const { current_password } = req.body || {};
    const db = await getDb();
    const user = await db.get(`SELECT * FROM users WHERE id = ?`, [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const steamOnly = !!user.login_via_steam;
    if (!steamOnly) {
      if (!current_password) {
        return res.status(400).json({ error: 'Informe a senha atual para regenerar o GSI' });
      }
      const valid = await bcrypt.compare(String(current_password), user.password_hash);
      if (!valid) {
        return res.status(403).json({ error: 'Senha atual incorreta' });
      }
    }

    const gsiToken = uuidv4().replace(/-/g, '');
    const gsiAuthToken = uuidv4().replace(/-/g, '');

    await db.run(`UPDATE users SET gsi_token = ?, gsi_auth_token = ? WHERE id = ?`, [
      gsiToken,
      gsiAuthToken,
      user.id,
    ]);

    res.json({
      message: 'Credenciais GSI regeneradas. Baixe e instale o novo .cfg no CS2.',
      regenerated: true,
    });
  })
);

router.get(
  '/install-gsi.cfg',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const user = await getGsiUser(db, req.user.id);

    if (!user?.gsi_token) {
      return res.status(404).json({ error: 'Token GSI não encontrado' });
    }

    const baseUrl = resolveGsiBaseUrl(req);
    const cfg = buildGsiCfgContent(user.gsi_token, baseUrl, user.gsi_auth_token);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${CFG_NAME}"`);
    res.send(Buffer.from(cfg, 'utf8'));
  })
);

router.get(
  '/install-gsi.bat',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const user = await getGsiUser(db, req.user.id);

    if (!user?.gsi_token) {
      return res.status(404).json({ error: 'Token GSI não encontrado' });
    }

    const baseUrl = resolveGsiBaseUrl(req);
    const bat = buildInstallerBat(user.gsi_token, baseUrl, user.gsi_auth_token);
    const safeName = (user.username || 'jogador').replace(/[^\w\-]+/g, '_');

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Instalar-CS2Tracking-${safeName}.bat"`
    );
    res.send(Buffer.from(bat, 'utf8'));
  })
);

router.patch(
  '/account',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const { username, email, current_password, new_password } = req.body || {};
    const db = await getDb();
    const user = await db.get(`SELECT * FROM users WHERE id = ?`, [req.user.id]);

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const wantsPasswordChange = typeof new_password === 'string' && new_password.length > 0;
    const wantsIdentityChange =
      (typeof username === 'string' && username.trim() && username.trim() !== user.username) ||
      (typeof email === 'string' &&
        email.trim().toLowerCase() !== user.email &&
        !(isSteamPlaceholderEmail(user.email) && !email.trim()));

    const steamOnly = !!user.login_via_steam;

    if (!steamOnly && (wantsPasswordChange || wantsIdentityChange)) {
      if (!current_password) {
        return res.status(400).json({ error: 'Informe a senha atual para confirmar alterações' });
      }
      const valid = await bcrypt.compare(String(current_password), user.password_hash);
      if (!valid) {
        return res.status(403).json({ error: 'Senha atual incorreta' });
      }
    }

    if (steamOnly && wantsIdentityChange && !wantsPasswordChange) {
      // Conta Steam pode alterar usuário/e-mail sem senha até definir uma.
    } else if (steamOnly && wantsPasswordChange && !current_password) {
      // Primeira senha em conta Steam — permitido.
    } else if (steamOnly && wantsPasswordChange && current_password) {
      const valid = await bcrypt.compare(String(current_password), user.password_hash);
      if (!valid) {
        return res.status(403).json({ error: 'Senha atual incorreta' });
      }
    }

    const updates = [];
    const params = [];
    let nextUsername = user.username;
    let nextEmail = user.email;

    if (typeof username === 'string' && username.trim()) {
      const trimmed = username.trim();
      if (trimmed.length < 3) {
        return res.status(400).json({ error: 'Usuário deve ter no mínimo 3 caracteres' });
      }
      if (trimmed !== user.username) {
        const taken = await db.get(`SELECT id FROM users WHERE username = ? AND id != ?`, [
          trimmed,
          user.id,
        ]);
        if (taken) {
          return res.status(409).json({ error: 'Este nome de usuário já está em uso' });
        }
        updates.push('username = ?');
        params.push(trimmed);
        nextUsername = trimmed;
      }
    }

    if (typeof email === 'string' && email.trim()) {
      const normalized = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        return res.status(400).json({ error: 'E-mail inválido' });
      }
      if (isSteamPlaceholderEmail(normalized)) {
        return res.status(400).json({ error: 'Informe um e-mail válido' });
      }
      if (normalized !== user.email) {
        const taken = await db.get(`SELECT id FROM users WHERE email = ? AND id != ?`, [
          normalized,
          user.id,
        ]);
        if (taken) {
          return res.status(409).json({ error: 'Este e-mail já está em uso' });
        }
        updates.push('email = ?');
        params.push(normalized);
        nextEmail = normalized;
      }
    }

    if (wantsPasswordChange) {
      if (new_password.length < 6) {
        return res.status(400).json({ error: 'Nova senha deve ter no mínimo 6 caracteres' });
      }
      const hash = await bcrypt.hash(new_password, 10);
      updates.push('password_hash = ?');
      params.push(hash);
      if (steamOnly) {
        updates.push('login_via_steam = 0');
      }
    }

    if (!updates.length) {
      return res.json({
        user: { id: user.id, username: nextUsername, email: nextEmail },
        token: null,
      });
    }

    params.push(user.id);
    await db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

    const token = signToken({ id: user.id, username: nextUsername, role: user.role });

    res.json({
      user: { id: user.id, username: nextUsername, email: nextEmail },
      token,
    });
  })
);

/** Estatísticas privadas — filtros, gráficos, histórico */
router.get(
  '/dashboard',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const db = await getDb();

    const filters = {
      map: req.query.map,
      mode: req.query.mode,
      days: req.query.days,
      limit: req.query.limit,
    };

    const profileRow = await profileStats.getProfileById(db, req.user.id);
    const rank = await getPublicRank(db, req.user.id);
    const profile = toPublicProfile(profileRow, rank);

    if (req.user.role === 'admin') {
      const adminRating = await getAdminRating(db, req.user.id);
      profile.mmr = adminRating.mmr;
    }

    const filterOptions = await dashboardStats.getFilterOptions(db, req.user.id);
    const matches = await dashboardStats.getFilteredMatches(db, req.user.id, filters);
    const filtered_stats = dashboardStats.aggregateFromMatches(matches);
    const charts = dashboardStats.buildCharts(matches);

    const hasFilter = !!(filters.map || filters.mode || filters.days);
    const membership = await roomService.getUserActiveMembership(db, req.user.id);
    let active_room = null;
    if (membership) {
      active_room = {
        code: membership.code,
        title: membership.title,
        status: membership.status,
        share_url: `/lobby?code=${membership.code}`,
      };
    }

    res.json({
      profile,
      matches,
      filtered_stats,
      charts,
      filter_options: filterOptions,
      filters_applied: filters,
      has_filter: hasFilter,
      active_room,
    });
  })
);

module.exports = router;
