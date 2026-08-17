const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const lic = require('./license');
const updater = require('./updater');

// ---------------------------------------------------------------------------
// Resolve paths for both dev (running from repo) and packaged (asar) modes.
// ---------------------------------------------------------------------------
const isDev = !app.isPackaged;

// In packaged builds we keep the server + client OUTSIDE asar (see build config
// "extraResources") so native modules (better-sqlite3) and static files work.
const RESOURCES = isDev
  ? path.join(__dirname, '..')
  : process.resourcesPath;

const SERVER_ENTRY = isDev
  ? path.join(__dirname, '..', 'server', 'index.js')
  : path.join(RESOURCES, 'server', 'index.js');

const CLIENT_DIST = isDev
  ? path.join(__dirname, '..', 'client', 'dist')
  : path.join(RESOURCES, 'client', 'dist');

// Persist the SQLite DB in the OS user-data dir so it survives app updates.
const DB_PATH = path.join(app.getPath('userData'), 'fmcg.db');
const WAL_PATH = DB_PATH + '-wal';
const SHM_PATH = DB_PATH + '-shm';

// ---------------------------------------------------------------------------
// Licensing
// ---------------------------------------------------------------------------
const LICENSE_PATH = path.join(app.getPath('userData'), 'license.dat');
const LICENSE_META = path.join(app.getPath('userData'), '.rsmeta');
const LICENSE_SEAL = path.join(app.getPath('userData'), '.rsseal');
// Persist a STABLE device id so the machine identity never changes across
// network/adapter/MAC changes (prevents spurious re-activation prompts).
lic.setDeviceIdPath(path.join(app.getPath('userData'), 'device.id'));
const PUBLIC_KEY_PEM = (() => {
  // Packaged: license_public.pem sits next to main.js (inside asar is fine to read).
  const candidates = [
    path.join(__dirname, 'license_public.pem'),
    path.join(process.resourcesPath || '', 'app.asar', 'license_public.pem'),
  ];
  for (const p of candidates) { try { return fs.readFileSync(p, 'utf8'); } catch (_) {} }
  return '';
})();

function licenseStatus() {
  return lic.getStatus({ licPath: LICENSE_PATH, metaPath: LICENSE_META, sealPath: LICENSE_SEAL, publicKeyPem: PUBLIC_KEY_PEM });
}

let mainWindow = null;
let activationWindow = null;
let serverInfo = null;

// Close the embedded server so the SQLite file handle is released (needed before
// replacing or deleting the DB file).
function stopBackend() {
  return new Promise((resolve) => {
    if (serverInfo && serverInfo.server) {
      try { serverInfo.server.close(() => resolve()); } catch (_) { resolve(); }
      serverInfo = null;
    } else resolve();
  });
}

async function startBackend() {
  // Configure env BEFORE requiring the server (db.js reads these at load time).
  process.env.DB_PATH = DB_PATH;
  process.env.CLIENT_DIST = CLIENT_DIST;
  process.env.NODE_ENV = isDev ? 'development' : 'production';

  // Tell the backend whether the app is in read-only mode (expired license),
  // so write endpoints (new bills/items/etc.) are blocked there too. We also
  // pass full (non-sensitive) license details so the in-app License page can
  // display them.
  const st = licenseStatus();
  process.env.RS_READONLY = st.state === 'expired' ? '1' : '0';
  process.env.RS_LICENSE_STATE = st.state || 'none';
  process.env.RS_LICENSE_INFO = JSON.stringify({
    state: st.state || 'none',
    client: st.payload ? st.payload.client : '',
    plan: st.payload ? st.payload.plan : '',
    licenseId: st.payload ? st.payload.id : '',
    issued: st.payload ? st.payload.issued : '',
    expires: st.expires || null,
    perpetual: !!st.perpetual,
    daysLeft: typeof st.daysLeft === 'number' ? st.daysLeft : null,
    machineId: st.machineId || lic.machineId(),
    machineLocked: !!(st.payload && st.payload.machine),
    desktop: true,
  });

  // First run: copy a seeded DB if bundled and no user DB exists yet.
  try {
    const seedDb = path.join(RESOURCES, 'server', 'data', 'fmcg.db');
    if (!fs.existsSync(DB_PATH) && fs.existsSync(seedDb) && process.env.SEED_ON_FIRST_RUN === '1') {
      fs.copyFileSync(seedDb, DB_PATH);
    }
  } catch (_) { /* ignore */ }

  const { start } = require(SERVER_ENTRY);
  serverInfo = await start(0); // 0 => OS picks a free port
  return serverInfo.port;
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    backgroundColor: '#f1f5f9',
    icon: path.join(__dirname, 'buildres', 'icon.png'),
    title: 'RightServe — Inventory & Billing',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Open external links (and blob: PDF previews) in the system browser / viewer.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1') || url.startsWith('blob:')) {
      // Let PDFs / app links open in a child Electron window so they preview.
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { width: 900, height: 1000, title: 'Document' },
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => (mainWindow = null));
}

// ---------------------------------------------------------------------------
// License: activation window + IPC + expiry reminder
// ---------------------------------------------------------------------------
function createActivationWindow() {
  activationWindow = new BrowserWindow({
    width: 620,
    height: 640,
    resizable: false,
    show: false,
    backgroundColor: '#0f766e',
    icon: path.join(__dirname, 'buildres', 'icon.png'),
    title: 'RightServe — Activation',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload-activation.js'),
    },
  });
  activationWindow.removeMenu();
  activationWindow.loadFile(path.join(__dirname, 'activation.html'));
  activationWindow.once('ready-to-show', () => activationWindow.show());
  activationWindow.on('closed', () => (activationWindow = null));
}

// IPC for the activation page (registered once).
function registerLicenseIpc() {
  ipcMain.handle('license:info', () => {
    const st = licenseStatus();
    return { state: st.state, reason: st.reason, expires: st.expires, machineId: st.machineId || lic.machineId() };
  });

  ipcMain.handle('license:activate', async (_e, key) => {
    const v = lic.verifyLicenseString(key, PUBLIC_KEY_PEM);
    if (!v.valid) return { ok: false, reason: v.reason };
    const ev = lic.evaluate(v.payload, { now: lic.monotonicNow(LICENSE_META) });
    if (ev.state === 'invalid') return { ok: false, reason: ev.reason };
    if (ev.state === 'expired') return { ok: false, reason: ev.reason + ' Please ask RightServe for a current key.' };

    // ONE-TIME ACTIVATION: claim the key at the portal (binds it to THIS machine
    // and rejects any other device). Offline-only keys (online:false) skip this.
    const claim = await lic.activateOnline(v.payload);
    if (!claim.ok) return { ok: false, reason: claim.reason, code: claim.code };

    // Accept. Persist the key + write the local activation seal for this machine.
    try {
      lic.writeLicenseFile(LICENSE_PATH, key);
      if (!claim.offline) lic.writeSeal(LICENSE_SEAL, v.payload.id);
    } catch (e) { return { ok: false, reason: 'Could not save license: ' + e.message }; }

    setTimeout(() => {
      try {
        if (mainWindow) {
          // App already running (e.g. renewing from read-only mode): relaunch so
          // the backend picks up the new (writable) license state cleanly.
          app.relaunch();
          app.exit(0);
        } else {
          if (activationWindow) activationWindow.close();
          launchMainApp();
        }
      } catch (_) {}
    }, 600);
    return { ok: true, payload: { client: v.payload.client, expires: v.payload.expires } };
  });

  ipcMain.handle('license:quit', () => { app.quit(); });
  ipcMain.handle('license:support', () => { shell.openExternal('mailto:support@StockVeda.com'); });

  // Used by the in-app License page (React) to open the native key-entry flow.
  ipcMain.handle('license:open-manager', () => { promptForKey(); return { ok: true }; });
  ipcMain.handle('license:copy-machine', () => {
    const { clipboard } = require('electron');
    const id = licenseStatus().machineId || lic.machineId();
    clipboard.writeText(id);
    return { ok: true, machineId: id };
  });
}

// Show an expiry reminder dialog (15 days before, and when in read-only mode).
function maybeShowExpiryReminder() {
  const st = licenseStatus();
  if (st.state === 'expiring') {
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'License Renewal Reminder',
      message: `Your RightServe license expires in ${st.daysLeft} day${st.daysLeft === 1 ? '' : 's'} (on ${st.expires}).`,
      detail:
        'Please contact RightServe to renew before it expires, so your billing is never interrupted.\n\n' +
        'Email: support@StockVeda.com\n' +
        'Phone: +91 86693 0888 / +91 94044 84560',
      buttons: ['Remind Me Later', 'Enter New Key…'],
      defaultId: 0, cancelId: 0,
    }).then((r) => { if (r.response === 1) openLicenseManager(); });
  } else if (st.state === 'expired') {
    // Read-only mode notice.
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'License Expired — Read-Only Mode',
      message: `Your license expired on ${st.expires}. RightServe is now running in READ-ONLY mode.`,
      detail:
        'You can still view, search and print existing data, but you cannot create or edit ' +
        'invoices, items, parties or payments until you renew.\n\n' +
        'Contact RightServe to renew:\n' +
        'Email: support@StockVeda.com\n' +
        'Phone: +91 86693 0888 / +91 94044 84560',
      buttons: ['Continue (Read-Only)', 'Enter New Key…'],
      defaultId: 1, cancelId: 0,
    }).then((r) => { if (r.response === 1) openLicenseManager(); });
  }
}

// Start the embedded server + main window (license already validated).
async function launchMainApp() {
  const port = serverInfo ? serverInfo.port : await startBackend();
  buildMenu(port);
  createWindow(port);
  // After the window is shown, surface any expiry reminder / read-only notice.
  // (Software updates are team-provided as a file — see the Help menu.)
  if (mainWindow) {
    mainWindow.once('ready-to-show', () => {
      setTimeout(maybeShowExpiryReminder, 1200);
    });
  }
}

// "Enter / change license key" dialog reachable from the Help menu at any time.
async function openLicenseManager() {
  const st = licenseStatus();
  const details =
    (st.payload ? `Licensed to: ${st.payload.client}\nPlan: ${st.payload.plan || '—'}\n` : '') +
    `Status: ${st.state}` +
    (st.perpetual ? ' (never expires)' : st.expires ? `\nExpires: ${st.expires}` + (typeof st.daysLeft === 'number' ? ` (${st.daysLeft} days left)` : '') : '') +
    `\nMachine ID: ${st.machineId || lic.machineId()}`;

  const r = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'License Details',
    message: 'RightServe License',
    detail: details + '\n\nTo enter a new or renewed key, click "Enter New Key…".',
    buttons: ['Close', 'Enter New Key…', 'Copy Machine ID'],
    defaultId: 1, cancelId: 0,
  });
  if (r.response === 2) {
    const { clipboard } = require('electron');
    clipboard.writeText(st.machineId || lic.machineId());
    dialog.showMessageBox(mainWindow, { type: 'info', message: 'Machine ID copied to clipboard.' });
  } else if (r.response === 1) {
    await promptForKey();
  }
}

// Simple multi-line key entry using a tiny modal BrowserWindow re-using the
// activation page (works both before and after the app has started).
function promptForKey() {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 620, height: 640, resizable: false, show: false, modal: !!mainWindow,
      parent: mainWindow || undefined, title: 'RightServe — Enter License Key',
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload-activation.js') },
    });
    win.removeMenu();
    win.loadFile(path.join(__dirname, 'activation.html'));
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => resolve());
    // The activate IPC handler will close + relaunch; for an already-running
    // app we just reload the window to apply read-only changes.
  });
}

// ---------------------------------------------------------------------------
// Data: backup / restore / delete-all
// ---------------------------------------------------------------------------

// Flush WAL into the main .db file so a plain copy is complete, then copy.
async function backupData() {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Backup All Data',
    defaultPath: `RightServe-Backup-${new Date().toISOString().slice(0, 10)}.db`,
    filters: [{ name: 'RightServe Backup', extensions: ['db'] }],
  });
  if (canceled || !filePath) return;
  try {
    // Ask the running server for a consistent VACUUM INTO snapshot.
    if (serverInfo && serverInfo.port) {
      const ok = await downloadSnapshot(serverInfo.port, filePath);
      if (ok) {
        dialog.showMessageBox(mainWindow, { type: 'info', message: 'Backup saved successfully.', detail: filePath });
        return;
      }
    }
    // Fallback: checkpoint WAL then copy the file directly.
    fs.copyFileSync(DB_PATH, filePath);
    dialog.showMessageBox(mainWindow, { type: 'info', message: 'Backup saved successfully.', detail: filePath });
  } catch (e) {
    dialog.showErrorBox('Backup failed', e.message);
  }
}

// Pull a consistent snapshot from the embedded server's /api/backup/download.
function downloadSnapshot(port, destPath) {
  return new Promise((resolve) => {
    const http = require('http');
    const file = fs.createWriteStream(destPath);
    const req = http.get(`http://127.0.0.1:${port}/api/backup/download?desktop=1`, { headers: { 'x-desktop': '1' } }, (res) => {
      if (res.statusCode !== 200) { file.close(); resolve(false); return; }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(true)));
    });
    req.on('error', () => { try { file.close(); } catch (_) {} resolve(false); });
  });
}

async function restoreData() {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning', buttons: ['Cancel', 'Choose Backup & Restore'], defaultId: 0, cancelId: 0,
    title: 'Restore From Backup',
    message: 'Restoring will REPLACE all current data with the backup file.',
    detail: 'Your current data will be overwritten. The app will reload after restore. Continue?',
  });
  if (response !== 1) return;

  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Select RightServe Backup',
    properties: ['openFile'],
    filters: [{ name: 'RightServe Backup', extensions: ['db'] }],
  });
  if (canceled || !filePaths || !filePaths[0]) return;

  const src = filePaths[0];
  try {
    await stopBackend();
    // Remove WAL/SHM so they don't override the restored file.
    for (const p of [WAL_PATH, SHM_PATH]) { try { fs.unlinkSync(p); } catch (_) {} }
    fs.copyFileSync(src, DB_PATH);
    await dialog.showMessageBox(mainWindow, { type: 'info', message: 'Data restored successfully.', detail: 'The app will now reload.' });
    await relaunchBackend();
  } catch (e) {
    dialog.showErrorBox('Restore failed', e.message);
    try { await relaunchBackend(); } catch (_) {}
  }
}

async function deleteAllData() {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning', buttons: ['Cancel', 'Delete All Data'], defaultId: 0, cancelId: 0,
    title: 'Delete All Data',
    message: 'This will permanently delete ALL RightServe data on this computer.',
    detail: 'All invoices, items, parties, payments, GST data, users and settings will be erased.\n\nYour software licence stays activated — the app will simply restart at the "create first user" screen.\n\nThis cannot be undone. Make sure you have a backup first.',
  });
  if (response !== 1) return;

  // Second confirmation for safety.
  const confirm = await dialog.showMessageBox(mainWindow, {
    type: 'warning', buttons: ['Cancel', 'Yes, delete everything'], defaultId: 0, cancelId: 0,
    title: 'Are you absolutely sure?',
    message: 'Final confirmation',
    detail: 'Click "Yes, delete everything" to erase all data now. Your licence will be kept.',
  });
  if (confirm.response !== 1) return;

  try {
    // Preferred path: ask the running server to wipe all data rows (keeps the
    // schema so the app boots straight into first-user setup). The licence file
    // lives in Electron userData and is never touched by this.
    let wiped = false;
    if (serverInfo && serverInfo.port) {
      wiped = await requestWipe(serverInfo.port);
    }
    // Fallback: if the server isn't reachable, delete the DB files directly.
    if (!wiped) {
      await stopBackend();
      for (const p of [DB_PATH, WAL_PATH, SHM_PATH]) { try { fs.unlinkSync(p); } catch (_) {} }
    }
    // Clear renderer storage (login token, theme cache) so nothing lingers.
    try {
      if (mainWindow) {
        await mainWindow.webContents.session.clearStorageData({
          storages: ['localstorage', 'cookies', 'caches', 'indexdb', 'serviceworkers'],
        });
      }
    } catch (_) { /* ignore */ }
    await dialog.showMessageBox(mainWindow, {
      type: 'info', message: 'All data deleted.',
      detail: 'Your licence is intact. The app will now restart at the "create first user" screen.',
    });
    app.relaunch();
    app.exit(0);
  } catch (e) {
    dialog.showErrorBox('Delete failed', e.message);
  }
}

// Call the embedded server's wipe endpoint (keeps schema + licence).
function requestWipe(port) {
  return new Promise((resolve) => {
    const http = require('http');
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/backup/wipe', method: 'POST', headers: { 'x-desktop': '1', 'content-type': 'application/json' } },
      (res) => { res.resume(); res.on('end', () => resolve(res.statusCode === 200)); }
    );
    req.on('error', () => resolve(false));
    req.end();
  });
}

// Restart the embedded server and reload the window (after restore).
async function relaunchBackend() {
  const port = await startBackend();
  buildMenu(port);
  if (mainWindow) mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

function buildMenu(port) {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Data Folder',
          click: () => shell.openPath(app.getPath('userData')),
        },
        {
          label: 'Backup All Data…',
          accelerator: 'CmdOrCtrl+B',
          click: () => backupData(),
        },
        {
          label: 'Restore From Backup…',
          click: () => restoreData(),
        },
        { type: 'separator' },
        {
          label: 'Delete All Data…',
          click: () => deleteAllData(),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Install Update from File…',
          click: () => updater.installFromFile(),
        },
        {
          label: 'Version & Updates…',
          click: () => updater.showVersion(),
        },
        { type: 'separator' },
        {
          label: 'License Details / Enter Key…',
          click: () => openLicenseManager(),
        },
        { type: 'separator' },
        {
          label: 'About',
          click: () =>
            dialog.showMessageBox(mainWindow, {
              title: 'About',
              type: 'info',
              message: 'RightServe — Inventory & Billing',
              detail:
                `Simple, fast billing, batch-wise inventory & GST reports.\n\n` +
                `Version: ${app.getVersion()}\n` +
                `Local server: http://127.0.0.1:${port}\n` +
                `Data file: ${DB_PATH}\n\n` +
                `Support: support@StockVeda.com\n` +
                `Phone: +91 86693 0888 / +91 94044 84560\n\n` +
                `Designed & Developed by:\n` +
                `RightServe Infotech System (rightserveinfotechsystem.com)\n` +
                `LivePro Solutions (liveprosolutions.com)`,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Single instance lock so the DB isn't opened twice.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    registerLicenseIpc();
    try {
      const st = licenseStatus();
      // Gate: a missing / invalid / expired-and-not-yet-renewed license that
      // cannot run must go through activation first. Expired licenses are
      // allowed to start in READ-ONLY mode (so users can still view/print).
      if (st.state === 'none' || st.state === 'invalid' || st.state === 'needs-activation') {
        createActivationWindow();
      } else {
        await launchMainApp();
      }
    } catch (e) {
      dialog.showErrorBox('Startup error', 'Could not start RightServe:\n\n' + (e.stack || e.message));
      app.quit();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const st = licenseStatus();
        if (st.state === 'none' || st.state === 'invalid' || st.state === 'needs-activation') createActivationWindow();
        else if (serverInfo) createWindow(serverInfo.port);
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('quit', () => {
    if (serverInfo && serverInfo.server) {
      try { serverInfo.server.close(); } catch (_) { /* ignore */ }
    }
  });
}
