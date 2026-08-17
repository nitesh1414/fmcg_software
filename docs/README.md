# RightServe — Documentation

This folder contains the complete documentation set for **RightServe — Inventory
& Billing ERP** (v1.0.0) by RightServe Infotech System & LivePro Solutions.

| # | Document | Audience | Contents |
|---|----------|----------|----------|
| 01 | [Project Document](01-PROJECT-DOCUMENT.md) | Everyone / management | Purpose, scope, modules, stakeholders, deliverables, risks |
| 02 | [API Document](02-API-DOCUMENT.md) | Integrators, backend devs | Every REST endpoint, request/response, errors, auth |
| 03 | [Technical Document](03-TECHNICAL-DOCUMENT.md) | Architects, senior devs | Architecture, data model, frontend/backend/desktop design, licensing internals, security |
| 04 | [Developer Document](04-DEVELOPER-DOCUMENT.md) | Developers | Setup, build, recipes, conventions, troubleshooting, release checklist |
| 05 | [User Manual](05-USER-MANUAL.md) | End users / clients | How to install, activate, bill, report, back up, renew |

### Related docs (in `../desktop/`)
- `LICENSING.md` — how to mint & manage license keys (RightServe team)
- `DATA_AND_UNINSTALL.md` — where data lives, backup & uninstall behaviour
- `CODE_SIGNING.md` — Windows code-signing notes
- `buildres/README.md` — why build resources live in `buildres/` (not `build/`)

### Quick links
- **Run (web):** `./start.sh` → http://localhost:4000 (admin / admin123)
- **Run (desktop):** see Developer Document §4
- **Build installers:** `cd desktop && npm run dist:win|mac|linux`
- **Support:** support@StockVeda.com · +91 86693 0888 / +91 94044 84560
