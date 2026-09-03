# Mobile App Sync protocol

This portal and the companion
[`fmcg_mobile_app`](https://github.com/saurabhrsis/fmcg_mobile_app)
(`src/services/syncService.ts`, `src/screens/settings/DesktopSyncScreen.tsx`)
share one LAN protocol.

## Endpoints

Phone **base URL** = portal origin only, e.g. `http://192.168.1.5:4000`
(no `/api`, no trailing slash). The phone then calls:

| Phone | Desktop |
|-------|---------|
| `GET  {base}/api/sync/ping` | reachability; Bearer optional |
| `GET  {base}/api/sync/pull` | Bearer **required** |
| `POST {base}/api/sync/push` | Bearer **required**, JSON body |

Header: `Authorization: Bearer <key>` and `Content-Type: application/json`.
Package format: **`rightserve-sync/1`**.

Default listen: **`0.0.0.0:4000`** (Electron and `npm start`). If 4000 is busy
the process picks a free port and **System → Mobile App Sync** shows that port
in the Portal URL. Never paste `http://127.0.0.1:…` on the phone — that is the
phone itself, not this PC.

## Why “connection not reachable” happened

1. The desktop used to bind **127.0.0.1** and Electron used a **random port**,
   so a phone on the same Wi-Fi could not open a TCP connection.
2. Advertised URLs could be loopback or a Docker/Hyper-V `172.x` address.
3. The phone’s example URL used **port 8090**; this portal is **4000**.
4. Android **release** APKs block cleartext HTTP unless
   `usesCleartextTraffic` is set (debug builds already allow it). iOS already
   sets `NSAllowsLocalNetworking`.

## Companion app changes (apply in `fmcg_mobile_app`)

Release Android currently omits cleartext HTTP, so `http://192.168.x.x:4000`
fails with a generic network error on production APKs.

`app.json` — under `expo.android`:

```json
"usesCleartextTraffic": true
```

`android/app/src/main/AndroidManifest.xml` — on `<application>`:

```xml
android:usesCleartextTraffic="true"
```

`DesktopSyncScreen.tsx` — examples should use port **4000**, and the API key
is **required** when desktop sync is enabled (not optional).

`syncService.ts` — strip accidental `/api` or `/api/sync` suffixes when
normalising the base URL, and map `AbortError` / `Failed to fetch` to a
clearer “not on this Wi-Fi / wrong IP:port / HTTP blocked” message.
