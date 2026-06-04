/**
 * Armazena partidas em andamento em memória por usuário.
 * Chave: userId -> estado da partida ao vivo.
 */
const liveByUser = new Map();

/** Evita persistir o mesmo gameover várias vezes (CS2 reenvia o payload). */
const finalizedKeys = new Set();

/** Último POST GSI recebido por usuário (diagnóstico). */
const lastGsiAt = new Map();
/** Último sinal com mapa válido (dentro de partida). */
const lastInGameAt = new Map();

function liveKey(userId, matchKey) {
  return `${userId}:${matchKey}`;
}

function getLiveMatch(userId) {
  return liveByUser.get(userId) || null;
}

function setLiveMatch(userId, state) {
  liveByUser.set(userId, state);
}

function clearLiveMatch(userId) {
  liveByUser.delete(userId);
}

function isAlreadyFinalized(userId, matchKey) {
  return finalizedKeys.has(liveKey(userId, matchKey));
}

function markFinalized(userId, matchKey) {
  finalizedKeys.add(liveKey(userId, matchKey));
}

function recordGsiPing(userId, inGame = false) {
  lastGsiAt.set(userId, Date.now());
  if (inGame) {
    lastInGameAt.set(userId, Date.now());
  }
}

function getLastGsiAt(userId) {
  return lastGsiAt.get(userId) || null;
}

function getLastInGameAt(userId) {
  return lastInGameAt.get(userId) || null;
}

function getActiveUserIds() {
  return [...liveByUser.keys()];
}

module.exports = {
  getLiveMatch,
  setLiveMatch,
  clearLiveMatch,
  isAlreadyFinalized,
  markFinalized,
  recordGsiPing,
  getLastGsiAt,
  getLastInGameAt,
  getActiveUserIds,
};
