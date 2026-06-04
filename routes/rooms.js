const express = require('express');
const { getDb } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const roomService = require('../services/roomService');

const router = express.Router();

router.use(authMiddleware);

router.get(
  '/mine',
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const membership = await roomService.getUserActiveMembership(db, req.user.id);
    if (!membership) {
      return res.json({ room: null });
    }
    const payload = await roomService.getRoomPayload(db, membership.code, req.user.id);
    res.json(payload);
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const db = await getDb();
    try {
      const payload = await roomService.createRoom(db, req.user.id, {
        title: req.body?.title,
        auto_start: req.body?.auto_start !== false,
        map_name: req.body?.map_name,
        lobby_password: req.body?.lobby_password,
      });
      res.status(201).json(payload);
    } catch (err) {
      if (err.code === 'ALREADY_IN_ROOM') {
        return res.status(409).json({
          error: err.message,
          room: await roomService.getRoomPayload(db, err.room.code, req.user.id),
        });
      }
      throw err;
    }
  })
);

router.post(
  '/join',
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const code = req.body?.code;
    try {
      const payload = await roomService.joinRoom(db, req.user.id, code);
      res.json(payload);
    } catch (err) {
      if (err.code === 'ALREADY_IN_ROOM') {
        return res.status(409).json({ error: err.message });
      }
      if (err.status) {
        return res.status(err.status).json({ error: err.message });
      }
      throw err;
    }
  })
);

router.post(
  '/leave',
  asyncHandler(async (req, res) => {
    const db = await getDb();
    try {
      const result = await roomService.leaveRoom(db, req.user.id, req.body?.code);
      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  })
);

router.get(
  '/:code/result',
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const room = await roomService.getRoomByCode(db, req.params.code);
    if (!room) {
      return res.status(404).json({ error: 'Sala não encontrada' });
    }

    const member = await db.get(
      `SELECT 1 FROM match_room_members WHERE room_id = ? AND user_id = ?`,
      [room.id, req.user.id]
    );
    if (!member) {
      return res.status(403).json({ error: 'Você não participa desta sala' });
    }

    const result = await roomService.buildRoomResult(db, room.id);
    res.json(result);
  })
);

router.get(
  '/:code',
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const room = await roomService.getRoomByCode(db, req.params.code);
    if (!room) {
      return res.status(404).json({ error: 'Sala não encontrada' });
    }

    const payload = await roomService.getRoomPayload(db, room.code, req.user.id);
    if (!payload.is_member) {
      return res.status(403).json({ error: 'Entre na sala com o código primeiro' });
    }

    res.json(payload);
  })
);

router.post(
  '/:code/start',
  asyncHandler(async (req, res) => {
    const db = await getDb();
    try {
      const payload = await roomService.startRoom(db, req.user.id, req.params.code);
      res.json(payload);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  })
);

router.post(
  '/:code/close',
  asyncHandler(async (req, res) => {
    const db = await getDb();
    try {
      const payload = await roomService.closeRoom(db, req.user.id, req.params.code);
      res.json(payload);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  })
);

module.exports = router;
