// ===========================================================================
// rebuild-server-native.js
// ---------------------------------------------------------------------------
// The backend (../server) ships inside the packaged app via electron-builder
// "extraResources". Its native module `better-sqlite3` therefore lives in
// ../server/node_modules and is NOT touched by electron-builder's automatic
// native-dependency rebuild (that only covers THIS desktop package's own deps).
//
// At runtime the server is loaded by the Electron main process, so its
// better-sqlite3 must be built for ELECTRON's ABI, not plain Node's. If it was
// installed with `npm install` under Node, you get:
//
//   Error: ... better_sqlite3.node was compiled against a different Node.js
//   version using NODE_MODULE_VERSION 127. This version requires 125 ...
//
// This script fetches the correct PREBUILT Electron binary for the server's
// better-sqlite3 (v12 publishes Electron prebuilds — no C++ compiler needed)
// and drops it into build/Release/ where better-sqlite3 loads it from.
//
// Run automatically before every electron-builder packaging step (see the
// dist:* scripts in package.json).
// ===========================================================================
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

function log(msg) { console.log(`[rebuild-server-native] ${msg}`); }

const serverDir = path.join(__dirname, '..', 'server');
const bs3Dir = path.join(serverDir, 'node_modules', 'better-sqlite3');

if (!fs.existsSync(bs3Dir)) {
  log('better-sqlite3 not found in ../server/node_modules — run `npm install` in ../server first.');
  process.exit(1);
}

// Exact installed Electron version (e.g. "31.7.7"); prebuild-install maps this
// to the right ABI (Electron 31 => NODE_MODULE_VERSION 125).
let electronVersion;
try {
  electronVersion = require('electron/package.json').version;
} catch (_) {
  log('Could not resolve the electron package — is it installed in desktop/?');
  process.exit(1);
}

// Find prebuild-install (a dependency of better-sqlite3). Check the nested copy
// first, then a hoisted copy in ../server/node_modules.
const candidates = [
  path.join(bs3Dir, 'node_modules', 'prebuild-install', 'bin.js'),
  path.join(serverDir, 'node_modules', 'prebuild-install', 'bin.js'),
];
let prebuild = candidates.find((p) => fs.existsSync(p));
if (!prebuild) {
  // Last resort: resolve from better-sqlite3's module context.
  try {
    prebuild = require.resolve('prebuild-install/bin.js', { paths: [bs3Dir, serverDir] });
  } catch (_) { /* ignore */ }
}
if (!prebuild) {
  log('prebuild-install not found. Reinstall ../server deps (npm install) and retry.');
  process.exit(1);
}

const args = [
  prebuild,
  '--runtime=electron',
  `--target=${electronVersion}`,
  `--arch=${process.arch}`,
  `--platform=${process.platform}`,
  '--force', // overwrite any existing Node-ABI build
];

// On Windows the compiled .node stays memory-mapped while the app (or an
// electron.exe / RightServe.exe left running from a previous session) has it
// open, so prebuild-install's overwrite fails with EBUSY. Remove the stale
// binary first (best effort) and, if it's still locked, guide the user to
// close the running app. We also retry a couple of times.
const nodeFile = path.join(bs3Dir, 'build', 'Release', 'better_sqlite3.node');
function removeStaleBinary() {
  try {
    if (fs.existsSync(nodeFile)) { fs.rmSync(nodeFile, { force: true }); log('Removed stale better_sqlite3.node before rebuild.'); }
  } catch (e) {
    if (e && e.code === 'EBUSY') {
      log('better_sqlite3.node is LOCKED (EBUSY) — a running RightServe/Electron/Node process still has it open.');
      log('Close the RightServe app and any "electron.exe"/"node.exe" from this project, then run the command again.');
      if (process.platform === 'win32') log('Tip (PowerShell): taskkill /F /IM RightServe.exe /IM electron.exe /IM node.exe 2>$null   (do NOT kill the terminal you are typing in)');
    } // otherwise ignore — prebuild-install will recreate it
  }
}

log(`Fetching better-sqlite3 prebuilt for Electron ${electronVersion} (${process.platform}-${process.arch})...`);
let lastErr = null;
for (let attempt = 1; attempt <= 3; attempt++) {
  removeStaleBinary();
  try {
    execFileSync(process.execPath, args, { cwd: bs3Dir, stdio: 'inherit' });
    log('Done — server better-sqlite3 is now built for the Electron runtime.');
    lastErr = null;
    break;
  } catch (e) {
    lastErr = e;
    const msg = String((e && e.message) || e);
    const busy = /EBUSY|resource busy or locked|EPERM|operation not permitted/i.test(msg);
    if (busy && attempt < 3) {
      log(`Attempt ${attempt} failed (file locked). Retrying in 2s — close the running app if this keeps happening…`);
      const until = Date.now() + 2000; while (Date.now() < until) { /* brief sync wait */ }
      continue;
    }
    break;
  }
}
if (lastErr) {
  const msg = String((lastErr && lastErr.message) || lastErr);
  if (/EBUSY|resource busy or locked|EPERM/i.test(msg)) {
    log('Failed: better_sqlite3.node is in use (EBUSY/EPERM).');
    log('FIX: fully quit the RightServe desktop app (and stop any dev server), then run "npm run rebuild" again.');
    if (process.platform === 'win32') log('   PowerShell: taskkill /F /IM RightServe.exe /IM electron.exe 2>$null');
  } else {
    log('Failed to fetch Electron prebuilt binary.');
    log('If you are offline or behind a proxy, set HTTP(S)_PROXY or run with network access.');
  }
  process.exit(1);
}
