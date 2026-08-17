// WhatsApp integration using whatsapp-web.js (WhatsApp Web protocol).
//
// - A single client per server process. Session is persisted on disk
//   (LocalAuth) under <DATA_DIR>/wa-session so re-scanning isn't needed daily.
// - On first login the QR is emitted: printed to the terminal (qrcode-terminal)
//   AND exposed as a data-URL for the in-app UI to render.
// - sendDocument(number, buffer, filename, caption) sends a PDF to a customer.
//
// The heavy deps (whatsapp-web.js + puppeteer/chromium) are loaded lazily so the
// rest of the app runs fine even if they aren't installed yet.
const path = require('path');
const fs = require('fs');

let Client, LocalAuth, MessageMedia, qrcodeTerminal, QRCode;
let loadError = null;
function loadDeps() {
  if (Client) return true;
  try {
    const wweb = require('whatsapp-web.js');
    Client = wweb.Client; LocalAuth = wweb.LocalAuth; MessageMedia = wweb.MessageMedia;
    try { qrcodeTerminal = require('qrcode-terminal'); } catch (_) { qrcodeTerminal = null; }
    try { QRCode = require('qrcode'); } catch (_) { QRCode = null; }
    return true;
  } catch (e) {
    loadError = e.message;
    return false;
  }
}

const DATA_DIR = process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : path.join(__dirname, 'data');
const SESSION_DIR = path.join(DATA_DIR, 'wa-session');

const state = {
  status: 'disconnected', // disconnected | initializing | qr | authenticated | ready | auth_failure
  qrDataUrl: null,        // data:image/png for the UI to render
  qrRaw: null,            // raw QR string
  me: null,               // { number, name } once ready
  lastError: null,
};

let client = null;
let initializing = false;

function getStatus() {
  return {
    available: loadDeps(),
    loadError,
    status: state.status,
    qr: state.qrDataUrl,
    me: state.me,
    lastError: state.lastError,
  };
}

async function init() {
  if (!loadDeps()) { state.status = 'disconnected'; state.lastError = 'WhatsApp module not installed: ' + loadError; return getStatus(); }
  if (client && (state.status === 'ready' || state.status === 'authenticated' || state.status === 'initializing' || state.status === 'qr')) {
    return getStatus();
  }
  if (initializing) return getStatus();
  initializing = true;
  state.status = 'initializing'; state.lastError = null; state.qrDataUrl = null; state.qrRaw = null;

  try { fs.mkdirSync(SESSION_DIR, { recursive: true }); } catch (_) {}

  client = new Client({
    authStrategy: new LocalAuth({ clientId: 'rightserve', dataPath: SESSION_DIR }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    },
  });

  client.on('qr', (qr) => {
    state.status = 'qr';
    state.qrRaw = qr;
    if (qrcodeTerminal) {
      try {
        console.log('\n[WhatsApp] Scan this QR with your phone (WhatsApp → Linked devices):\n');
        qrcodeTerminal.generate(qr, { small: true });
      } catch (_) {}
    }
    if (QRCode) {
      QRCode.toDataURL(qr, { margin: 1, width: 320 }).then((d) => { state.qrDataUrl = d; }).catch(() => {});
    }
  });
  client.on('authenticated', () => { state.status = 'authenticated'; state.qrDataUrl = null; state.qrRaw = null; });
  client.on('auth_failure', (m) => { state.status = 'auth_failure'; state.lastError = String(m || 'Authentication failed'); });
  client.on('ready', () => {
    state.status = 'ready';
    state.qrDataUrl = null; state.qrRaw = null;
    try {
      const info = client.info || {};
      state.me = { number: (info.wid && info.wid.user) || '', name: info.pushname || '' };
    } catch (_) { state.me = null; }
    console.log('[WhatsApp] Client ready' + (state.me ? ' as ' + state.me.number : ''));
  });
  client.on('disconnected', (reason) => {
    state.status = 'disconnected'; state.me = null; state.lastError = 'Disconnected: ' + String(reason || '');
    try { client.destroy(); } catch (_) {}
    client = null; initializing = false;
  });

  try {
    await client.initialize();
  } catch (e) {
    state.status = 'disconnected';
    state.lastError = e.message || String(e);
    try { if (client) client.destroy(); } catch (_) {}
    client = null;
  } finally {
    initializing = false;
  }
  return getStatus();
}

async function logout() {
  if (!client) { state.status = 'disconnected'; state.me = null; return getStatus(); }
  try { await client.logout(); } catch (_) {}
  try { await client.destroy(); } catch (_) {}
  client = null; initializing = false;
  state.status = 'disconnected'; state.me = null; state.qrDataUrl = null; state.qrRaw = null;
  return getStatus();
}

// Normalise an Indian/international mobile number to a WhatsApp chat id.
// Accepts "9822011223", "09822011223", "+91 98220 11223", "919822011223".
function toChatId(rawNumber) {
  let n = String(rawNumber || '').replace(/[^\d]/g, '');
  if (!n) return null;
  n = n.replace(/^0+/, '');
  if (n.length === 10) n = '91' + n;          // default to India
  if (n.length < 11 || n.length > 15) return null;
  return n + '@c.us';
}

async function sendDocument(rawNumber, buffer, filename, caption) {
  if (!loadDeps()) throw new Error('WhatsApp module is not installed on this server.');
  if (state.status !== 'ready' || !client) throw new Error('WhatsApp is not connected. Scan the QR code to link a device first.');
  const chatId = toChatId(rawNumber);
  if (!chatId) throw new Error('Invalid mobile number.');

  // Verify the number is registered on WhatsApp (best-effort).
  try {
    const isReg = await client.isRegisteredUser(chatId);
    if (!isReg) throw new Error('This number is not on WhatsApp.');
  } catch (e) {
    if (e && /not on WhatsApp/.test(e.message)) throw e;
    // isRegisteredUser can be flaky; continue and let send surface real errors.
  }

  const media = new MessageMedia('application/pdf', Buffer.from(buffer).toString('base64'), filename || 'invoice.pdf');
  await client.sendMessage(chatId, media, { caption: caption || '' });
  return { ok: true, to: chatId };
}

module.exports = { init, logout, getStatus, sendDocument, toChatId };
