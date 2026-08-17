# "Publisher: Unknown" on Windows — Why & How to Fix

## What's happening (this is NOT a bug)

When you run the RightServe installer (`RightServe-Setup-x.x.x.exe`), Windows shows:

> **Publisher: Unknown**
> *Windows protected your PC* (SmartScreen blue popup), or
> *Do you want to allow this app from an **unknown publisher**?* (UAC yellow popup)

This appears for **every** Windows app that is **not code-signed** — including many legitimate apps before they buy a certificate. The app is safe and works fine; Windows just can't *cryptographically verify who published it*.

There is **no code/config setting that removes this warning** by itself. The only real fix is to **digitally sign the installer with a code-signing certificate**. Everything below explains your options.

---

## Option A — Buy a Code-Signing Certificate (recommended for distribution)

This is how commercial software removes the warning permanently.

### 1. Choose a certificate type
| Type | "Publisher: Unknown" gone? | SmartScreen reputation | Approx cost/yr |
|------|---------------------------|------------------------|----------------|
| **OV (Organization Validation)** | ✅ Yes (shows your company name) | Builds over time / downloads | ₹8,000–₹25,000 |
| **EV (Extended Validation)** | ✅ Yes | **Instant** SmartScreen trust | ₹25,000–₹50,000 |

Buy from: **Sectigo, DigiCert, GlobalSign, SSL.com, Certera, Comodo** (or an Indian reseller).
Issued to a registered business (you'll need company documents). As of 2023+, certs are delivered on a **hardware token / USB (or cloud HSM)** — keep it plugged in while signing.

### 2. Sign automatically with electron-builder
electron-builder signs Windows builds automatically when it finds a certificate.

**If you have a `.pfx`/`.p12` file** (older certs or test):
```powershell
# PowerShell (on the Windows build machine)
$env:CSC_LINK="C:\path\to\certificate.pfx"
$env:CSC_KEY_PASSWORD="your-pfx-password"
npm run dist:win
```

**If you have a hardware token (EV / new OV certs)** — use the token's CSP/KSP via a custom sign hook (see `sign.js` example below), or your CA's signing tool. Most token vendors give a `signtool.exe` command:
```
signtool sign /sha1 <CERT_THUMBPRINT> /tr http://timestamp.digicert.com /td sha256 /fd sha256 "RightServe-Setup-1.0.0.exe"
```

### 3. The config is already sign-ready
`package.json` → `build.win` is configured with `publisherName` and `signtoolOptions`. Once `CSC_LINK` + `CSC_KEY_PASSWORD` are set (or a token is present), `npm run dist:win` produces a **signed** installer and the "Unknown Publisher" warning disappears (instantly for EV, after some downloads for OV).

---

## Option B — Self-Signed Certificate (free, for INTERNAL / in-house use only)

Good when you install on your own / client machines you control. It does **not** remove the public SmartScreen warning unless you install the certificate into **Trusted Root / Trusted Publishers** on each PC, but it lets you show a real publisher name and stops the "unknown" text once trusted.

### 1. Create a self-signed cert (PowerShell as Admin)
```powershell
$cert = New-SelfSignedCertificate -Type CodeSigningCert `
  -Subject "CN=RightServe Infotech System" `
  -CertStoreLocation Cert:\CurrentUser\My `
  -KeyExportPolicy Exportable -KeySpec Signature `
  -KeyLength 2048 -HashAlgorithm SHA256 `
  -NotAfter (Get-Date).AddYears(5)

$pwd = ConvertTo-SecureString -String "RightServe@123" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath "$HOME\rightserve.pfx" -Password $pwd
```

### 2. Build signed with that PFX
```powershell
$env:CSC_LINK="$HOME\rightserve.pfx"
$env:CSC_KEY_PASSWORD="RightServe@123"
npm run dist:win
```

### 3. Trust it on each client PC (one-time, run as Admin)
```powershell
Import-PfxCertificate -FilePath "rightserve.pfx" `
  -CertStoreLocation Cert:\LocalMachine\TrustedPublisher `
  -Password (ConvertTo-SecureString "RightServe@123" -AsPlainText -Force)
Import-PfxCertificate -FilePath "rightserve.pfx" `
  -CertStoreLocation Cert:\LocalMachine\Root `
  -Password (ConvertTo-SecureString "RightServe@123" -AsPlainText -Force)
```
After this the installer shows **Publisher: RightServe Infotech System** on those machines.

---

## Option C — Just proceed (no signing)

If signing isn't worth it yet, users can still install:
- **SmartScreen blue popup:** click **More info → Run anyway**
- **UAC yellow popup:** click **Yes**

The app is fully functional. This is normal for unsigned in-house tools.

---

## Quick checklist to ship a signed build

1. Build the UI + app on a **Windows** machine:
   ```
   cd desktop
   npm install
   npm run dist:win        # output in desktop/release/
   ```
2. Have your certificate ready (PFX path or hardware token).
3. Set `CSC_LINK` + `CSC_KEY_PASSWORD` (PFX) **or** keep the token plugged in.
4. Re-run `npm run dist:win` → the `release/RightServe-Setup-x.x.x.exe` is now signed.
5. Verify: right-click the `.exe` → **Properties → Digital Signatures** tab should list your name.

> Note: Cross-building a *signed* Windows installer from macOS/Linux is unreliable —
> build and sign on **Windows** for best results.
