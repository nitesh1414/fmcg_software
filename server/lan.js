'use strict';
/**
 * LAN helpers for Mobile App Sync.
 *
 * The companion phone app (fmcg_mobile_app) talks to this portal over HTTP on
 * the same Wi-Fi. We must (a) bind 0.0.0.0, (b) advertise a real private IPv4
 * the phone can route to — never 127.0.0.1, never 169.254 link-local, and
 * prefer Wi-Fi/Ethernet over Docker/Hyper-V/WSL virtual adapters.
 */
const os = require('os');

let listenInfo = { host: null, port: null };

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '::', '0:0:0:0:0:0:0:1']);

// Virtual / tunnel adapters whose addresses the phone cannot reach.
const VIRTUAL_RE = /docker|veth|br-|vmnet|vbox|virtualbox|hyper-?v|vethernet|wsl|loopback|tun|tap|tailscale|zerotier|hamachi|radmin|npcap|bluetooth|pseudo|isatap|teredo|vpn|vmware|virbr|cblist|utun|awdl|llw|anpi|bridge/i;
const PREFERRED_RE = /wi-?fi|wlan|wl|wireless|ethernet|eth|en0|enp|eno|ens|local area/i;

function defaultHost() {
  return process.env.HOST || '0.0.0.0';
}

function setListenInfo({ host, port }) {
  listenInfo = { host: host || null, port: port == null ? null : Number(port) };
}

function getListenInfo() {
  return { host: listenInfo.host, port: listenInfo.port };
}

function isLoopbackHost(host) {
  const h = String(host || '').trim().toLowerCase();
  return !h || LOOPBACK.has(h);
}

function isLanBound(host) {
  const h = host == null ? (listenInfo.host || defaultHost()) : host;
  return !isLoopbackHost(h);
}

function isIPv4(iface) {
  return !!(iface && !iface.internal && (iface.family === 'IPv4' || iface.family === 4));
}

function isPrivateV4(addr) {
  const a = String(addr || '');
  if (!a || a.startsWith('127.') || a.startsWith('169.254.')) return false;
  if (a.startsWith('10.')) return true;
  if (a.startsWith('192.168.')) return true;
  const m = a.match(/^172\.(\d+)\./);
  if (m) {
    const n = Number(m[1]);
    return n >= 16 && n <= 31;
  }
  return false;
}

function scoreAddress(name, address) {
  if (!isPrivateV4(address)) return -1;
  let score = 0;
  if (address.startsWith('192.168.')) score += 80;
  else if (address.startsWith('10.')) score += 60;
  else score += 35; // 172.16–31 — often Hyper-V / Docker
  if (VIRTUAL_RE.test(name || '')) score -= 55;
  if (PREFERRED_RE.test(name || '')) score += 15;
  return score;
}

function listLanIPv4() {
  const found = [];
  let ifaces = {};
  try { ifaces = os.networkInterfaces() || {}; } catch (_) { ifaces = {}; }
  for (const [name, list] of Object.entries(ifaces)) {
    for (const i of list || []) {
      if (!isIPv4(i)) continue;
      const score = scoreAddress(name, i.address);
      if (score < 0) continue;
      found.push({ name, address: i.address, score });
    }
  }
  found.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
  const seen = new Set();
  return found.filter((x) => {
    if (seen.has(x.address)) return false;
    seen.add(x.address);
    return true;
  });
}

function resolvePort(reqPort) {
  const n = Number(reqPort);
  if (n) return n;
  if (listenInfo.port) return listenInfo.port;
  const env = Number(process.env.PORT);
  return env || 4000;
}

/** Portal origin URLs the phone should paste (http://<lan-ip>:<port>). */
function portalUrls(port) {
  const p = resolvePort(port);
  return listLanIPv4().map((x) => `http://${x.address}:${p}`);
}

module.exports = {
  defaultHost,
  setListenInfo,
  getListenInfo,
  isLoopbackHost,
  isLanBound,
  isPrivateV4,
  scoreAddress,
  listLanIPv4,
  portalUrls,
  resolvePort,
};
