const express = require('express');
const { getDb } = require('../db');
const { processGsiPayload, extractOwnerSteamId } = require('../services/gsiProcessor');
const liveStore = require('../services/gsiLiveStore');
const { verifyGsiAuthPayload } = require('../services/gsiAuth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

router.get('/test', (req, res) => {
  res.json({
    ok: true,
    message: 'Servidor GSI acessível. O CS2 deve fazer POST (não GET) neste endpoint.',
    time: new Date().toISOString(),
  });
});

/**
 * CS2 envia POST com JSON do estado do jogo.
 * O gsiToken na URL identifica o dono da partida.
 */
router.post(
  '/live/:gsiToken',
  asyncHandler(async (req, res) => {
    const { gsiToken } = req.params;
    const payload = req.body;

    if (!gsiToken) {
      return res.status(400).json({ error: 'Token GSI ausente' });
    }

    const db = await getDb();
    const user = await db.get(
      `SELECT id, gsi_auth_token, steam_id, login_via_steam FROM users WHERE gsi_token = ?`,
      [gsiToken]
    );

    if (!user) {
      console.log(`[GSI] Token inválido: ${gsiToken.slice(0, 8)}...`);
      return res.status(404).json({ error: 'Token GSI inválido' });
    }

    if (!verifyGsiAuthPayload(payload, user.gsi_auth_token)) {
      console.log(`[GSI] Auth token inválido user_id=${user.id}`);
      return res.status(403).json({ error: 'Token de autenticação GSI inválido' });
    }

    try {
      const mapName = payload?.map?.name || '';
      const inGame = mapName && mapName.toLowerCase() !== 'lobby';
      liveStore.recordGsiPing(user.id, inGame);

      const phase = payload?.map?.phase || '(sem mapa)';
      const mode = payload?.map?.mode || '-';
      console.log(`[GSI] user_id=${user.id} map=${mapName || '-'} mode=${mode} phase=${phase} inGame=${inGame}`);

      const steamId = extractOwnerSteamId(payload);
      if (steamId && !user.login_via_steam) {
        await db.run(`UPDATE users SET steam_id = ? WHERE id = ?`, [steamId, user.id]);
      } else if (steamId && !user.steam_id) {
        await db.run(`UPDATE users SET steam_id = ? WHERE id = ?`, [steamId, user.id]);
      }

      const result = await processGsiPayload(user.id, payload, db);
      res.status(200).json({
        ok: true,
        saved: result.saved,
        matchId: result.matchId,
        message: result.message,
      });
    } catch (err) {
      console.error('[GSI] Erro ao processar:', err);
      res.status(500).json({ error: 'Falha ao processar payload GSI' });
    }
  })
);

module.exports = router;
