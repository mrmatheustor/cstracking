/** Redireciona HTTP → HTTPS em produção (Railway, etc.). */
function httpsRedirect(req, res, next) {
  const force =
    process.env.FORCE_HTTPS === '1' ||
    process.env.NODE_ENV === 'production' ||
    !!process.env.GSI_PUBLIC_URL?.startsWith('https');

  if (!force) return next();

  const proto = req.headers['x-forwarded-proto'];
  if (req.secure || proto === 'https') return next();

  return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
}

module.exports = { httpsRedirect };
