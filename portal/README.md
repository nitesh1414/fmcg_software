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
- Create, **edit** and **delete their own** clients
- **Generate** a license key for a client (1yr / 2yr / 3mo / custom days / until a
  date / **lifetime**, optional machine-lock). Pick **Desktop**, **Mobile**, or
  **both** (two keys, same client and term — each device needs its own key)
- **Sell add-ons later** — a client who bought the standalone **Desktop** license
  can be sold the **Mobile** app afterwards. The add-on key hangs off their base
  license and, by default, **ends on the same day** so everything renews together
- **Edit** a license (plan, term, machine lock, product, notes, reminder). Notes
  and reminders save silently; anything inside the signed key **re-issues a new
  key** and archives the old one
- **Renew** a client's license (issues a fresh key, keeps history, optionally
  carries unused days forward)
- **Delete** a license issued by mistake, and **transfer** an activation to a new
  device when a client changes computer
- Copy/resend any of their licenses' keys
- See their dashboard: clients, active / expiring / expired, renewals due,
  desktop vs mobile keys, add-ons sold, and **add-on opportunities**

### Admin can (everything above, company-wide) plus
- See **all clients**, when created, **license expiry**, status, and **which
  salesperson** created each
- **Edit / delete any client** (deleting a client that already has licenses needs
  an explicit confirm — it invalidates keys already in the field)
- Re-assign a client to another salesperson (Edit client → owner)
- **Sales Team management**: create salespeople, **edit** them (name, username,
  email, phone, role, enable/disable), reset passwords, **delete** them — their
  clients and licenses are kept and can be **handed to another salesperson** in
  the same dialog. The last active admin can't be removed or demoted
- **Revoke** and **restore** licenses, delete activated licenses
- Company-wide dashboard + team performance

### Works on any device
The portal UI is responsive from a 360 px phone to a wide monitor: the sidebar
becomes a slide-in drawer, tables collapse into self-labelling cards, modals
become full-screen sheets, and touch targets/inputs are sized for thumbs (16 px
inputs so iOS doesn't zoom).

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

## How it connects to the desktop and mobile apps
The key string this portal produces (`RSL1.<payload>.<signature>`) is identical
in format to keys made by `tools/license-gen.js`. Desktop verifies with
`desktop/license_public.pem`; the mobile app uses the same public key.

Each **product** (Desktop / Mobile) gets its **own key** because activation binds
one device. Same client can hold both. A mobile key is rejected on the PC and a
desktop key should be rejected on the phone. Generate **Desktop + Mobile** to
issue two keys in one step; or generate the second product later on the same client.

### Base licenses vs add-ons
The first product a client buys is stored as a **base** license. Anything added
afterwards (typical case: *standalone desktop first, mobile a few months later*)
is an **add-on**:

- it links to the base license (`licenses.parent_id`, and `parent` inside the key)
- its expiry defaults to the base license's expiry (**co-terminate**), so the
  client renews desktop + mobile in one payment
- renewing the base license moves its add-ons onto the renewed key automatically
- the client screen shows what a client **runs** and what is **still missing**,
  and the dashboard lists every client that runs only one product as an
  **add-on opportunity**

A client can hold at most one live key per product — trying to issue a second
one is refused with `PRODUCT_ALREADY_LICENSED` (renew it, or pass `force: true`).

## Tests
```bash
cd portal/server && npm test    # API lifecycle: base → add-on → edit → renew → revoke → delete
cd portal/client && npm test    # real React app in jsdom driven against the real API
```
Both suites create a throwaway SQLite DB — they never touch `server/data/portal.db`.
The API suite also verifies that keys minted here still pass the **desktop app's
own** offline check (`desktop/license.js` + `desktop/license_public.pem`), and
that a mobile add-on key is refused by the desktop app.

## API summary (all under `/api`, JWT except `/activate`)
| Method & path | Purpose |
|---|---|
| `POST /auth/login`, `GET /auth/me`, `PUT /auth/password` | session |
| `GET/POST /users`, `PUT/DELETE /users/:id`, `POST /users/:id/reset-password` | sales team (admin). `DELETE` accepts `?reassign_to=<id>` |
| `GET/POST /clients`, `GET/PUT/DELETE /clients/:id` | clients. `PUT` can move the owner; `DELETE` needs `?force=1` when licenses exist |
| `POST /licenses` | issue a key — `product: desktop\|mobile\|both`, `kind: base\|addon`, `parent_id`, `matchBaseExpiry` |
| `POST /licenses/:id/renew` | renew (carries unused days by default) |
| `PUT /licenses/:id` | edit; re-issues the key when a signed field changes |
| `GET /licenses/:id/key`, `GET /licenses/:id/keys` | current key / superseded-key history |
| `POST /licenses/:id/revoke` \| `/restore` \| `/reset-activation` | lifecycle + device transfer (revoke/restore: admin) |
| `DELETE /licenses/:id` | delete a license (`?force=1` once activated) |
| `GET /licenses/client/:clientId` | a client's licenses grouped by product |
| `GET /dashboard` | counts incl. per-product + add-on opportunities |
| `POST /activate` | **public** — called by the installed app to bind a device |
