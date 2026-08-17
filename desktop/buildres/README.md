# desktop/buildres — build resources (icons + NSIS installer script)

**⚠ Do NOT rename this folder to `build/`.**

This folder holds the electron-builder *build resources*:

| File | Purpose |
|------|---------|
| `icon.png` | 1024×1024 master app icon (mac/linux + auto-derived sizes) |
| `icon.ico` | multi-size Windows icon |
| ~~`icon.svg`~~ removed — edit `icon.png` directly or regenerate |
| `installer.nsh` | **custom NSIS uninstaller** — prompts to delete all data on uninstall |

## Why it's called `buildres` and not `build`

The default electron-builder convention is a `build/` folder, and earlier this
project used `desktop/build/`. **However, this project's workspace snapshots
exclude any directory literally named `build` (along with `dist`, `out`,
`node_modules`, caches, etc.).** That meant every time the project was reopened,
`desktop/build/installer.nsh` and the icons silently disappeared — so the
uninstall-time data-deletion fix kept "reverting." Renaming the folder to
`buildres` keeps these files persisted.

`desktop/package.json` is wired to this folder via:

```json
"directories": { "buildResources": "buildres" },
"win":   { "icon": "buildres/icon.ico" },
"mac":   { "icon": "buildres/icon.png" },
"linux": { "icon": "buildres/icon.png" },
"nsis":  { "include": "buildres/installer.nsh" }
```

## Regenerating the icons

```bash
cd desktop/buildres
# from icon.png
for s in 16 24 32 48 64 128 256; do magick icon.png -resize ${s}x${s} ico_$s.png; done
magick ico_16.png ico_24.png ico_32.png ico_48.png ico_64.png ico_128.png ico_256.png icon.ico
rm -f ico_*.png
```
