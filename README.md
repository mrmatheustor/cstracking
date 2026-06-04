# CS2 Tracking (GSI)

Aplicação web para rastrear partidas personalizadas de **Counter-Strike 2** usando **Game State Integration (GSI)**. Recebe dados em tempo real do jogo, mantém a partida em andamento em memória e persiste no SQLite apenas quando `map.phase === "gameover"`.

## Stack

- **Backend:** Node.js, Express, JavaScript
- **Banco:** SQLite (`sqlite3`)
- **Frontend:** HTML5, Tailwind CSS (CDN), JavaScript Vanilla
- **Auth:** JWT + bcryptjs

## Estrutura de pastas

```
cstracking/
├── server.js
├── package.json
├── .env.example
├── db/
│   ├── init.js          # Cria tabelas automaticamente
│   └── index.js
├── middleware/
│   ├── auth.js          # JWT
│   └── errorHandler.js
├── routes/
│   ├── auth.js
│   ├── user.js
│   ├── gsi.js
│   ├── matches.js
│   └── live.js
├── services/
│   ├── gsiProcessor.js  # Lógica crítica do payload GSI
│   └── gsiLiveStore.js  # Partidas ao vivo + dedupe gameover
├── public/
│   ├── index.html
│   ├── dashboard.html
│   └── js/
├── sql/
│   └── schema.sql       # Referência do schema
└── data/                # SQLite (criado ao rodar)
```

## Instalação

```bash
npm install
cp .env.example .env
# Edite JWT_SECRET no .env
npm run dev
```

Acesse: **http://localhost:3000**

### Desenvolvimento (`npm run dev`)

O script `dev` usa o **`node --watch`** (Node 18+): ao salvar arquivos do backend (`server.js`, `routes/`, `services/`, `db/`, etc.), o servidor reinicia sozinho. Alterações em `.env` também disparam reinício.

- Arquivos em `public/` (HTML/CSS/JS) **não** reiniciam o Node — basta atualizar a página no navegador (use `Ctrl+Shift+R` se o cache atrapalhar).
- `npm start` continua sem watch (produção / uso estável).

## Rotas da API

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/auth/register` | Cadastro (gera `gsi_token`) |
| POST | `/api/auth/login` | Login → JWT |
| GET | `/api/user/profile` | Perfil + token GSI (Bearer JWT) |
| GET | `/api/user/gsi-status` | Status da conexão GSI |
| GET | `/api/user/install-gsi.bat` | Instalador Windows personalizado |
| POST | `/api/rooms` | Criar sala (codigo) |
| POST | `/api/rooms/join` | Entrar na sala |
| GET | `/api/rooms/:code` | Estado da sala + membros |
| POST | `/api/rooms/:code/start` | Host inicia (ao vivo) |
| POST | `/api/rooms/:code/close` | Host encerra + resultado |
| POST | `/api/gsi/live/:gsiToken` | Recebe JSON do CS2 |
| GET | `/api/matches` | Histórico de partidas |
| GET | `/api/live-status` | Partida ao vivo em memória |
| GET | `/api/profiles` | Lista perfis com stats (JWT) |
| GET | `/api/profiles/:id` | Detalhe do perfil + partidas (JWT) |
| GET | `/api/admin/users` | Lista usuários (admin) |
| PATCH | `/api/admin/users/:id/role` | Alterar admin/user (admin) |

## Papéis e paginas

| Papel | Acesso |
|-------|--------|
| **Visitante** | `/profiles` e `/profile?id=` (publico, sem login) |
| **Jogador** | `/conta`, `/sala` (codigo + placar em grupo), perfil publico |
| **Admin** | `/admin` — partidas ao vivo de todos, historico global, permissoes |

- `mrmatheustor@gmail.com` e sempre promovido a admin ao iniciar o servidor.
- Defina `ADMIN_EMAIL` no `.env` para outro e-mail admin.
- Novos cadastros recebem `role: user` (promova para admin no painel).

## Configuração no CS2 (GSI)

### Para jogadores (sem terminal / IDE)

1. Login em **Minha conta** (`/conta`)
2. Clique em **Baixar instalador GSI (.bat)**
3. Duplo clique no arquivo baixado (Windows)
4. Reinicie o CS2

Cada conta tem **token único** no instalador. Instale **uma vez por PC**. Não compartilhe o `.bat`.

Status **GSI conectado** na Minha conta confirma que o jogo está enviando dados.

### Servidor online (amigos / outro time)

Defina no `.env`:

```env
GSI_PUBLIC_URL=https://seu-dominio.com
```

O instalador baixado usará essa URL no `.cfg` (em vez de `127.0.0.1`).

### Desenvolvedor (npm / PowerShell)

```powershell
cd d:\Apps\cstracking
npm run install:gsi
```

Ou: `.\scripts\install-gsi-cfg.ps1 -Email "seu@email.com"`

Arquivo gerado em:

`...\Counter-Strike Global Offensive\game\csgo\cfg\gamestate_integration_cstracking.cfg`

### Manual

1. Cadastre-se e abra **Minha conta** (token na seção avançada).
2. Crie o arquivo em:
   `...\Counter-Strike Global Offensive\game\csgo\cfg\gamestate_integration_cstracking.cfg`

   > No CS2 atual, o `.cfg` fica direto na pasta `cfg`, **nao** em `cfg\gamestate_integration\`.
3. Use a configuração gerada no dashboard (URL com seu token).
4. Reinicie o CS2.

O jogo enviará `POST` para:

```
http://localhost:3000/api/gsi/live/SEU_GSI_TOKEN
```

> Para o CS2 alcançar o servidor em outra máquina, use o IP da rede e libere a porta no firewall.

## Comportamento GSI

- Cada usuário tem `gsi_token` único no cadastro.
- Partidas **em andamento** ficam em memória (`gsiLiveStore`).
- Só grava no banco quando `map.phase === "gameover"`.
- `UNIQUE(user_id, match_key)` + cache em memória evitam duplicar a mesma partida finalizada.

## Variáveis de ambiente

| Variável | Padrão |
|----------|--------|
| `PORT` | `3000` |
| `JWT_SECRET` | (obrigatório em produção) |
| `JWT_EXPIRES_IN` | `7d` |
| `ADMIN_EMAIL` | e-mail promovido a admin |

## Licença

MIT
