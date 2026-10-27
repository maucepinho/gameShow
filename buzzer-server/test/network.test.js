'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { io: connect } = require('socket.io-client');
const QRCode = require('qrcode');
const { connectionInfo, isLoopback, localUrls } = require('../network');
const { createBuzzerServer } = require('../server');

const ipv4 = (address, extra = {}) => ({ address, family: 'IPv4', internal: false, ...extra });
const interfaces = {
  'vEthernet (WSL)': [ipv4('172.20.0.1')],
  'VirtualBox Host-Only': [ipv4('192.168.56.1')],
  Ethernet: [ipv4('192.168.0.30')],
  'Wi-Fi': [ipv4('192.168.0.20'), { address: 'fe80::1', family: 'IPv6', internal: false }],
  Loopback: [ipv4('127.0.0.1', { internal: true }), ipv4('127.0.0.2')],
  VPN: [ipv4('10.8.0.1')],
};

test('LAN discovery prioritizes Wi-Fi and physical adapters over virtual/VPN and excludes loopback/IPv6', () => {
  assert.deepEqual(localUrls(3001, interfaces), [
    { name: 'Wi-Fi', url: 'http://192.168.0.20:3001' },
    { name: 'Ethernet', url: 'http://192.168.0.30:3001' },
    { name: 'vEthernet (WSL)', url: 'http://172.20.0.1:3001' },
    { name: 'VirtualBox Host-Only', url: 'http://192.168.56.1:3001' },
    { name: 'VPN', url: 'http://10.8.0.1:3001' },
  ]);
  assert.deepEqual(localUrls(54321, { A: [ipv4('192.168.1.4', { family: 4 })], B: [ipv4('192.168.1.4')] }), [
    { name: 'A', url: 'http://192.168.1.4:54321' },
  ]);
  for (const address of ['127.0.0.1', '127.0.0.2', '::1', '::ffff:127.0.0.1']) assert.equal(isLoopback(address), true);
  for (const address of ['192.168.0.20', '203.0.113.1', '127.0.0.1.attacker.test', undefined]) assert.equal(isLoopback(address), false);
});

test('connection info uses LAN/current port locally, localhost without adapters, and configured public URLs first', () => {
  const local = { interfaces, port: 43123, requestOrigin: 'http://localhost:43123', remoteAddress: '::ffff:127.0.0.1' };
  assert.equal(connectionInfo(local).participantBaseUrl, 'http://192.168.0.20:43123');
  assert.deepEqual(connectionInfo({ ...local, interfaces: {} }), {
    participantBaseUrl: 'http://localhost:43123', localUrls: [],
  });
  assert.equal(connectionInfo({ ...local, publicUrl: 'https://buzzer.example.com' }).participantBaseUrl, 'https://buzzer.example.com');
});

test('remote and proxied requests never receive private adapter addresses', () => {
  const remote = { interfaces, port: 3001, requestOrigin: 'https://buzzer.example.com', remoteAddress: '203.0.113.9' };
  assert.deepEqual(connectionInfo(remote), { participantBaseUrl: remote.requestOrigin, localUrls: [] });
  assert.deepEqual(connectionInfo({ ...remote, remoteAddress: '192.168.0.42' }), {
    participantBaseUrl: remote.requestOrigin, localUrls: [],
  });
  assert.deepEqual(connectionInfo({ ...remote, remoteAddress: '127.0.0.1', forwarded: true }), {
    participantBaseUrl: remote.requestOrigin, localUrls: [],
  });
  assert.deepEqual(connectionInfo({ ...remote, publicUrl: 'https://configured.example.com' }), {
    participantBaseUrl: 'https://configured.example.com', localUrls: [],
  });
});

async function fixture(t, options = {}) {
  const service = createBuzzerServer({ publicUrl: '', networkInterfaces: interfaces, ...options });
  const address = await service.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${address.port}`;
  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.disconnect();
    await service.close();
  });
  async function client(origin) {
    const socket = connect(url, { autoConnect: false, transports: ['websocket'], reconnection: false,
      ...(origin ? { extraHeaders: { Origin: origin } } : {}) });
    sockets.push(socket);
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
      socket.connect();
    });
    return socket;
  }
  async function room() {
    const host = await client('http://localhost:3000');
    return new Promise((resolve, reject) => host.timeout(2000).emit('room:create', {
      requestId: randomUUID(), name: 'LAN', hostName: 'Apresentador',
    }, (error, result) => error ? reject(error) : resolve(result.room.code)));
  }
  return { url, port: address.port, client, room };
}

test('HTTP connection info and default QR use the same LAN address and actual listening port', async (t) => {
  const f = await fixture(t);
  const response = await fetch(`${f.url}/api/connection-info`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const info = await response.json();
  assert.equal(info.participantBaseUrl, `http://192.168.0.20:${f.port}`);
  const code = await f.room();
  const qr = await (await fetch(`${f.url}/api/rooms/${code}/qr.svg`)).text();
  const expected = await QRCode.toString(`${info.participantBaseUrl}/?room=${code}`, {
    type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 260,
  });
  assert.equal(qr, expected);
  const proxied = await (await fetch(`${f.url}/api/connection-info`, { headers: { 'X-Forwarded-For': '203.0.113.9' } })).json();
  assert.deepEqual(proxied, { participantBaseUrl: f.url, localUrls: [] });
});

test('QR interface selection accepts discovered/public addresses and rejects arbitrary/modified URLs', async (t) => {
  const f = await fixture(t, { publicUrl: 'https://buzzer.example.com' });
  const code = await f.room();
  const info = await (await fetch(`${f.url}/api/connection-info`)).json();
  assert.equal(info.participantBaseUrl, 'https://buzzer.example.com');
  const selected = info.localUrls.find(({ name }) => name === 'Ethernet').url;
  const route = `${f.url}/api/rooms/${code}/qr.svg`;
  const qr = await (await fetch(`${route}?base=${encodeURIComponent(selected)}`)).text();
  assert.equal(qr, await QRCode.toString(`${selected}/?room=${code}`, {
    type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 260,
  }));
  assert.equal((await fetch(`${route}?base=${encodeURIComponent(info.participantBaseUrl)}`)).status, 200);
  for (const value of ['https://attacker.example.com', `${selected}/path`, `${selected}/`, `${selected}?redirect=x`,
    `http://192.168.0.20:${f.port + 1}`, 'javascript:alert(1)', 'http://192.168.0.20.attacker.test:3001']) {
    const invalid = await fetch(`${route}?base=${encodeURIComponent(value)}`);
    assert.equal(invalid.status, 400, value);
    assert.equal((await invalid.json()).code, 'INVALID_BASE_URL');
  }
  assert.equal((await fetch(`${route}?base=x&base=y`)).status, 400);
  assert.equal((await fetch(`${route}?base=${encodeURIComponent(selected)}`, {
    headers: { 'X-Forwarded-For': '203.0.113.9' },
  })).status, 400);
});

test('LAN presenter CORS permits only detected addresses on port 3000, and stays opt-in for hosted service', async (t) => {
  const f = await fixture(t);
  const origin = 'http://192.168.0.20:3000';
  const response = await fetch(`${f.url}/api/connection-info`, { headers: { Origin: origin } });
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal((await f.client(origin)).connected, true);
  for (const rejected of ['http://192.168.0.21:3000', 'http://192.168.0.20:3002', 'https://attacker.example.com']) {
    assert.equal((await fetch(`${f.url}/api/connection-info`, { headers: { Origin: rejected } })).headers.get('access-control-allow-origin'), null);
    await assert.rejects(f.client(rejected));
  }
  const hosted = await fixture(t, { publicUrl: 'https://buzzer.example.com' });
  await assert.rejects(hosted.client(origin));
});
