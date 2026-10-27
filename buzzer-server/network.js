'use strict';

const os = require('node:os');
const { isIP } = require('node:net');

function interfacePriority(name) {
  // Windows exposes VPNs and virtual switches alongside the actual Wi-Fi.
  if (/virtual|vbox|vmware|hyper-v|vethernet|wsl|docker|vpn|tailscale|zerotier|hamachi|tunnel|tap|tun\d|utun/i.test(name)) return -100;
  if (/wi-?fi|wireless|wlan|airport/i.test(name)) return 100;
  if (/ethernet|^en\d|^eth\d/i.test(name)) return 50;
  return 0;
}

function isLoopback(address) {
  if (typeof address !== 'string') return false;
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  return normalized === '::1' || (isIP(normalized) === 4 && normalized.startsWith('127.'));
}

function localUrls(port, interfaces = os.networkInterfaces()) {
  const seen = new Set();
  const addresses = [];
  for (const [name, entries] of Object.entries(interfaces || {})) {
    for (const entry of entries || []) {
      if (!entry || !['IPv4', 4].includes(entry.family) || entry.internal || isIP(entry.address) !== 4 ||
          isLoopback(entry.address) || entry.address.startsWith('0.') || Number(entry.address.split('.')[0]) >= 224) continue;
      addresses.push({ name, url: `http://${entry.address}:${port}`, priority: interfacePriority(name) });
    }
  }
  addresses.sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name) || a.url.localeCompare(b.url));
  return addresses.filter(({ url }) => {
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  }).map(({ name, url }) => ({ name, url }));
}

function connectionInfo({ port, interfaces, publicUrl, requestOrigin, remoteAddress, forwarded = false }) {
  // Do not reveal the server's private adapters to public clients or proxies.
  // Proxy headers never turn a remote request into a local one.
  const urls = isLoopback(remoteAddress) && !forwarded ? localUrls(port, interfaces) : [];
  return {
    participantBaseUrl: publicUrl || urls[0]?.url || (isLoopback(remoteAddress) && !forwarded
      ? `http://localhost:${port}` : requestOrigin),
    localUrls: urls,
  };
}

module.exports = { connectionInfo, isLoopback, localUrls };
