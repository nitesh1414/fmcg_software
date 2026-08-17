# RightServe — Project Document

**Product:** RightServe — Inventory & Billing ERP
**Edition:** Desktop (Windows / macOS / Linux) + Web/Server
**Version:** 1.0.0
**Owner / Developer:** RightServe Infotech System & LivePro Solutions
**Support:** support@StockVeda.com · +91 86693 0888 / +91 94044 84560
**Document status:** Baseline (v1.0)

---

## 1. Purpose

RightServe is a fast, keyboard-first **inventory and GST billing** application for
**FMCG distributors and retailers** in India. It is modelled on the workflow of
Vyapar / MARG / Tally but is intentionally simpler, runs fully **offline** on a
single computer, and stores all data **locally** in a SQLite database.

This document describes the scope, goals, stakeholders, modules, and high-level
plan of the project. For technical depth see `03-TECHNICAL-DOCUMENT.md`; for APIs
see `02-API-DOCUMENT.md`; for setup see `04-DEVELOPER-DOCUMENT.md`; for end users
see `05-USER-MANUAL.md`.

---

## 2. Goals & Objectives

| # | Objective | Outcome |
|---|-----------|---------|
| G1 | Fast billing | Create a GST-compliant sale in seconds, fully on keyboard |
| G2 | Accurate stock | Batch/serial-wise inventory with FEFO and expiry tracking |
| G3 | GST compliance | CGST/SGST, HSN summary, GSTR-1 JSON export + validation |
| G4 | Works offline | No internet dependency; data on the local machine |
| G5 | Easy data safety | One-click backup / restore; data survives app updates |
| G6 | Commercial control | License-key activation, expiry reminders, read-only after expiry |
| G7 | Low support burden | Self-explanatory UI, in-app help, migration from other tools |

---

## 3. Scope

### 3.1 In scope (v1.0)
- Master data: items, multi-level categories, batches, parties (customers/suppliers)
- **Unit Conversion Engine**: base unit + unlimited packaging levels (Piece → Pack
  → Box → Carton…), per-unit prices & barcodes, buy/sell in any unit, stock kept
  in base units, human-readable packaging display — works for FMCG, pharma,
  hardware, paints, agriculture, beverages, etc.
- **Multi-business**: several firms in one app, per-business stock & transactions,
  shared item/party masters, per-business branding & bill format
- Transactions: sales, purchases, credit/debit notes, receipts & payments
- Discounts: per-line **Trade / CD / SD** (each % or ₹) or a single **% discount**
  (configurable), plus optional bill-level extra discount
- Inventory: batch/serial tracking, FEFO issue, expiry alerts, average costing
- GST: CGST/SGST/IGST split, HSN summary (Table 12), GSTR-1 JSON export + schema validation, B2B/B2CL/B2CS/CDNR/CDNUR/NIL sections, UQC mapping
- **E-Way Bills**: create, prefill from invoice, printable slip, GST-portal JSON
- Invoicing: **6 themed tax-invoice designs** (Vyapar/Marg/Miracle/Tally/Busy/Zoho
  style), full colour palette, editable labels & terms list, multi-page bills with
  repeating header/footer and carried-forward totals
- **WhatsApp**: link a device (QR) and send the bill PDF to the customer; optional
  auto-send after saving a sale
- Reports: sales/purchase registers, stock, outstanding, financial-year balance, batch/serial traceability, duplicate-serial alerts
- **Financial year auto-rollover**: current FY detected from today's date + FY
  start month; reports/dashboard switch automatically at year change
- Smart lookups: HSN auto-suggest, GSTIN decode + optional online enrichment
- Data: CSV import (Marg/Vyapar/Tally style), backup/restore, and **Delete All
  Data** (wipes data, keeps the licence, restarts at user creation)
- Desktop: installer, custom uninstall (with data-deletion choice), app icon
- Licensing: signed key activation, machine binding (optional), 15-day expiry reminder, read-only mode after expiry, never-expiry keys
- UX: 8 theme palettes, per-user themes, in-app PDF print preview

### 3.2 Out of scope (v1.0)
- Multi-branch cloud sync / online multi-tenant SaaS (a separate cloud portal
  manages clients & licences)
- E-invoice IRN/QR generation (e-way bill slips are supported)
- Mobile (Android/iOS) apps
- Payroll / accounting ledgers beyond party balances
- Online payment gateway integration

---

## 4. Stakeholders

| Role | Who | Interest |
|------|-----|----------|
| Vendor / Developer | RightServe Infotech System, LivePro Solutions | Build, license, support |
| Primary user | FMCG distributor / retailer owner & billing staff | Daily billing, stock, GST |
| Accountant / CA | Client's accountant | GST returns, registers |
| Support engineer | RightServe team | Activation, renewal, troubleshooting |

---

## 5. Module Overview

| Module | Description | Primary screens |
|--------|-------------|-----------------|
| Billing | Sales/purchase vouchers, credit/debit notes | Sales (F2), Purchases (F3) |
| Inventory | Items, categories, batches, expiry | Items (F6), Inventory (F7) |
| Accounting | Parties, receipts & payments, ledgers | Parties (F9), Payments (F4) |
| GST | Returns, GSTR-1 JSON, HSN summary | Reports → GST |
| Reports | Registers, stock, outstanding, trace | Reports (F10) |
| System | Settings, import, backup, license, help | Settings (F11), License, Support (F1) |

---

## 6. Technology Summary

- **Frontend:** React 18 + Vite, React Router, custom keyboard engine, CSS variables theming
- **Backend:** Node.js + Express, SQLite via `better-sqlite3` (WAL mode)
- **PDF:** pdfkit (invoice printing)
- **Desktop:** Electron + electron-builder (NSIS/DMG/AppImage)
- **Auth:** JWT (7-day tokens), bcryptjs password hashing
- **Licensing:** ed25519 signed license blocks, verified offline

See `03-TECHNICAL-DOCUMENT.md` for the full architecture.

---

## 7. Deliverables

1. Desktop installers — Windows `.exe` (NSIS), macOS `.dmg`, Linux `.AppImage`/`.deb`
2. Web/server build (optional self-host)
3. License generator tooling (private, RightServe only)
4. Documentation set (this `docs/` folder)
5. Seed/demo data for evaluation

---

## 8. High-Level Timeline (delivered)

| Phase | Content | Status |
|-------|---------|--------|
| 1 | Core billing, items, parties, auth | ✅ Delivered |
| 2 | GST, HSN, GSTR-1 JSON, reports | ✅ Delivered |
| 3 | Desktop packaging, themes, print preview | ✅ Delivered |
| 4 | Data migration, backup/restore, uninstall handling | ✅ Delivered |
| 5 | Smart lookups (HSN/GSTIN), quick-add parties, search | ✅ Delivered |
| 6 | Licensing (activation, expiry, read-only, machine lock) | ✅ Delivered |

---

## 9. Assumptions & Constraints

- One installation = one business, on one or few computers (data is local).
- The desktop edition is the licensed, commercial product. The web build is for
  development/self-host and is not license-gated.
- GST behaviour assumes Indian GST (CGST/SGST intra-state, IGST inter-state).
- A computer needs no internet to run; internet is only needed for optional
  GSTIN online enrichment and for the developer's build steps.

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Data loss (disk failure) | Built-in backup (VACUUM INTO), reminders before uninstall |
| License key sharing | Optional machine-locking per key |
| Clock tampering to extend license | Monotonic "max date seen" anti-rollback |
| Native module ABI mismatch (Node vs Electron) | `rebuild-server-native.js` fetches the correct prebuilt |
| Lost build resources between sessions | Build resources kept in `desktop/buildres/` (not `build/`) |

---

## 11. Glossary

- **FEFO** — First-Expiry-First-Out batch issue strategy.
- **Batch/Serial** — A tracked lot of stock with its own MRP, expiry, cost.
- **HSN** — Harmonised System of Nomenclature (GST product code).
- **UQC** — Unit Quantity Code (GST unit, e.g. PCS, KGS).
- **B2B/B2CL/B2CS** — GSTR-1 invoice categories.
- **CDNR/CDNUR** — Credit/Debit notes (registered / unregistered).
- **Perpetual license** — A license that never expires.
