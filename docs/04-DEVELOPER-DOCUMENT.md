# RightServe — Developer Document

**Version:** 1.0.0
**Audience:** Developers setting up, building, and extending RightServe

---

## 1. Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20 LTS or 22 | Has built-in `fetch`; v24 also works with better-sqlite3 v12 |
| npm | 10+ | Comes with Node |
| Git | any | Source control |
| Build tools | OS toolchain | Only needed if a native prebuilt is unavailable |
| (Windows installer) | NSIS via electron-builder | Auto-downloaded by electron-builder |

> **Native module note:** `better-sqlite3` is native. v12 ships prebuilt binaries
> for Node 20/22/24 **and** Electron, so a C++ compiler is normally NOT required.

---

## 2. Repository Layout

```
fmcg-app/
├── README.md
├── start.sh                     # one-shot build + run (web)
├── docs/                        # ← this documentation set
├── client/                      # React + Vite frontend
│   ├── index.html
│   ├── vite.config.js           # dev proxy /api → :4000
│   └── src/
│       ├── App.jsx main.jsx auth.jsx keyboard.jsx features.jsx
│       ├── theme.js themeContext.jsx nav.js styles.css
│       ├── api/ (client.js, csv.js)
│       ├── components/ (TallyFrame, ui, ListScreen, ProductSearch,
│       │                PartySearch, HsnSearch, ConfigPanel, ThemePanel,
│       │                PrintPreview, StockLookup, ErrorBoundary, Icon)
│       └── pages/ (Dashboard, Login, Items, Inventory, Parties, Invoices,
│                   Payments, Reports, Settings, Support, Migrate, Help, License)
├── server/                      # Node + Express backend
│   ├── index.js db.js seed.js auth.js stock.js fy.js
│   ├── gstr1.js gstr1validate.js uqc.js csvparse.js lookup.js
│   ├── data/ (hsn.json, fmcg.db)
│   └── routes/ (auth, items, parties, invoices, payments, reports,
│                company, migrate, backup, lookup, pdf)
├── desktop/                     # Electron wrapper
│   ├── main.js preload.js preload-activation.js activation.html
│   ├── license.js license_public.pem rebuild-server-native.js
│   ├── buildres/ (icon.png, icon.ico, installer.nsh, README.md)
│   ├── LICENSING.md DATA_AND_UNINSTALL.md CODE_SIGNING.md
│   └── package.json (electron-builder config)
└── tools/                       # license tooling (private)
    ├── make-keys.js license-gen.js
    └── keys/ (license_private.pem, license_public.pem)  ← gitignored
```

---

## 3. Quick Start (Web / Dev)

### 3.1 One-shot
```bash
cd fmcg-app
./start.sh      # installs deps, builds UI, seeds demo, runs on :4000
```
Open http://localhost:4000 — login **admin / admin123**.

### 3.2 Manual
```bash
# Backend
cd server
npm install
npm rebuild better-sqlite3        # match Node ABI
npm run seed                      # demo data (admin/admin123)
npm start                         # http://localhost:4000

# Frontend (separate terminal, hot reload)
cd client
npm install
npm run dev                       # http://localhost:5173 (proxies /api → :4000)
```

> Dev mode: edit React with hot reload on :5173 while the API runs on :4000.
> Production-style: `cd client && npm run build`, then the server serves
> `client/dist` directly on :4000.

---

## 4. Running the Desktop App (Dev)

```bash
# 1. Build the UI once
cd client && npm install && npm run build

# 2. Desktop deps + native rebuild for Electron
cd ../desktop
npm install                       # postinstall runs electron-builder install-app-deps
node rebuild-server-native.js     # ensures server's better-sqlite3 matches Electron ABI

# 3. Run
npm start                         # launches Electron → activation or main app
```

> First run will show the **Activation screen** unless a license exists. Generate
> a dev license (see §7) and paste it.

---

## 5. Building Installers

```bash
cd desktop
npm run dist:win      # Windows  → release/RightServe-Setup-<version>.exe
npm run dist:mac      # macOS    → .dmg
npm run dist:linux    # Linux    → .AppImage + .deb
```
Each `dist:*` script: builds the UI → `rebuild-server-native.js` → electron-builder.
Cross-compiling is best done on the matching OS or CI.

**Building the Windows installer on Linux** (e.g. CI/sandbox) needs **Wine** with
a 32-bit prefix (electron-builder runs `rcedit-ia32.exe` to stamp the exe
icon/version):

```bash
sudo dpkg --add-architecture i386 && sudo apt-get update
sudo apt-get install -y wine wine32:i386
export XDG_RUNTIME_DIR=/tmp/xdg-run && mkdir -p $XDG_RUNTIME_DIR && chmod 700 $XDG_RUNTIME_DIR
export WINEPREFIX=$HOME/.wine WINEARCH=win64 && wineboot --init   # creates syswow64
cd desktop && npm run dist:win
```

The Linux `.deb` target requires `homepage` in `desktop/package.json` (already
set) — without it fpm fails with *"Please specify project homepage"*.

---

## 6. Common Tasks / Recipes

### 6.1 Reset the database
```bash
cd server && rm -f data/fmcg.db* && node seed.js
```
Or, at runtime, **Delete All Data** (`POST /api/backup/wipe`, admin or desktop)
empties every table, re-seeds the `company`/default `business` singletons, and
returns the app to first-user setup — **without** deleting the desktop licence
(stored in Electron `userData`, not in the DB).

### 6.1a Feature toggle defaults (client + server must match)
Feature defaults live in **two** places — keep them in sync:
`server/routes/company.js` (`DEFAULT_FEATURES`) and
`client/src/features.jsx` (`DEFAULT_FEATURES`).

### 6.2 Switch between Node and Electron runtimes
```bash
# For web/CLI:
cd server && npm rebuild better-sqlite3
# For desktop:
cd desktop && node rebuild-server-native.js
```

### 6.3 Add a new API route
1. Create `server/routes/<name>.js` exporting an Express `router`.
2. Mount it in `server/index.js`: `app.use('/api/<name>', authRequired, require('./routes/<name>'))`.
3. If it writes data, it is automatically covered by the read-only middleware.

### 6.4 Add a new page/screen
1. Create `client/src/pages/<Name>.jsx`.
2. Add a `<Route>` in `client/src/App.jsx`.
3. Add a nav entry in `client/src/nav.js` (choose a section + optional hotkey).
4. Use `useScreenSetup({ title, sub, buttons })` for the chrome + function keys,
   and `useHotkeys({...})` for shortcuts (remember the Esc-to-Dashboard pattern).

### 6.5 Add a feature toggle
1. Add the default to `DEFAULT_FEATURES` in `server/routes/company.js`.
2. Read it in the client via `useFeatures()` and gate UI accordingly.
3. Expose a checkbox in `client/src/pages/Settings.jsx`.

### 6.6 Add an icon
Add an SVG path to the `P` map in `client/src/components/Icon.jsx`.

---

## 7. License Tooling (Private)

```bash
# One-time: create the signing keypair (keeps private key in tools/keys/)
node tools/make-keys.js

# Mint a license for a client
node tools/license-gen.js --client "Sharma FMCG" --days 365
node tools/license-gen.js --client "VIP" --never                 # perpetual
node tools/license-gen.js --client "XYZ" --days 365 --machine C011-AAC8-44CF-0B59
```
> **Never commit `tools/keys/license_private.pem`.** `.gitignore` excludes it.
> Regenerating the keypair invalidates all previously issued licenses.

See `desktop/LICENSING.md` for the full operations guide.

---

## 8. Coding Conventions

- **Language:** modern JS (CommonJS on the server, ESM/JSX on the client).
- **No heavy state libs** — React Context + hooks only.
- **`useEffect` MUST NOT receive a function reference or an `async` callback.**
  A function that returns a Promise (e.g. `() => api.get(...).then(...)`) makes
  React treat that Promise as the effect *cleanup* and call it on unmount →
  `TypeError: n is not a function` (a real bug we hit). Always wrap it:
  ```js
  // ❌ wrong — load() returns a Promise used as cleanup
  const load = () => api.get('/x').then(setX);
  useEffect(load, []);
  useEffect(async () => { ... }, []);

  // ✅ correct
  useEffect(() => { load(); }, []);
  useEffect(() => { (async () => { ... })(); }, []);
  ```
  This is enforced automatically by **`client/scripts/lint-effects.mjs`**, which
  runs via `npm run lint` and as the `prebuild` step (so `npm run build` fails if
  the pattern reappears). To intentionally allow a line, append
  `// lint-effects-ok`.
- **Keyboard-first:** every screen should support Esc (back to Dashboard), Enter
  (next field/confirm), and relevant F-keys via `useScreenSetup`.
- **Theme-safe CSS:** use CSS variables (`var(--primary)`, `var(--on-primary)`)
  rather than hard-coded colors so all 8 palettes work.
- **Money math:** round at the boundary; the server is the source of truth for
  invoice totals (it re-computes lines and applies round-off).
- **DB writes:** wrap multi-step writes in `db.transaction(...)`.

---

## 9. Testing & Verification

The project uses manual + scripted verification (no formal test runner shipped):

```bash
# Backend smoke test
cd server && npm start &
TOK=$(curl -s -X POST localhost:4000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | jq -r .token)
curl -s localhost:4000/api/items -H "Authorization: Bearer $TOK"

# License core test
node -e "const L=require('./desktop/license.js'); console.log(L.machineId())"
```
For UI verification, a headless Chromium (Puppeteer) or Electron + xvfb screenshot
harness can be used; capture pages after logging in by setting
`localStorage.fmcg_token` and loading the URL.

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Cannot find module 'express'` | server deps not installed | `cd server && npm install` |
| `NODE_MODULE_VERSION` mismatch | better-sqlite3 built for wrong runtime | `npm rebuild better-sqlite3` (node) or `node desktop/rebuild-server-native.js` (electron) |
| Install fails compiling better-sqlite3 on Node 24 | old v11 has no Node-24 prebuilt | use better-sqlite3 **v12** (already set) |
| NSIS `warning treated as error` | unused NSIS Var / encoding | keep logic inside `customUnInstall`, use ASCII in description |
| `signtoolOptions` unknown property | electron-builder v24 schema | use `signingHashAlgorithms` directly under `win` |
| Activation screen won't accept key | wrong/expired key or wrong public key | verify key with the matching `license_public.pem` |
| App shows old data after reinstall | data lives in userData, not install dir | uninstaller now prompts to delete; or Settings → Delete All Data |
| Build resources disappear between sessions | folder named `build/` is snapshot-excluded | resources are in `desktop/buildres/` |
| `wine is required` when building `--win` on Linux | no Wine / no 32-bit prefix | install `wine` + `wine32:i386`, run `wineboot --init` (see §5) |
| `.deb` build fails: *specify project homepage* | fpm needs metadata | `homepage` is set in `desktop/package.json` |
| Delete All Data logs user out | it also deletes the users table | expected — app returns to create-first-user; licence is kept |

---

## 11. Release Checklist

- [ ] `node tools/make-keys.js` has been run once; production public key embedded
- [ ] Strong `JWT_SECRET` configured for production
- [ ] `client && npm run build` succeeds
- [ ] `desktop && npm run dist:win` (and mac/linux as needed) succeeds
- [ ] Fresh install shows activation; a valid key starts the app
- [ ] Expired key → read-only mode; renewing restores read/write
- [ ] Backup/restore verified; uninstall prompt verified
- [ ] Version bumped in `desktop/package.json` and `server/package.json`
