const express = require('express');
const { getDb } = require('../db');
const { requireAdmin } = require('../middleware/admin');
const { asyncHandler } = require('../middleware/errorHandler');
const profileStats = require('../services/profileStats');
const adminOverview = require('../services/adminOverview');
const { getAdminRating } = require('../services/playerRating');
const { repairMatchOwners } = require('../services/repairMatchOwners');

const router = express.Router();

router.get(
  '/overview',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const [live_sessions, recent_matches] = await Promise.all([
      adminOverview.getAllLiveSessions(db),
      adminOverview.getGlobalRecentMatches(db, 40),
    ]);
    res.json({ live_sessions, recent_matches });
  })
);

router.get(
  '/users',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const users = await db.all(
      `SELECT id, username, email, role, steam_id, created_at FROM users ORDER BY id ASC`
    );
    const profiles = await profileStats.listProfiles(db);

    const statsById = {};
    for (const p of profiles) {
      const adminRating = await getAdminRating(db, p.id);
      statsById[p.id] = { ...p, mmr: adminRating.mmr };
    }

    res.json({
      users: users.map((u) => ({
        ...u,
        stats: statsById[u.id] || null,
      })),
    });
  })
);

router.patch(
  '/users/:userId/role',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.userId);
    const { role } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'role deve ser "admin" ou "user"' });
    }

    const db = await getDb();
    const target = await db.get(`SELECT id, role FROM users WHERE id = ?`, [userId]);

    if (!target) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    if (target.id === req.user.id && role !== 'admin') {
      const admins = await db.get(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin'`);
      if (admins.c <= 1) {
        return res.status(400).json({ error: 'Não é possível remover o único administrador' });
      }
    }

    await db.run(`UPDATE users SET role = ? WHERE id = ?`, [role, userId]);

    res.json({ message: 'Papel atualizado', userId, role });
  })
);

router.post(
  '/repair-match-owners',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const apply = req.query.apply === '1' || req.body?.apply === true;
    const db = await getDb();
    const result = await repairMatchOwners(db, { apply });
    res.json(result);
  })
);

router.delete(
  '/matches/:matchId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const matchId = Number(req.params.matchId);
    if (!matchId) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const db = await getDb();
    const match = await db.get(`SELECT id FROM matches WHERE id = ?`, [matchId]);
    if (!match) {
      return res.status(404).json({ error: 'Partida não encontrada' });
    }

    await db.run(`DELETE FROM player_stats WHERE match_id = ?`, [matchId]);
    await db.run(`DELETE FROM matches WHERE id = ?`, [matchId]);

    res.json({ message: 'Partida removida', matchId });
  })
);

module.exports = router;
