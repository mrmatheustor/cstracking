const express = require('express');
const { getDb } = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const profileStats = require('../services/profileStats');
const { toPublicProfile } = require('../services/publicProfile');

const router = express.Router();

/** Perfis publicos — nao exige login */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const profiles = await profileStats.listProfiles(db);
    res.json({ profiles: profiles.map(toPublicProfile) });
  })
);

router.get(
  '/:userId/matches/:matchId',
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.userId);
    const matchId = Number(req.params.matchId);
    if (!userId || !matchId) {
      return res.status(400).json({ error: 'IDs inválidos' });
    }

    const db = await getDb();
    const detail = await profileStats.getMatchDetail(db, userId, matchId);

    if (!detail) {
      return res.status(404).json({ error: 'Partida não encontrada' });
    }

    res.json(detail);
  })
);

router.get(
  '/:userId',
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.userId);
    if (!userId) {
      return res.status(400).json({ error: 'ID de usuário inválido' });
    }

    const db = await getDb();
    const profile = await profileStats.getProfileById(db, userId);

    if (!profile) {
      return res.status(404).json({ error: 'Perfil não encontrado' });
    }

    const matches = await profileStats.getMatchesForProfile(db, userId);
    res.json({ profile: toPublicProfile(profile), matches });
  })
);

module.exports = router;
