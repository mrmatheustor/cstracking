const crypto = require('crypto');

function verifyGsiAuthPayload(payload, expectedToken) {
  if (!expectedToken) return true;

  const received = payload?.auth?.token;
  if (!received || typeof received !== 'string') {
    return false;
  }

  const a = Buffer.from(received);
  const b = Buffer.from(expectedToken);
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

module.exports = { verifyGsiAuthPayload };
