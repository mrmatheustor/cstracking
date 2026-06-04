const express = require('express');
const { getDb } = require('../db');
const { requireAdmin } = require('../middleware/admin');
const { asyncHandler } = require('../middleware/errorHandler');
const adminOverview = require('../services/adminOverview');

const router = express.Router();

/** Historico global de partidas — apenas admin */
router.get(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const matches = await adminOverview.getGlobalRecentMatches(db, 50);
    res.json({ matches });
  })
);

module.exports = router;
