const express = require('express');
const { getDb } = require('../db');
const { requireAdmin } = require('../middleware/admin');
const { asyncHandler } = require('../middleware/errorHandler');
const adminOverview = require('../services/adminOverview');

const router = express.Router();

/** Partidas ao vivo de todos os usuarios — apenas admin */
router.get(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const live_sessions = await adminOverview.getAllLiveSessions(db);
    res.json({ live_sessions });
  })
);

module.exports = router;
