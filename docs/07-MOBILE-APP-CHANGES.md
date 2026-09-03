# Changes to apply in `fmcg_mobile_app`

Companion repo: https://github.com/saurabhrsis/fmcg_mobile_app

Desktop already listens on `0.0.0.0:4000` and shows a **pairing QR**. The phone
must scan that QR, allow HTTP on the LAN, and treat Desktop vs Mobile license
keys as different products. Licenses stay **per device** — see §4.

---

## 1. Allow HTTP to the desktop (release Android)

Debug APKs already allow cleartext. **Release APKs do not**, so
`http://192.168.x.x:4000` fails with “not reachable”.

`app.json` → `expo.android`:

```json
"usesCleartextTraffic": true
```

`android/app/src/main/AndroidManifest.xml` on `<application>`:

```xml
android:usesCleartextTraffic="true"
```

iOS already has `NSAllowsLocalNetworking`. Rebuild the Android app after this.

---

## 2. Pairing QR (no URL typing)

Desktop QR payload (JSON string):

```json
{"v":1,"app":"rightserve-sync","url":"http://192.168.1.5:4000","key":"rsync_…"}
```

### 2.1 Install camera

```bash
npx expo install expo-camera
```

Camera permission is already in `app.json`. Keep
`NSCameraUsageDescription`.

### 2.2 Parse + save in `src/services/syncService.ts`

Replace `normalizeBaseUrl` and add pairing helpers:

```ts
function normalizeBaseUrl(url: string): string {
  let u = String(url || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  u = u.replace(/\/+$/, '');
  u = u.replace(/\/api\/sync(?:\/ping|\/pull|\/push)?$/i, '');
  u = u.replace(/\/api$/i, '');
  return u;
}

export function parsePairingCode(raw: string): { url: string; apiKey: string } {
  const text = String(raw || '').trim();
  if (!text) throw new Error('Empty QR');
  let url = '';
  let apiKey = '';
  try {
    const j = JSON.parse(text);
    if (j && (j.app === 'rightserve-sync' || j.v === 1)) {
      url = j.url || j.u || '';
      apiKey = j.key || j.k || '';
    }
  } catch {
    const m = text.match(/^rightserve:\/\/sync\?(.*)$/i);
    if (m) {
      const q = new URLSearchParams(m[1]);
      url = q.get('url') || q.get('u') || '';
      apiKey = q.get('key') || q.get('k') || '';
    }
  }
  url = normalizeBaseUrl(url);
  apiKey = String(apiKey || '').trim();
  if (!url || !apiKey) throw new Error('This QR is not a RightServe desktop pairing code.');
  return { url, apiKey };
}
```

Change the Test Connection placeholder port from **8090 → 4000**. Label the API
key **required** (not optional). Improve the catch message to mention same Wi-Fi,
port, and HTTP blocked.

After a successful scan: `saveConfig(url, apiKey)` then `testConnection`.

### 2.3 Scan screen

Add `src/screens/settings/ScanDesktopQrScreen.tsx` using Expo 54
`CameraView`:

```tsx
import { CameraView, useCameraPermissions } from 'expo-camera';
import { parsePairingCode, syncService } from '../../services/syncService';

// onBarcodeScanned:
const { url, apiKey } = parsePairingCode(data);
await syncService.saveConfig(url, apiKey);
const ping = await syncService.testConnection(url, apiKey);
navigation.goBack();
```

On `DesktopSyncScreen`, a primary button **Scan QR to connect** (not the URL
fields). Keep URL/key under “Can’t scan?”.

Wire the screen in the settings navigator.

---

## 3. Same business on phone and PC

Sync does **not** use the license to pick a firm. It merges by **natural keys**:

| Table | Match |
|-------|--------|
| businesses | name |
| items | name + SKU |
| parties | name + type |
| invoices | business + invoice no + type |
| batches | business + item + batch no |

**Recommended setup**

1. Create the company on **desktop** (name, GSTIN, items, parties).
2. Enable Mobile Sync → scan QR.
3. On the phone tap **Full Sync** (pull desktop, then push phone).
4. Use the **same business name** on both. A new phone with empty data will
   import the desktop firm on first pull.

`company` is **not** merged (each device keeps its own company row). Fill GSTIN
on both, or pull first on a fresh phone so `businesses` match.

License keys do **not** link the two databases. They only unlock each app.

---

## 4. License portal — desktop vs mobile vs both

**Yes, the portal needed a product field.** Activation binds **one device**, so
one key cannot unlock both the PC and the phone.

| Customer buys | What to generate |
|---------------|------------------|
| Desktop only | Product = **Desktop app** → 1 key |
| Mobile only | Product = **Mobile app** → 1 key |
| Both at once | Product = **Desktop + Mobile** → **2 keys**, same client, same term |
| Mobile now, desktop later (or vice versa) | Same **client** in the portal → generate the missing product. Do not reuse the first key. |

Keys:

- Desktop key → paste on the PC activation screen. Desktop **rejects** `product: "mobile"`.
- Mobile key → paste in the phone app. Mobile should **reject** `product: "desktop"`.
- Legacy keys with no `product` = desktop (backward compatible).

### Mobile `license.ts` — add after machine check in `evaluate` / `installLicenseKey`:

```ts
const product = String(payload.product || '').toLowerCase();
if (product === 'desktop') {
  return {
    /* invalid */
    reason: 'This key is for the RightServe desktop app. Ask RightServe for a Mobile license.',
    ...
  };
}
```

Missing `product` on old keys: **accept on mobile** only if you still have
customers on untagged keys; otherwise treat missing as desktop. Current portal
always writes `product` on new keys.

Renew **Desktop** and **Mobile** separately (each row in License History).
Transfer/reset activation is per key (new phone ≠ new PC).

---

## 5. Checklist

- [ ] `usesCleartextTraffic` on release Android
- [ ] Example URL port **4000**
- [ ] `normalizeBaseUrl` strips `/api` and `/api/sync`
- [ ] `parsePairingCode` + Scan QR screen (`expo-camera`)
- [ ] API key labelled required
- [ ] Reject desktop-only license keys
- [ ] First-run copy: “Set up on desktop, then scan QR and Full Sync”
