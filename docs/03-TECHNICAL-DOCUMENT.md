# RightServe — Technical Document

**Version:** 1.0.0
**Audience:** Architects, senior developers, integrators

---

## 1. Architecture Overview

RightServe is a **single-tenant, local-first** application. The same Node/Express
backend serves both the web build and the packaged desktop app; in desktop mode
Electron starts that backend in-process on a random localhost port and loads the
built React client from it.

```
┌─────────────────────────────────────────────────────────────┐
│                       Electron (desktop)                      │
│  main.js                                                      │
│   ├── License gate (license.js + license_public.pem)         │
│   │     none/invalid → activation.html                        │
│   │     active/expiring → main window                         │
│   │     expired → main window + RS_READONLY=1                 │
│   ├── starts Express backend in-process (random port)         │
│   ├── BrowserWindow → http://127.0.0.1:<port>                 │
│   └── File menu: backup / restore / delete-all, License menu  │
└───────────────┬──────────────────────────────────────────────┘
                │ HTTP (localhost)
┌───────────────▼──────────────────────────────────────────────┐
│                    Express backend (server/)                  │
│  index.js  → mounts /api/* routes, serves client/dist         │
│   read-only middleware (RS_READONLY) · /api/license-state     │
│  routes/* → auth, items, parties, invoices, payments,         │
│             reports, company, migrate, backup, lookup, pdf    │
│  db.js (better-sqlite3, WAL) · stock.js · fy.js · gstr1.js    │
└───────────────┬──────────────────────────────────────────────┘
                │
        ┌───────▼────────┐
        │  SQLite file   │  <userData>/fmcg.db  (desktop)
        │  (WAL mode)    │  server/data/fmcg.db (web/dev)
        └────────────────┘

   React client (client/) — built to client/dist, served by Express
   App.jsx → KeyboardProvider > ToastProvider > FeatureProvider >
             TallyFrame (chrome) > <Outlet/> (pages)
```

---

## 2. Technology Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| UI | React 18, React Router 6, Vite 5 | SPA, built to static assets |
| State/UX | Custom keyboard engine, Context providers, CSS-variable themes | No Redux |
| Backend | Node.js 20+, Express 4 | `start(port)` exported for reuse |
| DB | SQLite via better-sqlite3 (v12) | Synchronous, WAL mode, transactions |
| PDF | pdfkit | Invoice rendering |
| Auth | jsonwebtoken (JWT), bcryptjs | 7-day tokens |
| Desktop | Electron 31, electron-builder 24 | NSIS/DMG/AppImage |
| Licensing | Node `crypto` ed25519 | Offline signature verification |

---

## 3. Backend Design

### 3.1 App composition (`server/index.js`)
- `createApp()` builds the Express app, mounts routes, applies the read-only
  middleware, exposes `/api/license-state` and `/api/health`, and serves the
  static client (`CLIENT_DIST`).
- `start(port)` returns `{ server, port }`. Port `0` lets the OS pick a free port
  (used by Electron). Binds to `127.0.0.1` (never exposed externally).

### 3.2 Database (`server/db.js`)
- Opens SQLite at `process.env.DB_PATH` or `server/data/fmcg.db`.
- Pragmas: `journal_mode = WAL`, `foreign_keys = ON`.
- Schema created with `CREATE TABLE IF NOT EXISTS`.
- **Forward-compatible migrations** via `ensureColumn(table, col, ddl)` — adds
  columns to existing DBs without destructive migrations. Added over time:
  `company.features`, `company.fy_start_month`, `categories.parent_id`,
  `items.avg_cost`, `invoices.note_kind/ref_invoice_no/ref_invoice_date`,
  `users.theme_prefs`.

### 3.3 Data model (tables)

| Table | Key columns |
|-------|-------------|
| `users` | id, name, username (unique), password_hash, role (admin/staff), theme_prefs, active, sec_question, sec_answer_hash |
| `company` | id=1, name, gstin, state, state_code, invoice_prefix, terms, features (JSON), fy_start_month, last_fy |
| `businesses` | id, name, gstin, state, state_code, invoice_prefix, terms, fy_start_month, logo/signature/stamp/qr_image (base64), bank_*, upi_id, bill_format, bill_color + full colour palette, bill_title/signatory/billto_label/terms_heading/declaration/footer_note, bill_terms_list (JSON), is_default, active |
| `categories` | id, name, parent_id (self-FK) |
| `items` | id, name, sku, category_id, unit, **base_unit**, hsn, gst_rate, purchase_price, sale_price, low_stock_alert, avg_cost, description, track_serials, is_active |
| `item_units` | id, item_id, unit_name, **factor** (base units per 1), is_base, purchase_price, sale_price, barcode, sort_order |
| `batches` | id, item_id, **business_id**, batch_no, mfg_date, expiry_date, purchase_price, mrp, qty_in, qty_available (all in **base units**) |
| `parties` | id, name, type (customer/supplier), phone, email, gstin, address, state, opening_balance |
| `invoices` | id, invoice_no, type (sale/purchase), **business_id**, party_id, date, subtotal, discount, tax_total, total, paid, status, note_kind, ref_invoice_no/date |
| `invoice_items` | id, invoice_id, item_id, batch_id, item_name, description, serials, batch_no, hsn, qty, **unit, unit_factor, base_qty**, price, discount, disc_trade/cd/sd_pct/amt/mode, gst_rate, taxable, tax_amount, line_total |
| `payments` | id, party_id, invoice_id, **business_id**, type (in/out), amount, mode, date, notes |
| `serials` | id, business_id, item_id, serial_no, batch_no, status (in_stock/sold), purchase_invoice_id, sale_invoice_id |
| `eway_bills` | id, business_id, doc_no/date, transport & party details, taxable/cgst/sgst/igst/total, status |

Relationships: `item_units.item_id → items`, `batches.item_id → items`,
`invoice_items.invoice_id → invoices` (cascade), `invoice_items.item_id/batch_id
→ items/batches`, `payments.party_id → parties`. Stock, invoices and payments
are scoped per business via `business_id` (multi-business support).

### 3.4 Unit Conversion Engine (`server/units.js`)
- Every item has ONE **base unit** (smallest indivisible unit — Piece, Gram, ml,
  Bottle…). All `batches` quantities are stored in **base units**.
- `item_units` defines an unlimited packaging ladder (Piece → Pack → Box →
  Carton → Pallet, or Bottle → Crate, or Tablet → Strip → Box…), each level with
  an absolute conversion **factor** to the base unit and its own purchase price,
  sale price and barcode.
- Helpers: `toBaseQty(item, unit, qty)`, `humanizeQty(baseQty)` (e.g. `4435 →
  "1 Carton 16 Box 11 Pack 5 Piece"`), `normalizeUnits`, `saveItemUnits`,
  `findByBarcode` (any-level barcode → item + unit).
- Invoice lines carry `unit`, `unit_factor`, `base_qty`; stock always moves in
  base units (`base_qty = qty × factor`). Batch cost is normalised per base unit.
- One engine serves FMCG, pharma, hardware, paints, agriculture, beverages, etc.
  without changing the inventory core.

### 3.5 Inventory logic (`server/stock.js`, `server/serials.js`)
- **Stock-in** increases `batches.qty_in` and `qty_available` (base units).
- **Sale** issues from batches **FEFO** (earliest `expiry_date` first) when no
  batch is explicitly chosen, decrementing `qty_available` in base units.
- **Average costing** (`recalcAvgCost`) maintains `items.avg_cost`.
- **Negative-stock guard** can block oversell (feature `negativeStock`), with a
  unit-aware message ("Available 1 Box (120 Piece), requested 2 Carton …").
- **Serial tracking** (`serials.js`): register on purchase, mark sold on sale,
  block reselling/duplicate serials.
- **Duplicate-serial alert** warns when a purchase introduces an existing batch no.
- Invoice edit/deletion **reverses** stock (in base units) within a transaction.

### 3.6 GST engine
- `computeLine` derives `taxable`, `tax_amount`, `line_total`; tax split into
  CGST/SGST (intra-state) or IGST (inter-state by state code).
- Per-line discounts: **Trade / CD / SD** each computed on line gross and
  subtracted, or a single **% discount** (config `discountMode`). Each of
  Trade/CD/SD can be entered as a % or a flat ₹ amount (`disc_*_mode`).
- `fy.js` resolves financial years from `company.fy_start_month` (default April).
  `currentFy()` computes the FY that TODAY falls in, so reports and the dashboard
  **roll over automatically** at the start of a new FY. On boot the server logs
  the transition and stores `company.last_fy`.
- `gstr1.js` builds GSTR-1 JSON sections: B2B, B2CL (≥ `b2clThreshold`), B2CS,
  CDNR, CDNUR, NIL, HSN (Table 12), with UQC mapping (`uqc.js`).
- `gstr1validate.js` validates the generated JSON against schema rules.
- GSTIN handling (`lookup.js`): `decodeGstin` (format/checksum mod-36, state, PAN,
  entity type), `isValidGstinChecksum`, optional vendor-neutral online lookup.

### 3.7 Transactions & integrity
- All multi-step writes (invoice create/edit/delete, batch issue) run inside
  `db.transaction(...)` so partial failures roll back.
- Backups use `VACUUM INTO` for a consistent, fully-checkpointed snapshot.
- **Delete All Data** (`POST /api/backup/wipe`, or desktop File menu) empties
  every data table but keeps the schema and re-seeds the `company` + default
  `business` singletons, so the app restarts at the first-user setup screen. The
  desktop **software licence is stored separately** (Electron `userData`) and is
  never touched by a wipe.

---

## 4. Frontend Design

### 4.1 Composition (`client/src/App.jsx`)
- A single persistent `Shell` route mounts providers and chrome **once**, while a
  nested `<Outlet/>` swaps page components — avoids re-mounting on navigation.
- `ErrorBoundary` keyed by route path isolates a page crash from the whole app.
- Provider order: `AuthProvider` (main.jsx) → `KeyboardProvider` → `ToastProvider`
  → `FeatureProvider` → `ThemeProvider`.

### 4.2 Keyboard engine (`client/src/keyboard.jsx`)
- Global capture-phase keydown handler with a **stack** of hotkey maps; the
  active screen/modal wins.
- Typing in input/select/textarea suppresses plain letter/number hotkeys (only
  Ctrl/Alt/F-keys/Esc fire) — so typing "sale" never triggers menus.
- **Modal isolation:** when a modal is open, only modal-flagged maps are eligible.
- **Fall-through:** a handler returning `false` lets the next eligible map handle
  the key (used so the top-nav Esc closes a dropdown, else defers to the screen's
  "back to Dashboard").
- **Popup priority:** maps flagged `popup` are tried first (so a search dropdown's
  Esc closes the list before a parent modal's Esc closes the form).
- `useEnterNav` implements Tally-style Enter-to-next-field.

### 4.3 Chrome (`components/TallyFrame.jsx`)
- Top navigation tabs (Billing/Accounting/GST/Report/System, Alt+1..5), company
  name, **license status chip**, theme button, user chip.
- Function-key button bar driven by each page via `useScreenSetup`.
- Read-only banner when license expired.
- Modals hosted here: ConfigPanel (F12), StockLookup (Ctrl+K), ThemePanel
  (Ctrl+T), PrintPreview.

### 4.4 Theming (`theme.js`, `themeContext.jsx`)
- 8 palettes applied via CSS variables on `<html>`.
- `--on-primary` ensures text contrast; `--head-text` for dark themes.
- Per-user theme saved in `users.theme_prefs` and cached in localStorage
  (`stockveda_theme_u<id>`).

### 4.5 API client (`api/client.js`)
- `api.get/post/put/patch/del`, token in `Authorization` header.
- `401` → clears token and redirects to `/login`.
- `423` → dispatches `rs-readonly` event so the UI shows the banner.
- Helpers: `fetchPdfUrl`, `openPdf`, `downloadFile`, `downloadCSV`.

---

## 5. Desktop Wrapper (`desktop/`)

- `main.js` — license gate, in-process backend start, window creation, native
  menus (backup/restore/delete-all, License), expiry reminder dialogs.
- `preload.js` — minimal `window.desktop` bridge (`isElectron`, `license.enterKey`,
  `license.copyMachineId`).
- `activation.html` + `preload-activation.js` — activation/key-entry window.
- Paths: DB at `app.getPath('userData')/fmcg.db`; server + client shipped as
  `extraResources` (outside asar) so native modules and static files work.
- Build resources live in `desktop/buildres/` (icons, `installer.nsh`) — **not**
  `build/` (that folder name is excluded from this workspace's snapshots).

### 5.1 Native module ABI
`better-sqlite3` is native and must match the runtime ABI:
- Web/CLI (Node): `cd server && npm rebuild better-sqlite3`.
- Desktop (Electron): `desktop/rebuild-server-native.js` fetches the correct
  **prebuilt Electron binary** (better-sqlite3 v12 ships them) — no C++ compiler
  needed. Wired into all `dist:*` scripts.

### 5.2 Packaging (`desktop/package.json`)
- electron-builder: `appId com.rightserve.app`, `productName RightServe`.
- Targets: win NSIS (icon.ico), mac DMG, linux AppImage/deb.
- Custom NSIS (`buildres/installer.nsh`): on uninstall, prompts to delete all
  data; uses `customUnInstall` hook (no global Var to avoid NSIS warning-as-error);
  cleans both `%APPDATA%\RightServe` and `%LOCALAPPDATA%\RightServe` (+ legacy).
- The seed DB is excluded from the package so reinstalls start clean.

---

## 6. Licensing System

See `LICENSING.md` for operations. Technical summary:

- **Algorithm:** ed25519. RightServe holds the private key; the app embeds only
  the public key (`desktop/license_public.pem`) and verifies offline.
- **License block format:** `RSL1.<base64url(payload)>.<base64url(signature)>`.
- **Payload (JSON):** `{ v, id, client, plan, issued, expires|null, machine|null,
  reminderDays, notes }`. `expires:null` = perpetual; `machine:null` = any PC.
- **Machine fingerprint:** SHA-256 of MAC + hostname + platform + arch + CPU
  model, formatted `XXXX-XXXX-XXXX-XXXX`.
- **Evaluation states:** `none, active, expiring (≤reminderDays), expired,
  invalid`. Day math is date-only (`expires` is inclusive).
- **Anti-rollback:** `<userData>/.rsmeta` stores the highest date seen;
  `monotonicNow()` never returns earlier than that.
- **Enforcement:** expired → `RS_READONLY=1` → server blocks writes (423) and the
  UI shows banner/read-only. Activation persists the key to
  `<userData>/license.dat` and relaunches.

---

## 7. Security Considerations

| Area | Measure |
|------|---------|
| Passwords | bcrypt hashing (cost 10) |
| Sessions | JWT (HS256), 7-day expiry; secret via `JWT_SECRET` env |
| Network exposure | Backend binds to `127.0.0.1` only |
| License integrity | ed25519 signatures; tampering fails verification |
| Key theft | Private key never shipped; `.gitignore` excludes `tools/keys/` & `*.pem` (except shipped public key) |
| Desktop backup bypass | `x-desktop` header accepted only from localhost |
| Clock tampering | Monotonic date floor |

> Production deployments should set a strong `JWT_SECRET` (the default is a
> development placeholder).

---

## 8. Performance & Reliability

- `better-sqlite3` is synchronous and fast for single-user local workloads.
- WAL mode allows concurrent reads during writes; `VACUUM INTO` for clean backups.
- Single-instance lock (Electron) prevents two processes opening the DB.
- Indexes via primary keys and foreign-key columns; queries are bounded by date
  ranges/filters in reports.

---

## 9. Configuration / Environment Variables

| Variable | Used by | Purpose |
|----------|---------|---------|
| `DB_PATH` | server | SQLite file location |
| `CLIENT_DIST` | server | Static client directory |
| `PORT` | server | HTTP port (web; desktop uses 0/random) |
| `JWT_SECRET` | server | Token signing secret (**set in production**) |
| `RS_READONLY` | server | `1` = block writes (license expired) |
| `RS_LICENSE_STATE` | server | License state string for the UI |
| `RS_LICENSE_INFO` | server | JSON license details for the License page |
| `SEED_ON_FIRST_RUN` | desktop | `1` = copy bundled seed DB on first run |

---

## 10. Build & Release Pipeline

```
client:  npm install → npm run build           → client/dist
server:  npm install → npm rebuild better-sqlite3 (node) or
                       node desktop/rebuild-server-native.js (electron)
desktop: npm install → npm run dist:win|mac|linux
                       (runs build:ui + rebuild + electron-builder)
output:  desktop/release/RightServe-Setup-<version>.exe (etc.)
```
