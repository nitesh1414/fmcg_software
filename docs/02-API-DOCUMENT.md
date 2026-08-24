# RightServe — API Document

**Version:** 1.0.0
**Base URL:** `http://127.0.0.1:<port>/api` (desktop picks a free port; web defaults to `http://localhost:4000/api`)
**Format:** JSON request/response (`Content-Type: application/json`)
**Auth:** JWT Bearer token (except where noted)

---

## 1. Conventions

### 1.1 Authentication
Most endpoints require an `Authorization` header:

```
Authorization: Bearer <JWT>
```

- Obtain a token via `POST /api/auth/login`.
- Tokens expire after **7 days** (`expiresIn: '7d'`).
- Missing/invalid token → `401 { "error": "Authentication required" }` or `401 { "error": "Invalid or expired token" }`.
- Admin-only endpoints return `403 { "error": "Admin access required" }` for non-admins.

### 1.2 Standard errors
| HTTP | Meaning | Body |
|------|---------|------|
| 400 | Validation error | `{ "error": "<reason>" }` |
| 401 | Not authenticated | `{ "error": "Authentication required" }` |
| 403 | Forbidden (admin) | `{ "error": "Admin access required" }` |
| 404 | Not found | `{ "error": "Not found" }` |
| 409 | Conflict (duplicate) | `{ "error": "DUPLICATE_BATCH", "message": "...", "matches": [...] }` |
| 422 | GSTR-1 validation failed | `{ "error": "...", "validation": { errors:[], warnings:[] } }` |
| 423 | Read-only mode (license expired) | `{ "error": "...", "code": "READ_ONLY" }` |
| 500 | Server error | `{ "error": "<message>" }` |

### 1.3 Read-only mode
When the desktop license is **expired**, the server runs with `RS_READONLY=1`.
All non-GET requests (except `/auth` and `/backup`) return **423 READ_ONLY**.

---

## 2. Auth — `/api/auth`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/register` | none | Create user. **First user becomes `admin`**, rest `staff`. |
| POST | `/login` | none | Authenticate, returns token + user. |
| GET | `/me` | yes | Current user (incl. saved theme). |
| PUT | `/theme` | yes | Save per-user theme prefs. |
| GET | `/users` | yes | List users. |

**POST `/login`**
```json
// request
{ "username": "admin", "password": "admin123" }
// response 200
{ "token": "<JWT>", "user": { "id":1, "name":"...", "username":"admin", "role":"admin", "theme": { "palette":"teal", "density":"comfortable", "textSize":"normal" } } }
// error 401
{ "error": "Invalid credentials" }
```

**PUT `/theme`**
```json
// request
{ "palette": "indigo", "density": "compact", "textSize": "large" }
// response
{ "ok": true, "theme": { "palette":"indigo", "density":"compact", "textSize":"large" } }
```

---

## 3. Items & Stock — `/api/items`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List active items (with base-unit `stock`, `stock_label`, `units[]`). |
| GET | `/:id` | Item detail incl. `batches[]`, `units[]`, `base_unit`. |
| GET | `/barcode/:code` | Resolve a (any-level) barcode → `{ item, unit, factor }`. |
| POST | `/` | Create item (with packaging `units[]`). |
| PUT | `/:id` | Update item (replaces packaging `units[]`). |
| DELETE | `/:id` | Delete item (cascades batches & units). |
| GET | `/:id/batches` | Batches for an item (base units). |
| GET | `/batches/check/:batchNo` | Duplicate-serial check. |
| POST | `/:id/batches` | Add a batch (stock-in). |
| PUT | `/batches/:batchId` | Edit a batch. |
| DELETE | `/batches/:batchId` | Delete a batch. |
| GET | `/categories` | List categories (multi-level via `parent_id`). |
| POST | `/categories` | Create category. |
| PUT | `/categories/:id` | Rename / re-parent category. |
| DELETE | `/categories/:id` | Delete category. |

**POST `/` (item — Unit Conversion Engine)**

`units[]` is the packaging ladder. Exactly one row must be the **base unit**
(`factor: 1`); larger units give how many base units they equal. Each level can
carry its own `purchase_price`, `sale_price` and `barcode`. Stock is always kept
in the base unit. (Omitting `units[]` falls back to a single base unit derived
from the legacy `unit`/prices.)

```json
{
  "name": "Parle-G Biscuit 100g",
  "sku": "PG100",
  "category_id": 3,
  "hsn": "1905",
  "gst_rate": 18,
  "low_stock_alert": 50,
  "units": [
    { "unit_name": "Piece",  "factor": 1,    "purchase_price": 8,    "sale_price": 10,    "barcode": "8901000000010" },
    { "unit_name": "Pack",   "factor": 10,   "purchase_price": 75,   "sale_price": 95,    "barcode": "8901000000027" },
    { "unit_name": "Box",    "factor": 120,  "purchase_price": 880,  "sale_price": 1120,  "barcode": "8901000000034" },
    { "unit_name": "Carton", "factor": 2400, "purchase_price": 17000,"sale_price": 22000, "barcode": "8901000000041" }
  ]
}
```

Invoice lines then bill in any unit via `{ "unit": "Carton", "unit_factor": 2400, "qty": 2 }`;
the server converts to base units (`base_qty = qty × unit_factor`) for stock.

**POST `/:id/batches`**
```json
{
  "batch_no": "B-2026-001",
  "mfg_date": "2026-01-01",
  "expiry_date": "2026-12-31",
  "purchase_price": 8,
  "mrp": 12,
  "qty_in": 500
}
```

---

## 4. Parties — `/api/parties`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/?type=customer|supplier` | List parties (optional filter). |
| GET | `/:id` | Party detail + ledger (invoices, payments, balance). |
| POST | `/` | Create party. |
| PUT | `/:id` | Update party. |
| DELETE | `/:id` | Delete party. |

**POST `/`**
```json
{ "name": "Sharma Stores", "type": "customer", "phone": "9876500000",
  "email": "", "gstin": "27AAPFU0939F1ZV", "address": "...", "state": "Maharashtra",
  "opening_balance": 0 }
```
> `opening_balance` positive = the party owes you (Dr).

---

## 5. Invoices — `/api/invoices`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/?type=sale|purchase&from=&to=` | List invoices in range. |
| GET | `/:id` | Invoice detail with line items. |
| POST | `/` | Create sale/purchase or credit/debit note. |
| DELETE | `/:id` | Delete invoice (restores stock). |

**POST `/`**
```json
{
  "type": "sale",
  "party_id": 5,                 // null/omit = walk-in
  "date": "2026-06-20",
  "discount": 0,                 // header-level discount (₹)
  "paid": 118,                   // amount received
  "pay_mode": "cash",
  "notes": "",
  "note_kind": "",               // "" | "credit" | "debit"
  "ref_invoice_no": "",          // for credit/debit notes
  "ref_invoice_date": "",
  "allowDuplicate": 0,           // 1 to bypass duplicate-batch guard (purchases)
  "items": [
    {
      "item_id": 12, "item_name": "Parle-G 100g", "hsn": "1905",
      "batch_id": 7,             // sale: optional (auto FEFO if omitted)
      "batch_no": "B-2026-001",  // purchase: new/existing batch
      "expiry_date": "2026-12-31",
      "qty": 10, "price": 10, "discount": 0, "gst_rate": 18, "mrp": 12
    }
  ]
}
```

**Responses / special cases**
- `200 { "id": <invoiceId>, ... }` on success.
- Insufficient stock (sale, when negative stock disabled): `400 { "error": "Insufficient stock for ..." }`.
- Duplicate batch (purchase): `409 { "error": "DUPLICATE_BATCH", "message": "...", "matches": [...] }` — resend with `"allowDuplicate": 1`.
- Server computes per-line `taxable`, `tax_amount`, `line_total`, splits tax into CGST/SGST, and applies round-off if `autoRoundOff` feature is on.

---

## 6. Payments — `/api/payments`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List receipts & payments. |
| POST | `/` | Record a receipt (`in`) or payment (`out`). |
| DELETE | `/:id` | Delete a payment. |

```json
// POST /
{ "party_id": 5, "type": "in", "amount": 500, "mode": "upi", "date": "2026-06-20", "notes": "" }
```

---

## 7. Reports — `/api/reports`

| Path | Description | Key params |
|------|-------------|-----------|
| GET `/dashboard` | Dashboard KPIs | — |
| GET `/stock` | Batch/serial stock report | `status=all|available|sold` |
| GET `/stock-search` | Stock typeahead | `q` |
| GET `/duplicate-serials` | Duplicate serial/batch alerts | — |
| GET `/transactions` | Sales/Purchase register | `type`, `from`, `to` |
| GET `/gst` | Rate-wise GST summary | `type`, `from`, `to` |
| GET `/outstanding` | Party outstanding | — |
| GET `/trace` | Who-bought/sold (batch/serial trace) | `type`, `q`, `batch` |
| GET `/locate/:batch` | Locate a batch | — |
| GET `/financial-years` | Available FYs (always incl. current) | — |
| GET `/current-fy` | The FY today falls in (auto-detected) | — |
| GET `/fy-balance` | FY balance & P&L | `fy` |
| GET `/gst-return` | GSTR-1/3B detail | `type`, `fy` |
| GET `/gst-months` | Months with sales | — |
| GET `/hsn-summary` | HSN summary (Table 12) | `fy` |
| GET `/gstr1-json` | Download GSTR-1 JSON | `month`, `download=1`, `force=1` |
| GET `/gstr1-summary` | GSTR-1 preview summary | `month` |
| GET `/gstr1-validate` | Validate GSTR-1 schema | `month` |

> `GET /gstr1-json` returns `422` with a `validation` object if the data fails
> schema checks; resend with `force=1` to download anyway.

---

## 8. Company & Features — `/api/company`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Company profile + merged `features`. |
| GET | `/feature-defaults` | Default feature flags. |
| PUT | `/` | Update company profile. |
| PATCH | `/features` | Update one or more feature toggles. |

**Feature flags** (defaults): `enableGST, enableBatch, enableExpiry, enableDiscount,
discountMode ('tcs'|'pct'), enableMRP, enableHSN, autoRoundOff, negativeStock,
duplicateSerialAlert, showStockInVoucher, printPreview, defaultPayMode,
invoiceFooter, b2clThreshold, autoHSN, gstinAutoFill, gstApiUrl, gstApiKey,
gstApiHeader, whatsappAutoSend, whatsappAutoPrompt, billJurisdiction,
billJurisdictionText, billPackets`.

> `billJurisdiction` prints a bottom line (default `SUBJECT TO <business state>
> JURISDICTION`; override with `billJurisdictionText`). `billPackets` prints
> `No. of Packets` on the final total row; the value is stored on the invoice
> as `no_of_packets`.

> `discountMode` picks the line-discount style: `tcs` = Trade + CD + SD columns
> (default), `pct` = a single % discount column.

```json
// PATCH /features
{ "autoRoundOff": false, "negativeStock": true }
```

---

## 9. Smart Lookups — `/api/lookup`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/hsn?q=<text>` | HSN code suggestions (desc + gst rate). |
| GET | `/hsn/:code` | HSN info (exact + prefix match). |
| GET | `/gstin/:gstin?online=0|1` | Decode GSTIN (state, PAN, entity type, checksum) + optional online enrichment. |

```json
// GET /gstin/27AAPFU0939F1ZV
{ "gstin":"27AAPFU0939F1ZV", "valid":true, "state":"Maharashtra",
  "stateCode":"27", "pan":"AAPFU0939F", "entityType":"Partnership Firm/LLP",
  "online": null }
```
> Online enrichment requires a GST API provider configured in Settings
> (`gstApiUrl`, `gstApiKey`, `gstApiHeader`). No free government API exists; offline
> decode always works.

---

## 10. Migration — `/api/migrate`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/preview` | Parse uploaded CSV, return mapping preview. |
| POST | `/commit` | Import the mapped rows. |
| GET | `/template/:entity` | Download a CSV template (`items`/`parties`). |

---

## 11. Backup — `/api/backup`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/download` | desktop or JWT | Consistent `.db` snapshot via `VACUUM INTO`. |
| GET | `/info` | JWT | DB path, size, record counts. |
| POST | `/wipe` | desktop or **admin** | Delete ALL data, keep schema + licence. |

> The desktop process may call `/download` and `/wipe` with header `x-desktop: 1`
> (local only) without a JWT. `/download` is allowed even in read-only mode (so
> users can back up before renewing).
>
> **`POST /wipe`** empties every data table, resets AUTOINCREMENT, and re-seeds
> the `company` + default `business` singletons. The next screen is the
> first-user **create-admin** setup. The desktop **software licence lives in
> Electron `userData`** (`license.dat`, `.rsmeta`, `.rsseal`) and is *not*
> touched — activation survives a wipe. Returns `{ ok: true }`.

---

## 12. PDF — `/api/pdf`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/invoice/:id` | Render an invoice as a PDF (pdfkit). |

---

## 13. License state — `/api/license-state`

Public (no auth) endpoint used by the UI for the read-only banner, License page,
and top-bar chip.

```json
{
  "readOnly": false,
  "state": "active",        // none|active|expiring|expired|invalid|web
  "desktop": true,
  "client": "Sharma FMCG Distributors",
  "plan": "Standard",
  "licenseId": "RS-0894FA64",
  "issued": "2026-06-20",
  "expires": "2027-06-20",  // null if perpetual
  "perpetual": false,
  "daysLeft": 365,          // null if perpetual
  "machineId": "C011-AAC8-44CF-0B59",
  "machineLocked": false
}
```
> In the plain web build (no desktop wrapper), `state` is `"web"` and licensing
> does not apply.

---

## 14. Health — `/api/health`

```json
// GET /api/health
{ "ok": true, "time": "2026-06-20T10:00:00.000Z" }
```

---

## 15. Quick cURL examples

```bash
# Login
TOK=$(curl -s -X POST http://127.0.0.1:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | jq -r .token)

# List items
curl -s http://127.0.0.1:4000/api/items -H "Authorization: Bearer $TOK"

# Create a sale
curl -s -X POST http://127.0.0.1:4000/api/invoices \
  -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"type":"sale","party_id":null,"items":[{"item_id":1,"item_name":"X","qty":2,"price":10,"gst_rate":18}],"paid":24}'

# Download backup
curl -s -o backup.db http://127.0.0.1:4000/api/backup/download -H "Authorization: Bearer $TOK"
```
