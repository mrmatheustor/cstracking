const express = require('express');
const { getDb } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const profileStats = require('../services/profileStats');
const dashboardStats = require('../services/dashboardStats');
const roomService = require('../services/roomService');
const { toPublicProfile } = require('../services/publicProfile');
const { resolveGsiBaseUrl, buildGsiUri } = require('../services/gsiConfig');
const { buildInstallerBat } = require('../services/gsiInstaller');
const liveStore = require('../services/gsiLiveStore');

const router = express.Router();
const GSI_CONNECTED_MS = 120000;

router.get(
  '/profile',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const { get } = await getDb();
    const user = await get(
      `SELECT id, username, email, gsi_token, role, steam_id, created_at FROM users WHERE id = ?`,
      [req.user.id]
    );

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const baseUrl = resolveGsiBaseUrl(req);

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        steam_id: user.steam_id || null,
        created_at: user.created_at,
        gsi_token: user.gsi_token,
        gsi_uri: buildGsiUri(baseUrl, user.gsi_token),
        gsi_base_url: baseUrl,
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

router.get(
  '/install-gsi.bat',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const { get } = await getDb();
    const user = await get(`SELECT gsi_token, username FROM users WHERE id = ?`, [req.user.id]);

    if (!user?.gsi_token) {
      return res.status(404).json({ error: 'Token GSI não encontrado' });
    }

    const baseUrl = resolveGsiBaseUrl(req);
    const bat = buildInstallerBat(user.gsi_token, baseUrl);
    const safeName = (user.username || 'jogador').replace(/[^\w\-]+/g, '_');

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Instalar-CS2Tracking-${safeName}.bat"`
    );
    res.send(Buffer.from(bat, 'utf8'));
  })
);

/** Minha conta — stats, filtros, gráficos, histórico */
router.get(
  '/dashboard',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const user = await db.get(
      `SELECT id, username, email, role, created_at FROM users WHERE id = ?`,
      [req.user.id]
    );

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const filters = {
      map: req.query.map,
      mode: req.query.mode,
      days: req.query.days,
      limit: req.query.limit,
    };

    const profile = await profileStats.getProfileById(db, req.user.id);
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
        share_url: `/sala?code=${membership.code}`,
      };
    }

    res.json({
      user,
      profile: toPublicProfile(profile),
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
