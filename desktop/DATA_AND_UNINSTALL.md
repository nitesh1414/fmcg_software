# RightServe — Where data is stored, Backup & Uninstall

## Where your data lives
All data (invoices, items, parties, payments, GST, users, settings, theme) is stored
**locally on the computer** in a single SQLite database inside the app's user-data folder:

| OS | Location |
|----|----------|
| Windows | `%APPDATA%\RightServe\fmcg.db` (e.g. `C:\Users\<you>\AppData\Roaming\RightServe`) |
| macOS | `~/Library/Application Support/RightServe/fmcg.db` |
| Linux | `~/.config/RightServe/fmcg.db` |

Open it quickly from the app: **File → Open Data Folder**.

> Note: this folder is **separate** from where the app is *installed* (Program Files).
> That's why deleting the installation folder did **not** remove your data, and a
> reinstall showed the old data. This is now handled at uninstall time (below).

## Backup (do this regularly!)
- **In‑app:** Settings → *Backup & Data* → **Backup All Data (.db)**
- **Desktop menu:** **File → Backup All Data…** (Ctrl+B)

Backups use SQLite `VACUUM INTO`, so they are a complete, consistent snapshot
(including any uncommitted WAL data). Keep the `.db` file somewhere safe
(USB drive, cloud, etc.).

## Restore
- **Desktop menu:** **File → Restore From Backup…** → pick a `.db` file.
- The current data is replaced and the app reloads. (Restore is desktop‑only,
  since it must swap the live database file.)

## Delete all data
- **Desktop menu:** **File → Delete All Data…** — asks for **double confirmation**,
  erases the database and clears the login/theme cache, then restarts fresh.

## Uninstall behaviour (fixed)
When you uninstall RightServe from Windows, the uninstaller now **asks**:

> *"Do you also want to permanently DELETE all RightServe data on this computer?"*

- **Yes** → the entire `%APPDATA%\RightServe` **and** `%LOCALAPPDATA%\RightServe`
  (database + cache) is removed. A later reinstall starts **completely empty** —
  no old data, no auto‑login.
- **No** → data is kept so you can reinstall later and continue where you left off.

During an **automatic update** (not a manual uninstall) data is always preserved.

> Why this was needed: deleting the *installation* folder (Program Files) never
> touched the database, which lives in AppData. The new uninstaller prompt
> (`desktop/buildres/installer.nsh`, hooks `customUnInit` + `customUnInstall`)
> handles this. The installer also no longer ships a pre-seeded database, so a
> reinstall can never bring back data from the package itself.

### Maintainer note — `buildres/` (not `build/`)
The installer script and icons live in **`desktop/buildres/`**, *not* `build/`.
A folder literally named `build` is stripped from this project's workspace
snapshots, which previously caused `installer.nsh` to silently disappear and the
uninstall fix to "revert." Keep these files in `buildres/`.

> ⚠ Always take a backup before uninstalling if you might need the data again —
> deletion cannot be undone.
