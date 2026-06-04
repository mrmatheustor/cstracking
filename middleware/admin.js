const { getDb } = require('../db');
const { authMiddleware } = require('./auth');

async function adminMiddleware(req, res, next) {
  try {
    const { get } = await getDb();
    const row = await get(`SELECT role FROM users WHERE id = ?`, [req.user.id]);

    if (!row || row.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso restrito a administradores' });
    }

    req.user.role = 'admin';
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  authMiddleware(req, res, (err) => {
    if (err) return next(err);
    adminMiddleware(req, res, next);
  });
}

module.exports = { adminMiddleware, requireAdmin };
