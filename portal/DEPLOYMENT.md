# RightServe Portal — Deployment Guide

The portal has **two independent parts** that can be deployed on the **same server
or two different servers**:

| Part | Folder | What it is |
|------|--------|------------|
| **Backend (API)** | `portal/server` | Node.js + Express + SQLite. Auth, clients, licenses, activation. |
| **Frontend (Web)** | `portal/client` | React (Vite) static site. The dashboard your team uses. |

The frontend talks to the backend over HTTP. **Which backend URL the frontend uses
is configurable via a `.env` file** (`VITE_API_BASE`), set at build time — so you can
point the same UI at any backend after deployment.

The **license activation URL** stamped into generated keys is configurable on the
backend via `ACTIVATION_URL` — change it any time, no code edits.

---

## 0. Prerequisites
- Node.js 20+ on the backend server.
- A static host (Nginx, Netlify, Vercel, S3+CloudFront, or the backend itself) for the frontend.
- (Recommended) HTTPS on both, via Nginx/Caddy or your host.

---

## 1. Configuration overview

### Backend — `portal/server/.env`  (copy from `.env.example`)
```ini
PORT=4100
HOST=0.0.0.0
PORTAL_JWT_SECRET=<long-random-string>      # REQUIRED in production
PORTAL_DB_PATH=/var/data/portal.db          # persistent disk path
CORS_ORIGIN=https://portal.rightserve.com   # the FRONTEND origin(s), comma-separated
ACTIVATION_URL=https://api.rightserve.com   # public URL of THIS API (for license keys)
LICENSE_PRIVATE_KEY=/secrets/license_private.pem  # optional override
```
> The server auto-loads `portal/server/.env` (a tiny built-in loader). Real OS
> environment variables always take priority over the file.

### Frontend — `portal/client/.env`  (copy from `.env.example`)
```ini
# Empty  -> frontend calls the SAME origin it is served from (single-server).
# Set    -> frontend calls a DIFFERENT backend host.
VITE_API_BASE=https://api.rightserve.com
```
> `VITE_API_BASE` is read at **build time**. If you change it, **rebuild** the
> frontend (`npm run build`). No trailing slash, no `/api` suffix.

---

## 2. Deploy — Option A: Single server (simplest)

Backend serves both the API and the built frontend.

```bash
# 1) Build the frontend (leave VITE_API_BASE empty for same-origin)
cd portal/client
cp .env.example .env            # VITE_API_BASE stays empty
npm install
npm run build                   # outputs portal/client/dist

# 2) Configure & run the backend
cd ../server
cp .env.example .env            # set PORTAL_JWT_SECRET, ACTIVATION_URL, PORTAL_DB_PATH
npm install
npm rebuild better-sqlite3      # ensure native module matches this Node
npm run seed                    # first time only: creates admin/admin123 + sales1/sales123
node index.js                   # serves API + UI on PORT (default 4100)
```
Now open `http://<server>:4100`. Set `ACTIVATION_URL=http://<server>:4100`
(or your domain) so license keys point back here.

> Frontend is auto-served because `portal/client/dist` exists next to the server.
> To serve a dist from elsewhere, set `PORTAL_CLIENT_DIST`.

---

## 3. Deploy — Option B: Two servers (frontend & backend separate)

### 3a. Backend (API server) — e.g. `api.rightserve.com`
```bash
cd portal/server
cp .env.example .env
#   PORT=4100
#   HOST=0.0.0.0
#   PORTAL_JWT_SECRET=<random>
#   PORTAL_DB_PATH=/var/data/portal.db
#   CORS_ORIGIN=https://portal.rightserve.com      <-- the FRONTEND URL
#   ACTIVATION_URL=https://api.rightserve.com       <-- this API's own public URL
npm install
npm rebuild better-sqlite3
npm run seed         # first run only
# Run under a process manager (recommended): see §5
node index.js
```
Put Nginx/Caddy in front for HTTPS on `https://api.rightserve.com`.

> **CORS matters here:** because the frontend is on a different domain, set
> `CORS_ORIGIN` to the exact frontend origin(s). Multiple allowed origins:
> `CORS_ORIGIN=https://portal.rightserve.com,https://www.rightserve.com`.

### 3b. Frontend (static site) — e.g. `portal.rightserve.com`
```bash
cd portal/client
cp .env.example .env
#   VITE_API_BASE=https://api.rightserve.com        <-- the BACKEND URL
npm install
npm run build        # outputs portal/client/dist
```
Upload the **contents of `portal/client/dist`** to your static host
(Nginx root, Netlify, Vercel, S3+CloudFront, etc.).

**SPA routing:** the app uses client-side routes (`/clients`, `/generate`...).
Configure the static host to fall back to `index.html` for unknown paths:
- **Nginx:**
  ```nginx
  location / { try_files $uri /index.html; }
  ```
- **Netlify:** add `_redirects` with `/*  /index.html  200`
- **Vercel:** add a rewrite of `/(.*)` → `/index.html`

---

## 4. Changing settings AFTER deployment

| Want to change | Where | Rebuild needed? |
|----------------|-------|-----------------|
| Backend URL the frontend calls | frontend `.env` → `VITE_API_BASE` | **Yes** — rebuild frontend |
| Activation URL inside NEW license keys | backend `.env` → `ACTIVATION_URL`, then restart API | No (restart only) |
| Allowed frontend origin (CORS) | backend `.env` → `CORS_ORIGIN`, then restart API | No (restart only) |
| JWT secret / DB path / port | backend `.env`, then restart API | No (restart only) |

> Existing license keys keep the activation URL they were generated with.
> Changing `ACTIVATION_URL` only affects keys generated afterwards.

---

## 5. Running the backend as a service

### PM2
```bash
npm install -g pm2
cd portal/server
pm2 start index.js --name rightserve-portal
pm2 save && pm2 startup
```

### systemd (`/etc/systemd/system/rightserve-portal.service`)
```ini
[Unit]
Description=RightServe Portal API
After=network.target

[Service]
WorkingDirectory=/opt/rightserve/portal/server
ExecStart=/usr/bin/node index.js
Restart=always
EnvironmentFile=/opt/rightserve/portal/server/.env
User=www-data

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload && sudo systemctl enable --now rightserve-portal
```

---

## 6. Nginx reverse proxy (HTTPS) examples

### API server (`api.rightserve.com`)
```nginx
server {
  server_name api.rightserve.com;
  location / { proxy_pass http://127.0.0.1:4100; proxy_set_header Host $host; }
  # add SSL via certbot
}
```

### Frontend server (`portal.rightserve.com`)
```nginx
server {
  server_name portal.rightserve.com;
  root /var/www/rightserve-portal;   # contents of portal/client/dist
  location / { try_files $uri /index.html; }
}
```

---

## 7. First login & security checklist
- Default seeded logins: **admin / admin123**, **sales1 / sales123** — change these immediately.
- [ ] Set a strong `PORTAL_JWT_SECRET`.
- [ ] Serve both parts over **HTTPS**.
- [ ] Set `CORS_ORIGIN` to your real frontend origin (don’t leave it open in prod).
- [ ] Put `PORTAL_DB_PATH` on a **persistent, backed-up** disk.
- [ ] Keep `license_private.pem` **secret** (never commit; restrict file perms).
- [ ] Back up `portal.db` regularly (it holds clients, licenses, users).

---

## 8. Health check & smoke test
```bash
curl https://api.rightserve.com/api/health           # {"ok":true,...}
# from the frontend origin, the dashboard should load and log in.
```

---

## 9. Updating to a new version
```bash
git pull
# backend
cd portal/server && npm install && npm rebuild better-sqlite3
# (DB migrations run automatically on start)
pm2 restart rightserve-portal     # or systemctl restart
# frontend
cd ../client && npm install && npm run build
# re-upload dist/ to the static host
```
The SQLite schema auto-migrates on startup; your data is preserved.
