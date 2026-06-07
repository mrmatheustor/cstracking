const express = require('express');

const { getDb } = require('../db');

const { optionalAuthMiddleware } = require('../middleware/auth');

const { asyncHandler } = require('../middleware/errorHandler');

const profileStats = require('../services/profileStats');

const { getPublicRank, getAdminRating } = require('../services/playerRating');

const { toPublicProfile } = require('../services/publicProfile');



const router = express.Router();



async function enrichProfile(db, profile, viewer) {

  const rank = await getPublicRank(db, profile.id);

  const out = toPublicProfile(profile, rank);

  if (viewer?.role === 'admin') {

    const adminRating = await getAdminRating(db, profile.id);

    out.mmr = adminRating.mmr;

    out.rating_events = adminRating.recent_events;

  }

  return out;

}



/** Perfis publicos — nao exige login */

router.get(

  '/',

  asyncHandler(async (req, res) => {

    const db = await getDb();

    const profiles = await profileStats.listProfiles(db);

    const enriched = [];

    for (const p of profiles) {

      enriched.push(await enrichProfile(db, p, null));

    }

    enriched.sort((a, b) => (b.rank_points || 0) - (a.rank_points || 0));

    res.json({ profiles: enriched });

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

  optionalAuthMiddleware,

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



    const viewer = req.user || null;

    const publicProfile = await enrichProfile(db, profile, viewer);

    const matches = await profileStats.getMatchesForProfile(db, userId);

    res.json({ profile: publicProfile, matches });

  })

);



module.exports = router;

