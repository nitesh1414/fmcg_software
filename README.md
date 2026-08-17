# 🛒 RightServe — Inventory & Billing

**RightServe** is a simple, keyboard-first billing, inventory and accounting app built for **FMCG distributors and retailers**. Manage GST invoices, **batch-wise inventory** (with expiry tracking & FEFO auto-deduction), parties, payments and downloadable reports — all running locally on a lightweight SQLite database. Designed with **simplicity in mind to save the client's time**.

> **Designed & Developed by** [RightServe Infotech System](https://rightserveinfotechsystem.com/) & [LivePro Solutions](https://liveprosolutions.com/)

Runs as a **web app** *and* as a **cross-platform desktop application** (Windows / macOS / Linux) via Electron.

- **Frontend:** React (Vite) + React Router
- **Backend:** Node.js + Express
- **Database:** SQLite (`better-sqlite3`)
- **Auth:** JWT login (first registered user becomes admin)
- **Desktop:** Electron + electron-builder (bundles the server + UI into a single installable app)

---

## ✨ Features

### Billing & GST
- Create **Sales Invoices** and **Purchase Bills** with multiple line items
- **Product search type-ahead** in both sale & purchase vouchers — filter by name
  or code, navigate with ↑↓ and pick with Enter (shows live stock)
- Full **GST** support — per-item GST rate, HSN codes, automatic **CGST/SGST** split
- **Trade / CD / SD** per-line discounts (each as % or ₹) or a single % discount — switchable from F12; plus an optional bill-level extra discount
- Record payment (cash / UPI / bank / cheque) directly while billing
- **Download every invoice as a PDF** — **6 themed tax-invoice designs**
  (Vyapar / Marg / Miracle / Tally / Busy / Zoho style) with a full colour
  palette, editable labels & numbered terms, and **multi-page bills** that repeat
  the header/footer and carry the running total forward
- **Send bills on WhatsApp** — link your WhatsApp once (scan QR) and send the PDF
  to the customer; optional **auto-send** right after saving a sale

### Unit Conversion Engine (buy in one unit, sell in another ✅)
- Each item has a **base unit** (Piece / Bottle / Gram / Tablet…) plus an
  **unlimited packaging ladder** — e.g. `1 Pack = 10 Piece`, `1 Box = 12 Pack`,
  `1 Carton = 20 Box`, or `1 Crate = 24 Bottle`, or pharma `Tablet → Strip → Box`
- **Per-unit purchase price, sale price and barcode** at every level
- Stock is always kept in the **base unit** and shown in readable packaging
  (e.g. *"1 Carton 16 Box 5 Piece"*); billing in any unit converts automatically
- One engine for FMCG, pharma, electrical, hardware, paints, agriculture & more

### Multi-business
- Run several firms in one app with per-business stock, invoices & branding, and
  shared item/party masters

### Batch-wise Inventory (core requirement ✅)
- Every item can hold **multiple batches**, each with its own **batch no, mfg date, expiry date, cost, MRP and quantity**
- **Purchases automatically create / top-up batches** (stock-in)
- **Sales auto-deduct stock using FEFO** (First-Expiry-First-Out) — the nearest-to-expiry batch is sold first; you can also pick a specific batch
- In a **sale**, the batch picker lists **only unsold batches (qty available > 0)** with their **expiry dates** shown inline (and an "EXPIRED / Nd left" flag)
- Deleting an invoice **restores stock** correctly
- Filters for **low-stock**, **expiring (≤30 days)** and **expired** batches

### Parties & Ledger
- Customers & Suppliers with GSTIN, contact and opening balance
- Per-party **ledger** showing invoices, payments and running balance (Dr/Cr)

### Payments
- Standalone money-in / money-out entries, linked to parties (and optionally invoices)
- Net cash-flow summary

### Dashboard
- Today / month sales, receivables, payables, stock value
- 7-day sales bar chart, top-selling items
- **Low-stock and expiry alerts**

### Reports (downloadable as PDF / Excel-CSV ✅)
- Sales Report, Purchase Report
- **GST Report** (GSTR-1 / GSTR-2 style summary by rate)
- **Stock Report** (batch-wise)
- **Party Outstanding** report
- **Who-Bought (Batch / Serial Trace)** — search any product and/or batch/serial
  number to see **whom it was sold to** (customer, phone, invoice, date, qty)
- Every report and list exports to **CSV (opens directly in Excel)**; invoices export to **PDF**

### Settings & Multi-user
- Company/business profile used on invoices
- JWT login; first user is admin, more users can register
- **Financial year auto-rollover** — the current FY is detected from today's date
  and your FY start month (default April), so reports & the dashboard switch to
  the new year automatically
- **Delete All Data** (admin) — wipes all data but **keeps your software licence**
  and restarts at the create-first-user screen; take a backup first

### Tally/MARG-style keyboard UI
- Gateway menu, right-side F-key button bar, bottom status bar
- Enter = next field, Ctrl+A = accept/save, Esc = back, ↑↓ to navigate lists
- **F12 Configuration / Company Features** — toggle GST, batch inventory, expiry
  tracking, line discount, HSN column, auto round-off, allow-negative-stock,
  in-app print preview, default payment mode and invoice footer. Changes save
  instantly and the whole app (voucher columns, totals, validations, PDF footer)
  adapts to them.
- **In-app voucher print preview** — Ctrl+P / Alt+P shows the invoice PDF inside
  the app window (P = print, O = open in tab, Esc = close). Can be switched to
  "open in new tab" from F12.

---

## 🚀 Getting Started

### 1. Backend
```bash
cd server
npm install
npm run seed     # optional: loads demo data (login admin / admin123)
npm start        # runs API on http://localhost:4000
```

### 2. Frontend (development with hot-reload)
```bash
cd client
npm install
npm run dev      # opens http://localhost:5173 (proxies /api to :4000)
```

### Production (single server serves everything)
```bash
cd client && npm install && npm run build   # outputs client/dist
cd ../server && npm install && npm start     # serves API + built UI on :4000
```
Then open **http://localhost:4000**.

### Demo login
After running `npm run seed`:
- **Username:** `admin`
- **Password:** `admin123`

---

## 🖥️ Desktop App (Electron)

The same code runs as a native desktop app. The Electron main process **starts the Express + SQLite backend in-process** on a random local port and loads the React UI — no separate server window, no browser needed. The database is stored in the OS user-data folder so it survives app updates, and a **File → Backup Database…** menu item is included.

### Run the desktop app in development
```bash
cd desktop
npm install      # installs Electron and rebuilds better-sqlite3 for Electron's ABI
npm start        # launches the desktop window
```
> The `postinstall` step automatically rebuilds the native `better-sqlite3` module (located in `../server`) against Electron's ABI. If you ever switch between running the **web** server (`node`) and the **desktop** app (`electron`), re-run the matching rebuild:
> - For web/CLI: `cd server && npm rebuild better-sqlite3`
> - For desktop: `cd desktop && npm run rebuild`

### Build installers
```bash
cd desktop
npm run dist          # build for the current OS
# or target a specific platform:
npm run dist:win      # Windows  -> NSIS installer (.exe) in desktop/release/
npm run dist:mac      # macOS    -> .dmg
npm run dist:linux    # Linux    -> AppImage + .deb
```
Output installers are written to `desktop/release/`. (Cross-compiling for Windows/macOS is best done on the matching OS or CI.)

### How packaging works
- App code (`main.js`, `preload.js`, icons) is packed into `app.asar`.
- The **server** and built **client/dist** are shipped as `extraResources` (outside asar) so the native SQLite module and static files load correctly.
- App icon & installer: `desktop/buildres/` (icon.png, icon.ico, installer.nsh). NOTE: this folder is deliberately NOT named `build/` — see desktop/buildres/README.md.

---

---

## 🖥️ Desktop App (Electron)

The same app ships as a native **desktop application** for Windows, macOS and Linux via Electron — no browser or manual server start needed. It bundles the Node/Express server and the React UI, launches them in the background on a random local port, and shows everything in one window.

Desktop-specific niceties:
- **SQLite database stored in the OS user-data folder** (survives app updates). On Windows that's `%APPDATA%`, on macOS `~/Library/Application Support`, on Linux `~/.config`.
- **File → Backup Database…** menu to save a copy of your `.db` anywhere.
- **File → Open Data Folder** to find your data file.
- Single-instance lock (won't open the DB twice), native app menu, app icon.

### Run the desktop app in dev
```bash
# 1) build the UI once
cd client && npm install && npm run build

# 2) make sure the server deps are installed
cd ../server && npm install

# 3) install Electron deps (auto-rebuilds better-sqlite3 for Electron's ABI)
cd ../desktop && npm install
npm start
```

### Build installers
```bash
cd desktop
npm run dist:win     # Windows  -> .exe (NSIS installer) in desktop/release/
npm run dist:mac     # macOS    -> .dmg
npm run dist:linux   # Linux    -> .AppImage + .deb
npm run pack         # unpacked app only (no installer), for quick testing
```
> Build each platform's installer on that platform (or use a CI matrix). The output appears in `desktop/release/`.

**Important:** `better-sqlite3` is a native module and must be compiled for Electron's ABI. The `desktop` `postinstall` script runs `electron-rebuild` automatically against `../server`, so just run `npm install` inside `desktop/`.

---

## 📁 Project Structure
```
fmcg-app/
├── server/                 # Node + Express + SQLite
│   ├── index.js            # entry; mounts routes + serves built client
│   ├── db.js               # SQLite schema bootstrap
│   ├── auth.js             # JWT helpers / middleware
│   ├── seed.js             # demo data
│   ├── data/fmcg.db        # SQLite database file (auto-created)
│   └── routes/             # auth, items, parties, invoices, payments, reports, pdf, company
├── client/                 # React (Vite)
│   └── src/
│       ├── pages/          # Dashboard, Items, Inventory, Parties, Invoices, Payments, Reports, Settings, Login
│       ├── components/     # Layout, shared UI (modal, toast, badges, helpers)
│       └── api/            # fetch client, CSV export
└── desktop/                # Electron desktop wrapper
    ├── main.js             # boots embedded server + creates window + menus
    ├── preload.js          # secure contextIsolation bridge
    ├── buildres/           # icon.png, icon.ico, installer.nsh
    └── package.json        # electron-builder config (win/mac/linux targets)
```

## 🔧 Configuration
Environment variables (optional) for the server:
- `PORT` — API port (default `4000`)
- `DB_PATH` — SQLite file path (default `server/data/fmcg.db`)
- `JWT_SECRET` — change in production!

## 📝 Notes
- The database is a single SQLite file — easy to back up (just copy `server/data/fmcg.db`).
- All currency is shown in ₹ (INR).
- GST is computed as intra-state CGST+SGST split; adjust in `routes/pdf.js` / reports if you need IGST.
