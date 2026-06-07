/**
 * Corrige partidas antigas com owner_steamid errado (stats de outro jogador).
 *
 * LOCAL:
 *   node scripts/repair-match-owners.js
 *   node scripts/repair-match-owners.js --apply
 *
 * PRODUÇÃO (Railway): use o painel Admin → "Reparar stats" ou POST /api/admin/repair-match-owners
 * (railway run no Windows NÃO acessa o banco do servidor — só roda local com env vars).
 */
require('dotenv').config();

const { getDb } = require('../db');
const { repairMatchOwners } = require('../services/repairMatchOwners');

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await getDb();
  const result = await repairMatchOwners(db, { apply });

  console.log(`[repair] Modo: ${apply ? 'APLICAR' : 'dry-run (use --apply para gravar)'}`);
  console.log(`[repair] Banco: ${result.dbPath}`);
  console.log(
    `[repair] Partidas finalizadas: ${result.summary.totalFinishedMatches} | Contas com Steam: ${result.summary.usersWithSteam}`
  );

  for (const row of result.changes) {
    console.log(
      `#${row.matchId} ${row.user} · ${row.map || '?'} · ${row.fromName} → ${row.toName} (${row.method || '?'})`
    );
  }

  for (const row of result.skipped.slice(0, 20)) {
    console.log(`[skip] #${row.matchId} ${row.user || ''} · ${row.map || ''} — ${row.reason}`);
    if (row.players) console.log(`       placar: ${row.players}`);
  }
  if (result.skipped.length > 20) {
    console.log(`[skip] ... e mais ${result.skipped.length - 20}`);
  }

  console.log('');
  console.log(
    `[repair] Corrigidas: ${result.summary.fixed}${apply ? ' (gravado)' : ' (simulado)'} | Ignoradas: ${result.summary.skipped} | IDs normalizados: ${result.summary.normalizedStats}`
  );

  if (!apply && (result.summary.fixed > 0 || result.summary.normalizedStats > 0)) {
    console.log('\nExecute com --apply para gravar, ou use Admin → Reparar stats em produção.');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[repair] Erro:', err.message);
  process.exit(1);
});
