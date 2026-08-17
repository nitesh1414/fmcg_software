// ===========================================================================
// updater.js — TEAM-CONTROLLED software updates for RightServe.
// ---------------------------------------------------------------------------
// The RightServe team gives the client the new installer file (via pen-drive,
// email, WhatsApp, AnyDesk, shared folder, etc.). The client installs it over
// the existing app — NO automatic internet download.
//
// Why data is always preserved: the database lives in the per-user data folder
// (%APPDATA%\RightServe\fmcg.db), separate from the installed program. The NSIS
// installer detects the existing install and UPGRADES it in place, so old data
// + new features. The uninstaller's "delete data?" prompt is skipped during an
// update (${isUpdated}).
//
// This module provides two helpers used by the Help menu:
//   - installFromFile(): pick the installer the team sent and run it (the app
//     closes so the installer can replace the files, then reopens updated).
//   - showVersion(): show the current version + plain instructions.
// ===========================================================================
const path = require('path');
const fs = require('fs');
const { app, dialog, shell, BrowserWindow } = require('electron');
const { spawn } = require('child_process');

function mainWin() {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) || null;
}

// Let the user pick the installer the team gave them, then run it.
async function installFromFile() {
  const win = mainWin();

  // Platform-appropriate installer extension(s).
  const plat = process.platform;
  const filters =
    plat === 'win32' ? [{ name: 'RightServe Installer', extensions: ['exe'] }]
    : plat === 'darwin' ? [{ name: 'RightServe Installer', extensions: ['dmg'] }]
    : [{ name: 'RightServe Installer', extensions: ['AppImage', 'deb'] }];

  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Select the RightServe update file',
    properties: ['openFile'],
    filters,
  });
  if (canceled || !filePaths || !filePaths[0]) return;
  const installer = filePaths[0];

  if (!fs.existsSync(installer)) {
    dialog.showErrorBox('Update file not found', 'The selected file could not be opened.');
    return;
  }

  // Basic sanity check on the filename.
  const base = path.basename(installer).toLowerCase();
  if (plat === 'win32' && !base.endsWith('.exe')) {
    dialog.showErrorBox('Wrong file', 'Please select the RightServe Windows installer (a .exe file) sent by the RightServe team.');
    return;
  }

  const r = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'Install Update',
    message: 'Install this RightServe update now?',
    detail:
      `File:\n${installer}\n\n` +
      'Your data is safe — all invoices, items, parties, payments and settings are kept.\n\n' +
      'RightServe will close, the update will install, and then the app will reopen.',
    buttons: ['Install Now', 'Cancel'],
    defaultId: 0, cancelId: 1,
  });
  if (r.response !== 0) return;

  try {
    if (plat === 'win32') {
      // Launch the NSIS installer detached, then quit so it can replace files.
      // /D is NOT passed so it upgrades the existing install location.
      const child = spawn(installer, [], { detached: true, stdio: 'ignore' });
      child.unref();
      setTimeout(() => app.quit(), 600);
    } else {
      // macOS/Linux: open the installer with the OS; user completes it manually.
      await shell.openPath(installer);
      dialog.showMessageBox(win, {
        type: 'info',
        message: 'Follow the installer to finish updating.',
        detail: 'After it completes, reopen RightServe. Your data will be intact.',
      });
    }
  } catch (e) {
    dialog.showErrorBox('Could not start the update', e.message || String(e));
  }
}

// Show the current version + how updates work (team gives the file).
function showVersion() {
  const win = mainWin();
  dialog.showMessageBox(win, {
    type: 'info',
    title: 'RightServe Version & Updates',
    message: `RightServe version ${app.getVersion()}`,
    detail:
      'Updates are provided by the RightServe team.\n\n' +
      'When the team sends you a new version file, choose ' +
      '"Install Update from File…" and select it. Your existing data is always kept.\n\n' +
      'Need the latest version? Contact RightServe:\n' +
      'Phone: +91 86693 0888 / +91 94044 84560\n' +
      'Email: support@StockVeda.com',
    buttons: ['OK', 'Contact RightServe'],
    defaultId: 0, cancelId: 0,
  }).then((res) => {
    if (res.response === 1) shell.openExternal('mailto:support@StockVeda.com?subject=RightServe%20Update%20Request');
  });
}

module.exports = { installFromFile, showVersion };
