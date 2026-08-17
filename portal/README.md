# RightServe — Sales & License Portal

A **centralized web portal** for the RightServe team to manage clients and issue
license keys for the RightServe desktop product. Single login for **admin** and
**salespeople**; role decides what they can do.

> Licenses generated here are signed with the **same ed25519 key** as the desktop
> product, so portal-generated keys activate offline in the installed app.

> **Deploying?** See **[DEPLOYMENT.md](./DEPLOYMENT.md)** — the frontend and backend
> can run on the **same or different servers**. The backend URL the frontend calls
> is set via `portal/client/.env` (`VITE_API_BASE`), and the license activation URL
> via `portal/server/.env` (`ACTIVATION_URL`). Copy each `.env.example` to `.env`.

## Features

### Salesperson can
- Create & manage **their own** clients
- **Generate** a license key for a client (1yr / 2yr / 3mo / custom days / until a
  date / **lifetime**, optional machine-lock)
- **Renew** a client's license (issues a fresh key, keeps history)
- Copy/resend any of their licenses' keys
- See their dashboard: clients, active / expiring / expired, renewals due

### Admin can (everything above, company-wide) plus
- See **all clients**, when created, **license expiry**, status, and **which
  salesperson** created each
- **Sales Team management**: create salespeople (they log in), enable/disable,
  reset passwords, see per-person client/license counts
- **Revoke** licenses
- Company-wide dashboard + team performance

## Architecture
- `server/` — Node + Express + SQLite (`better-sqlite3`), JWT auth, ed25519 signing
- `client/` — React + Vite SPA (served by the server in production)
- Data: `server/data/portal.db`
- Signing key: `server/license_private.pem` (**server-side only — never shipped**)
  and `server/license_public.pem` (same public key the desktop app embeds)

## Run locally (dev)
```bash
# backend
cd portal/server
npm install
npm rebuild better-sqlite3
npm run seed        # creates admin/admin123 and sales1/sales123
npm start           # http://localhost:4100

# frontend (separate terminal, hot reload)
cd portal/client
npm install
npm run dev         # http://localhost:5174 (proxies /api → :4100)
```

## Production build & deploy (single server)
```bash
cd portal/client && npm install && npm run build   # builds client/dist
cd ../server && npm install && npm rebuild better-sqlite3
# set strong secrets:
export PORTAL_JWT_SECRET="<long-random-string>"
export PORT=4100
node index.js        # serves API + UI on the same port, binds 0.0.0.0
```
Put it behind Nginx/Caddy with HTTPS, or run with PM2/systemd. The server binds
`0.0.0.0` so your team can reach it over the internet/LAN.

### First-time setup
1. Run `npm run seed` once (or create the first admin yourself).
2. Log in as admin → **Sales Team → Add Salesperson** for each team member.
3. Salespeople log in and start adding clients & generating licenses.

## Environment variables
| Var | Purpose | Default |
|-----|---------|---------|
| `PORT` | HTTP port | 4100 |
| `HOST` | Bind address | 0.0.0.0 |
| `PORTAL_JWT_SECRET` | Session signing secret (**set in prod!**) | dev placeholder |
| `PORTAL_DB_PATH` | SQLite file path | `server/data/portal.db` |
| `LICENSE_PRIVATE_KEY` | Path to the ed25519 private key | `server/license_private.pem` |
| `PORTAL_CLIENT_DIST` | Built client dir | `../client/dist` |

## Security notes
- The **private signing key** lives only on this server; salespeople never see it.
- Keep `server/license_private.pem` out of git (the repo `.gitignore` already
  excludes `*.pem` except the desktop public key — verify before committing).
- Use HTTPS in production and a strong `PORTAL_JWT_SECRET`.
- JWT sessions expire after 12h.

## How it connects to the desktop product
The key string this portal produces (`RSL1.<payload>.<signature>`) is identical
in format to keys made by `tools/license-gen.js`, and is verified by the desktop
app's embedded public key (`desktop/license_public.pem`). So: salesperson clicks
Generate → copies the key → client pastes it into RightServe's activation screen.
