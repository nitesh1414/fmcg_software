# RightServe — Software Updates (team-provided, data preserved)

Updates are **controlled by the RightServe team**. The client does **not** download
anything from the internet. Your team gives the client the new installer file, and
the client installs it over the existing app. **All data is kept** — no uninstall.

- Data location (NEVER touched by an update):
  - Windows: `%APPDATA%\RightServe\fmcg.db`
  - macOS: `~/Library/Application Support/RightServe/fmcg.db`
  - Linux: `~/.config/RightServe/fmcg.db`
- The Windows NSIS installer detects an existing install and **upgrades in place**.
- During an update the uninstaller's "delete data?" prompt is **skipped**
  (`${isUpdated}`), so data is always preserved. No license re-activation needed.

---

## For the CLIENT — how to update (2 ways)

The RightServe team sends the new version file (e.g. `RightServe-Setup-1.1.0.exe`)
by pen-drive, email, WhatsApp, AnyDesk, or a shared folder.

**Option A — from inside the app (recommended):**
1. Open RightServe → menu **Help → Install Update from File…**
2. Select the file the team sent.
3. Confirm. The app closes, installs the update, and reopens — with all old data
   plus the new features.

**Option B — just double-click the file:**
- Double-click the installer the team sent and click through it. It upgrades the
  existing RightServe and keeps all data.

> **Help → Version & Updates…** shows the current version and how to get the latest
> from the RightServe team.

---

## For the TEAM — how to produce the update file

### 1. Bump the version
Edit `desktop/package.json` → `"version"` (e.g. `1.0.0` → `1.1.0`). Always increase
it so clients can tell it's newer.

### 2. Build the installer
```bash
cd desktop
npm install
npm run dist:win      # → desktop/release/RightServe-Setup-1.1.0.exe
# (npm run dist:mac / dist:linux for those platforms)
```

### 3. Send the single installer file to the client
- Windows: `desktop/release/RightServe-Setup-<version>.exe`
- macOS:   `desktop/release/RightServe-<version>.dmg`
- Linux:   `desktop/release/RightServe-<version>.AppImage` (or `.deb`)

That one file is everything the client needs. They install it over their existing
app (Option A or B above).

> No update server, no `latest.yml`, no internet check — fully team-controlled.

---

## Notes
- The Windows installer is `perMachine: false` (per-user) and reuses the same
  install location, so an update never creates a duplicate app.
- If the client is several versions behind, a single latest installer still
  upgrades them directly — data is migrated automatically on first launch
  (the database schema self-migrates).
- Always tell clients to keep a **backup** (File → Backup All Data) before any
  major change, as good practice.
- macOS may warn about an unidentified developer until the app is code-signed;
  the client can right-click → Open, or you can code-sign/notarize for a clean
  install (see CODE_SIGNING.md).
