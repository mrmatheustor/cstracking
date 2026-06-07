/** Conteúdo do .cfg e URL base do endpoint GSI. */

function resolveGsiBaseUrl(req) {
  const fromEnv = (process.env.GSI_PUBLIC_URL || process.env.PUBLIC_URL || '').trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '');
  }

  const port = process.env.PORT || 3000;
  const host = req?.get?.('host') || `localhost:${port}`;
  const forwarded = req?.get?.('x-forwarded-proto');
  const proto =
    forwarded === 'https' || req?.protocol === 'https' ? 'https' : 'http';

  if (/^localhost(:\d+)?$/i.test(host) || /^127\.0\.0\.1(:\d+)?$/i.test(host)) {
    return `http://127.0.0.1:${host.split(':')[1] || port}`;
  }

  return `${proto}://${host}`;
}

function buildGsiUri(baseUrl, gsiToken) {
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/api/gsi/live/${gsiToken}`;
}

function buildGsiCfgContent(gsiToken, baseUrl, authToken) {
  const uri = buildGsiUri(baseUrl, gsiToken);

  const authBlock =
    authToken &&
    `
    "auth"
    {
        "token" "${authToken}"
    }`;

  return `"CS2 Tracking"
{
    "uri" "${uri}"
    "timeout" "5.0"
    "buffer"  "0.1"
    "throttle" "0.1"
    "heartbeat" "30.0"${authBlock || ''}
    "data"
    {
        "provider"      "1"
        "map"           "1"
        "round"         "1"
        "player_id"     "1"
        "player_state"  "1"
        "player_match_stats" "1"
        "allplayers_id" "1"
        "allplayers_state" "1"
        "allplayers_match_stats" "1"
    }
}
`;
}

module.exports = { resolveGsiBaseUrl, buildGsiUri, buildGsiCfgContent };
