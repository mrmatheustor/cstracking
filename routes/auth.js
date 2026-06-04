const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { signToken } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'username, email e password são obrigatórios' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });
    }

    const { run, get } = await getDb();
    const existing = await get(
      `SELECT id FROM users WHERE username = ? OR email = ?`,
      [username.trim(), email.trim().toLowerCase()]
    );

    if (existing) {
      return res.status(409).json({ error: 'Usuário ou e-mail já cadastrado' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const gsiToken = uuidv4().replace(/-/g, '');

    const emailNorm = email.trim().toLowerCase();
    const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const role = adminEmail && emailNorm === adminEmail ? 'admin' : 'user';

    const result = await run(
      `INSERT INTO users (username, email, password_hash, gsi_token, role) VALUES (?, ?, ?, ?, ?)`,
      [username.trim(), emailNorm, passwordHash, gsiToken, role]
    );

    const token = signToken({ id: result.lastID, username: username.trim(), role });

    res.status(201).json({
      message: 'Cadastro realizado',
      token,
      user: {
        id: result.lastID,
        username: username.trim(),
        email: emailNorm,
        gsi_token: gsiToken,
        role,
      },
    });
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'email e password são obrigatórios' });
    }

    const { get } = await getDb();
    const user = await get(`SELECT * FROM users WHERE email = ?`, [email.trim().toLowerCase()]);

    if (!user) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const role = user.role || 'user';
    const token = signToken({ id: user.id, username: user.username, role });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        gsi_token: user.gsi_token,
        role,
      },
    });
  })
);

module.exports = router;
