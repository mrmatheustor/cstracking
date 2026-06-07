/**
 * Corrige partidas antigas com owner_steamid errado (stats de outro jogador).
 *
 * Uso:
 *   node scripts/repair-match-owners.js              # dry-run (só mostra)
 *   node scripts/repair-match-owners.js --apply        # aplica no banco local
 *   DATA_DIR=/data node scripts/repair-match-owners.js --apply   # produção (Railway etc.)
 */
require('dotenv').config();

const { getDb } = require('../db');
const { toSteamId64 } = require('../services/steamId');

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await getDb();

  console.log(`[repair] Modo: ${apply ? 'APLICAR' : 'dry-run (use --apply para gravar)'}`);
  console.log(`[repair] Banco: ${db.DB_PATH || '(via DATA_DIR)'}`);

  const matches = await db.all(`
    SELECT m.id, m.user_id, m.owner_steamid, m.map_name, m.updated_at,
           u.username, u.steam_id
    FROM matches m
    JOIN users u ON u.id = m.user_id
    WHERE m.finished = 1
      AND u.steam_id IS NOT NULL AND u.steam_id != ''
    ORDER BY m.id
  `);

  let fixed = 0;
  let skipped = 0;
  let normalizedStats = 0;

  for (const match of matches) {
    const userSid = toSteamId64(match.steam_id);
    if (!userSid) {
      skipped += 1;
      continue;
    }

    const stats = await db.all(
      `SELECT id, player_steamid, player_name, kills, deaths FROM player_stats WHERE match_id = ?`,
      [match.id]
    );

    const hasUserRow = stats.some((s) => toSteamId64(s.player_steamid) === userSid);
    if (!hasUserRow) {
      skipped += 1;
      continue;
    }

    const currentOwner = toSteamId64(match.owner_steamid);
    if (currentOwner === userSid) {
      skipped += 1;
      continue;
    }

    const wrongName =
      stats.find((s) => toSteamId64(s.player_steamid) === currentOwner)?.player_name || '—';
    const rightName = stats.find((s) => toSteamId64(s.player_steamid) === userSid)?.player_name || '—';

    fixed += 1;
    console.log(
      `#${match.id} ${match.username} · ${match.map_name || '?'} · owner ${currentOwner || '(vazio)'} (${wrongName}) → ${userSid} (${rightName})`
    );

    if (apply) {
      await db.run(`UPDATE matches SET owner_steamid = ? WHERE id = ?`, [userSid, match.id]);
    }
  }

  const allStats = await db.all(
    `SELECT id, player_steamid FROM player_stats WHERE player_steamid IS NOT NULL AND player_steamid != ''`
  );

  for (const row of allStats) {
    const norm = toSteamId64(row.player_steamid);
    if (!norm || norm === row.player_steamid) continue;
    normalizedStats += 1;
    if (apply) {
      await db.run(`UPDATE player_stats SET player_steamid = ? WHERE id = ?`, [norm, row.id]);
    }
  }

  console.log('');
  console.log(`[repair] Partidas corrigidas: ${fixed}${apply ? ' (gravado)' : ' (simulado)'}`);
  console.log(`[repair] Partidas sem alteração: ${skipped}`);
  console.log(`[repair] player_steamid normalizados: ${normalizedStats}${apply ? ' (gravado)' : ' (simulado)'}`);

  if (!apply && (fixed > 0 || normalizedStats > 0)) {
    console.log('\nExecute com --apply para gravar as correções.');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[repair] Erro:', err.message);
  process.exit(1);
});
