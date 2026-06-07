require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const { getDb } = require('./db');
const { errorHandler } = require('./middleware/errorHandler');
const { finalizeIdleSessions } = require('./services/gsiProcessor');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const gsiRoutes = require('./routes/gsi');
const matchesRoutes = require('./routes/matches');
const liveRoutes = require('./routes/live');
const profilesRoutes = require('./routes/profiles');
const adminRoutes = require('./routes/admin');
const roomsRoutes = require('./routes/rooms');

const PORT = process.env.PORT || 3000;
const app = express();

app.set('trust proxy', 1);

const { httpsRedirect } = require('./middleware/httpsRedirect');
app.use(httpsRedirect);

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');

app.use(cors());
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static(path.join(DATA_DIR, 'uploads')));

// Log de qualquer POST GSI (antes das rotas) — ajuda a ver se o CS2 chega no servidor
app.use('/api/gsi', (req, res, next) => {
  if (req.method === 'POST') {
    const token = req.params?.gsiToken || req.path.split('/').pop();
    console.log(`[GSI] POST recebido → ${req.originalUrl} (${new Date().toLocaleTimeString('pt-BR')})`);
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'cstracking' });
});

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/gsi', gsiRoutes);
app.use('/api/matches', matchesRoutes);
app.use('/api/live-status', liveRoutes);
app.use('/api/profiles', profilesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/rooms', roomsRoutes);

const SPA_PAGES = {
  '/dashboard': 'dashboard.html',
  '/profiles': 'profiles.html',
  '/profile': 'profile.html',
  '/admin': 'admin.html',
  '/configuracoes': 'configuracoes.html',
  '/conta': 'conta.html',
  '/match': 'match.html',
  '/lobby': 'sala.html',
  '/sala': 'sala.html',
  '/seguranca': 'seguranca.html',
  '/privacidade': 'privacidade.html',
  '/auth/steam': 'auth-steam.html',
};

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Rota não encontrada' });
  }
  if (req.method === 'GET' && !req.path.includes('.')) {
    const file = SPA_PAGES[req.path] || 'index.html';
    return res.sendFile(path.join(__dirname, 'public', file));
  }
  next();
});

app.use(errorHandler);

async function start() {
  try {
    const db = await getDb();
    app.listen(PORT, () => {
      console.log(`CS Tracking rodando em http://localhost:${PORT}`);
      console.log(`GSI endpoint: POST http://localhost:${PORT}/api/gsi/live/<gsi_token>`);
    });

    // Deathmatch não envia gameover — salva sessão ~90s após parar de receber sinal
    setInterval(() => {
      finalizeIdleSessions(db).catch((err) => console.error('[GSI] idle save:', err.message));
    }, 30000);
  } catch (err) {
    console.error('Falha ao iniciar:', err);
    process.exit(1);
  }
}

start();
