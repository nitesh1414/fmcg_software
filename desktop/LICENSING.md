# RightServe — Licensing Guide (for RightServe team)

RightServe desktop is **license-protected**. A fresh install will not run until a
valid license key is entered. Keys are **digitally signed** (ed25519) and verified
**offline** inside the app — clients cannot forge, edit or extend them.

## One-time setup (do this once, on YOUR machine)

```bash
cd fmcg-app
node tools/make-keys.js
```

This creates:

| File | Keep where | Purpose |
|------|------------|---------|
| `tools/keys/license_private.pem` | **SECRET — never share / never commit** | Signs (mints) license keys |
| `tools/keys/license_public.pem`  | — | Public half |
| `desktop/license_public.pem`     | shipped in the app | Verifies keys offline |

> ⚠ The private key is the master key. Anyone who has it can mint unlimited
> licenses. Keep it offline / backed up safely. If you ever regenerate it
> (`--force`), **all previously issued keys stop working**.

The `.gitignore` already excludes `tools/keys/` and `*.pem` (except the shipped
public key) so the private key is never committed.

## Issuing a key to a client

Run the generator and send the client the printed **LICENSE KEY** block
(by email / WhatsApp — it's just text).

```bash
# 1 year from today
node tools/license-gen.js --client "Sharma FMCG Distributors" --days 365

# Fixed expiry date
node tools/license-gen.js --client "ABC Traders" --expires 2027-03-31

# NEVER expires (perpetual) — for special clients
node tools/license-gen.js --client "VIP Client" --never

# Lock to ONE computer (client gives you their Machine ID from the
# activation screen). Then the key won't work on any other PC.
node tools/license-gen.js --client "XYZ Stores" --days 365 \
     --machine C011-AAC8-44CF-0B59

# Save to a file too
node tools/license-gen.js --client "ABC" --days 365 --out abc-license.txt
```

Options: `--client` (required), `--days N` / `--expires YYYY-MM-DD` / `--never`,
`--machine <ID>`, `--plan "Premium"`, `--reminder 15`, `--notes "..."`.

## What the client experiences

1. **First run / no license** → an **Activation screen** appears. The app will
   not start until they paste a valid key. The screen shows their **Machine ID**
   (needed only for machine-locked keys).
2. **Active license** → app runs normally.
3. **15 days before expiry** (configurable via `--reminder`) → on every launch a
   **renewal reminder** pops up with your contact details, so they can call you
   to renew in time. They can keep using the app meanwhile.
4. **After expiry** → the app starts in **READ-ONLY mode**: they can still view,
   search, print and **back up** their data, but cannot create/edit invoices,
   items, parties or payments until they enter a renewed key. A yellow banner is
   shown across the top.
5. **Never-expiry keys** → never warn, never lock.

### Renewing
The client opens **Help → License Details / Enter Key…**, clicks **Enter New
Key…**, pastes the new key. The app saves it and restarts — back to full
read/write. (Renewing replaces the old key; data is untouched.)

## Online activation vs. daily use (offline)

- **Internet is needed ONCE**, only when the client first activates an online
  key (the app claims it at the portal to bind it to that one computer).
- **After activation the app runs fully OFFLINE.** A local "activation seal"
  (`<userData>/.rsseal`) records that this install is activated. Every subsequent
  launch/login checks only local files (signature + seal + date) — it makes
  **zero network calls**. No daily/online re-authentication.
- Offline keys (generated without an activation URL) never contact the internet
  at all.

### Stable device identity
- On first run the app stores a random, stable **device id** in
  `<userData>/device.id`. This is the machine identity used by the seal.
- Because it's persisted, changing Wi-Fi/Ethernet/VPN adapters, MAC address or
  hostname does **not** change the identity — so the app never wrongly thinks
  it's a "different computer" and never demands re-activation on a normal launch.
- If an existing (old-build) seal has a different fingerprint, it is
  transparently **self-healed** to the stable id on next launch — no
  re-activation prompt on upgrade.

## Security notes

- Keys are verified with the embedded **public** key — no internet needed.
- Editing/truncating a key fails the **signature check** ("tampered").
- **Clock rollback** is mitigated: the app remembers the latest date it has seen
  (`<userData>/.rsmeta`), so setting the PC clock back won't revive an expired
  license.
- One-device misuse is prevented **at activation time** by the portal's
  one-device binding (server-side), plus the local seal. Copying an activated
  install's files to another PC (without the seal) still forces re-activation.
- The license file lives at:
  - Windows: `%APPDATA%\RightServe\license.dat`
  - macOS: `~/Library/Application Support/RightServe/license.dat`
  - Linux: `~/.config/RightServe/license.dat`

## Files involved
- `desktop/license.js` — verify / evaluate / machine-id (shared core)
- `desktop/activation.html` + `desktop/preload-activation.js` — activation UI
- `desktop/license_public.pem` — shipped public key
- `desktop/main.js` — startup gate, reminder dialog, read-only env, License menu
- `server/index.js` — read-only middleware + `/api/license-state`
- `tools/make-keys.js`, `tools/license-gen.js` — your private tooling
