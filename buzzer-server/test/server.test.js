'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { io: connect } = require('socket.io-client');
const { createBuzzerServer } = require('../server');

function request(socket, event, payload = {}) {
  return new Promise((resolve, reject) => {
    socket.timeout(2000).emit(event, payload, (error, reply) => error ? reject(error) : resolve(reply));
  });
}

async function fixture(t, options = {}) {
  const service = createBuzzerServer(options);
  const address = await service.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${address.port}`;
  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.disconnect();
    await service.close();
  });
  async function client(extra = {}) {
    const socket = connect(url, { autoConnect: false, transports: ['websocket'], reconnection: false, ...extra });
    sockets.push(socket);
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
      socket.connect();
    });
    return socket;
  }
  const host = await client();
  const created = await request(host, 'room:create', { name: 'GameShow', hostName: 'Mauricio', requestId: randomUUID() });
  assert.equal(created.ok, true);
  async function player(name = 'Jogador', extra = {}) {
    const socket = await client();
    const joined = await request(socket, 'room:join', { code: created.room.code, name, ...extra });
    assert.equal(joined.ok, true, joined.error);
    return { socket, session: joined.session, room: joined.room };
  }
  async function start(extra = {}) {
    const reply = await request(host, 'round:start', {
      questionKey: 'musicas:1', label: 'Músicas · 1', requestId: randomUUID(), ...extra,
    });
    assert.equal(reply.ok, true, reply.error);
    return reply.room.round;
  }
  return { service, url, client, host, created, player, start };
}

test('concurrent presses establish one active player and immutable arrival order; judgments award once', async (t) => {
  const f = await fixture(t);
  const alice = await f.player('Alice');
  const bob = await f.player('Bob');
  const round = await f.start();
  const replies = await Promise.all([
    request(alice.socket, 'player:buzz', { roundId: round.id, playerId: bob.session.playerId, elapsedMs: -999 }),
    request(bob.socket, 'player:buzz', { roundId: round.id, playerId: alice.session.playerId, rank: 1 }),
  ]);
  assert.equal(replies.every((reply) => reply.ok), true);
  const state = (await request(f.host, 'room:sync')).room;
  assert.deepEqual(state.round.queue.map((press) => press.rank), [1, 2]);
  assert.equal(new Set(state.round.queue.map((press) => press.playerId)).size, 2);
  const [first, second] = state.round.queue;
  assert.equal(state.round.activePlayerId, first.playerId);
  assert.ok(first.elapsedMs >= 0);
  assert.ok(second.elapsedMs >= first.elapsedMs);
  const duplicate = await request(alice.socket, 'player:buzz', { roundId: round.id });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.room.round.queue.length, 2);
  const invalidOrder = await request(f.host, 'round:judge', { roundId: round.id, playerId: second.playerId, correct: true });
  assert.equal(invalidOrder.code, 'NOT_ACTIVE_PLAYER');
  const wrong = { roundId: round.id, playerId: first.playerId, correct: false, points: -2 };
  const judgedWrong = await request(f.host, 'round:judge', wrong);
  assert.equal(judgedWrong.room.round.activePlayerId, second.playerId);
  const duplicateWrong = await request(f.host, 'round:judge', wrong);
  assert.equal(duplicateWrong.ok, true);
  assert.equal(duplicateWrong.room.players.find((p) => p.id === first.playerId).score, -2);
  const answer = { roundId: round.id, playerId: second.playerId, correct: true, points: 5 };
  const winners = await Promise.all([request(f.host, 'round:judge', answer), request(f.host, 'round:judge', answer)]);
  assert.equal(winners.every((reply) => reply.ok), true);
  assert.equal(winners[1].room.players.find((p) => p.id === second.playerId).score, 5);
  assert.equal(winners[1].room.round.status, 'closed');
  assert.equal(winners[1].room.round.activePlayerId, null);
  assert.deepEqual(winners[1].room.round.queue.map((p) => p.outcome), ['incorrect', 'correct']);
  const conflict = await request(f.host, 'round:judge', { ...answer, correct: false });
  assert.equal(conflict.code, 'ALREADY_JUDGED');
});

test('old presses and resets cannot affect a newer round; start/reset/create retries are idempotent', async (t) => {
  const f = await fixture(t);
  const player = await f.player();
  const first = await f.start();
  const payload = { questionKey: 'filmes:2', label: 'Filmes · 2', requestId: randomUUID() };
  const [a, b] = await Promise.all([request(f.host, 'round:start', payload), request(f.host, 'round:start', payload)]);
  assert.equal(a.room.round.id, b.room.round.id);
  assert.notEqual(a.room.round.id, first.id);
  const stale = await request(player.socket, 'player:buzz', { roundId: first.id });
  assert.equal(stale.code, 'STALE_ROUND');
  const resetPayload = { roundId: b.room.round.id, requestId: randomUUID() };
  const reset = await request(f.host, 'round:reset', resetPayload);
  const retry = await request(f.host, 'round:reset', resetPayload);
  assert.equal(reset.room.round.id, retry.room.round.id);
  assert.notEqual(reset.room.round.id, b.room.round.id);
  const closeOld = await request(f.host, 'round:close', { roundId: b.room.round.id });
  assert.equal(closeOld.code, 'STALE_ROUND');
  const conflict = await request(f.host, 'round:start', { ...payload, questionKey: 'alterada' });
  assert.equal(conflict.code, 'REQUEST_CONFLICT');
  const other = await f.client();
  const createPayload = { name: 'Outra', hostName: 'Host', requestId: randomUUID() };
  const one = await request(other, 'room:create', createPayload);
  const again = await request(other, 'room:create', createPayload);
  assert.equal(one.room.code, again.room.code);
  assert.equal(one.session.token, again.session.token);
  assert.equal((await (await fetch(`${f.url}/health`)).json()).rooms, 2);
});

test('players and unauthenticated sockets cannot mutate host state or another room', async (t) => {
  const f = await fixture(t);
  const alice = await f.player('Alice');
  const stranger = await f.client();
  assert.equal((await request(stranger, 'room:sync')).code, 'SESSION_INVALID');
  for (const [event, payload] of [
    ['round:start', { questionKey: 'hack', label: 'Hack', requestId: randomUUID() }],
    ['host:score', { playerId: alice.session.playerId, delta: 500 }],
    ['room:settings', { correctPoints: 999 }], ['room:end', {}],
    ['team:create', { name: 'Hack' }], ['player:moderate', { playerId: alice.session.playerId, remove: true }],
  ]) assert.equal((await request(alice.socket, event, payload)).code, 'UNAUTHORIZED');
  const hostB = await f.client();
  const roomB = await request(hostB, 'room:create', { name: 'B', hostName: 'Outro host', requestId: randomUUID() });
  assert.equal((await request(hostB, 'host:score', { playerId: alice.session.playerId, delta: 99, code: f.created.room.code })).code, 'PLAYER_NOT_FOUND');
  assert.equal((await request(stranger, 'session:resume', { code: roomB.room.code, token: alice.session.token })).code, 'SESSION_INVALID');
  const snapshot = (await request(f.host, 'room:sync')).room;
  assert.equal(snapshot.players[0].score, 0);
  assert.equal(snapshot.ended, false);
  assert.equal(snapshot.teams.length, 0);
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes('token'), false);
  assert.equal(serialized.includes(f.created.session.token), false);
  assert.equal(serialized.includes(alice.session.token), false);
  const forged = await request(alice.socket, 'player:update', { score: 9999, blocked: false, id: 'fake', name: 'Novo nome' });
  assert.equal(forged.room.players[0].score, 0);
  assert.equal(forged.room.players[0].id, alice.session.playerId);
});

test('reconnection restores identity/score; last host socket disconnect closes buttons until rearmed', async (t) => {
  const f = await fixture(t);
  const alice = await f.player('Alice');
  await request(f.host, 'host:score', { playerId: alice.session.playerId, delta: 7 });
  const hostMirror = await f.client();
  await request(hostMirror, 'session:resume', f.created.session);
  const round = await f.start();
  f.host.disconnect();
  const withMirror = await request(alice.socket, 'player:buzz', { roundId: round.id });
  assert.equal(withMirror.ok, true);
  assert.equal(withMirror.room.hostConnected, true);
  const hostGone = new Promise((resolve) => {
    alice.socket.on('room:state', function listener(room) {
      if (!room.hostConnected) { alice.socket.off('room:state', listener); resolve(room); }
    });
  });
  hostMirror.disconnect();
  assert.equal((await hostGone).round.status, 'closed');
  alice.socket.disconnect();
  const resumedPlayer = await f.client();
  const resumed = await request(resumedPlayer, 'session:resume', alice.session);
  assert.equal(resumed.ok, true);
  assert.equal(resumed.room.players.length, 1);
  assert.equal(resumed.room.players[0].id, alice.session.playerId);
  assert.equal(resumed.room.players[0].score, 7);
  assert.equal(resumed.room.players[0].connected, true);
  const bob = await f.player('Bob');
  assert.equal((await request(bob.socket, 'player:buzz', { roundId: round.id })).code, 'HOST_OFFLINE');
  const resumedHost = await f.client();
  assert.equal((await request(resumedHost, 'session:resume', f.created.session)).ok, true);
  assert.equal((await request(bob.socket, 'player:buzz', { roundId: round.id })).code, 'ROUND_CLOSED');
  const reset = await request(resumedHost, 'round:reset', { roundId: round.id, requestId: randomUUID() });
  assert.equal((await request(resumedPlayer, 'player:buzz', { roundId: reset.room.round.id })).ok, true);
});

test('server timer closes new presses while preserving the pending queue for judging', async (t) => {
  const f = await fixture(t);
  const alice = await f.player('Alice');
  const bob = await f.player('Bob');
  const late = await f.player('Atrasado');
  const round = await f.start({ durationSeconds: 1 });
  assert.equal(round.deadlineAt - round.startedAt, 1000);
  await request(alice.socket, 'player:buzz', { roundId: round.id });
  await request(bob.socket, 'player:buzz', { roundId: round.id });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timer não encerrou a rodada')), 2500);
    f.host.on('room:state', function listener(room) {
      if (room.round.status === 'closed') {
        clearTimeout(timeout);
        f.host.off('room:state', listener);
        resolve();
      }
    });
  });
  assert.equal((await request(late.socket, 'player:buzz', { roundId: round.id })).code, 'ROUND_CLOSED');
  const wrong = await request(f.host, 'round:judge', { roundId: round.id, playerId: alice.session.playerId, correct: false });
  assert.equal(wrong.ok, true);
  assert.equal(wrong.room.round.status, 'closed');
  assert.equal(wrong.room.round.activePlayerId, bob.session.playerId);
  const correct = await request(f.host, 'round:judge', { roundId: round.id, playerId: bob.session.playerId, correct: true });
  assert.equal(correct.ok, true);
  assert.equal(correct.room.players.find((p) => p.id === bob.session.playerId).score, 1);
});

test('elapsed time uses a monotonic clock even if the wall clock moves backwards', async (t) => {
  let epoch = 1700000000000;
  let mono = 5000;
  const f = await fixture(t, { epochNow: () => epoch, monotonicNow: () => mono });
  const alice = await f.player('Alice');
  const bob = await f.player('Bob');
  const round = await f.start();
  mono += 100;
  const first = await request(alice.socket, 'player:buzz', { roundId: round.id });
  epoch -= 3600000;
  mono += 50;
  const second = await request(bob.socket, 'player:buzz', { roundId: round.id });
  assert.equal(first.room.round.queue[0].elapsedMs, 100);
  assert.equal(second.room.round.queue[1].elapsedMs, 150);
  assert.equal(second.room.round.startedAt, 1700000000000);
});

test('moderation cannot reopen judgment after a correct answer, even if the winner is removed', async (t) => {
  const f = await fixture(t);
  const alice = await f.player('Alice');
  const bob = await f.player('Bob');
  const round = await f.start();
  await request(alice.socket, 'player:buzz', { roundId: round.id });
  await request(bob.socket, 'player:buzz', { roundId: round.id });
  await request(f.host, 'round:judge', { roundId: round.id, playerId: alice.session.playerId, correct: true });
  const changed = await request(f.host, 'player:moderate', { playerId: alice.session.playerId, remove: true });
  assert.equal(changed.room.round.activePlayerId, null);
  const extraWinner = await request(f.host, 'round:judge', { roundId: round.id, playerId: bob.session.playerId, correct: true });
  assert.equal(extraWinner.code, 'ROUND_RESOLVED');
  assert.equal((await request(f.host, 'room:sync')).room.players[0].score, 0);
});

test('team scores derive from membership; moderation blocks and removal invalidates credentials', async (t) => {
  const f = await fixture(t);
  await request(f.host, 'room:settings', { teamMode: true });
  const team = await request(f.host, 'team:create', { name: 'Azuis', color: '#1122aa' });
  const teamId = team.room.teams[0].id;
  const alice = await f.player('Alice', { teamId });
  const bob = await f.player('Bob', { teamId });
  await request(f.host, 'host:score', { playerId: alice.session.playerId, delta: 3 });
  const scored = await request(f.host, 'host:score', { playerId: bob.session.playerId, delta: 4 });
  assert.equal(scored.room.teams[0].score, 7);
  const moved = await request(alice.socket, 'player:update', { teamId: null });
  assert.equal(moved.room.teams[0].score, 4);
  const round = await f.start();
  await request(f.host, 'player:moderate', { playerId: alice.session.playerId, blocked: true });
  assert.equal((await request(alice.socket, 'player:buzz', { roundId: round.id })).code, 'PLAYER_BLOCKED');
  await request(f.host, 'player:moderate', { playerId: alice.session.playerId, blocked: false });
  assert.equal((await request(alice.socket, 'player:buzz', { roundId: round.id })).ok, true);
  await request(bob.socket, 'player:buzz', { roundId: round.id });
  const removed = await request(f.host, 'player:moderate', { playerId: alice.session.playerId, remove: true });
  assert.equal(removed.room.round.activePlayerId, bob.session.playerId);
  assert.equal(removed.room.players.length, 1);
  assert.equal((await request(alice.socket, 'session:resume', alice.session)).code, 'SESSION_INVALID');
  assert.equal((await request(alice.socket, 'room:sync')).code, 'SESSION_INVALID');
  const charlie = await f.player('Charlie');
  const next = await request(charlie.socket, 'player:buzz', { roundId: round.id });
  assert.deepEqual(next.room.round.queue.map((p) => p.rank), [2, 3]);
  const deleted = await request(f.host, 'team:remove', { teamId });
  assert.equal(deleted.room.teams.length, 0);
  assert.equal(deleted.room.players[0].teamId, null);
  assert.equal(deleted.room.players[0].score, 4);
});

test('validated settings are atomic, duration bounds enforced, room end/rematch/reset-scores preserve identities', async (t) => {
  const f = await fixture(t);
  const player = await f.player();
  for (const timerSeconds of [-1, 601, 1.5, '10']) {
    const invalid = await request(f.host, 'room:settings', { name: 'Não aplicar', timerSeconds });
    assert.equal(invalid.ok, false);
  }
  assert.equal((await request(f.host, 'room:sync')).room.name, 'GameShow');
  assert.equal((await request(f.host, 'round:start', { questionKey: 'x', label: 'x', requestId: 'x', durationSeconds: 601 })).ok, false);
  const settings = await request(f.host, 'room:settings', { timerSeconds: 10, correctPoints: 5, incorrectPoints: -2 });
  assert.equal(settings.ok, true);
  const round = await f.start();
  assert.equal(round.durationSeconds, 10);
  await request(f.host, 'room:settings', { timerSeconds: 0 });
  assert.equal((await request(f.host, 'room:sync')).room.round.durationSeconds, 10);
  await request(player.socket, 'player:buzz', { roundId: round.id });
  await request(f.host, 'round:judge', { roundId: round.id, playerId: player.session.playerId, correct: true });
  const reset = await request(f.host, 'room:reset-scores');
  assert.equal(reset.room.players[0].score, 0);
  assert.equal(reset.room.round.queue.length, 0);
  assert.equal(reset.room.round.status, 'closed');
  await request(f.host, 'host:score', { playerId: player.session.playerId, delta: 9 });
  const end = await request(f.host, 'room:end');
  assert.equal(end.room.ended, true);
  assert.equal((await request(f.host, 'round:reset', { roundId: round.id, requestId: 'end' })).code, 'ROOM_ENDED');
  const rematch = await request(f.host, 'room:rematch');
  assert.equal(rematch.room.ended, false);
  assert.equal(rematch.room.round.status, 'waiting');
  assert.equal(rematch.room.round.id, null);
  assert.equal(rematch.room.players[0].score, 0);
  assert.equal(rematch.room.players[0].id, player.session.playerId);
  assert.equal((await request(f.host, 'round:close', { roundId: null })).ok, true);
});

test('HTTP serves only participant assets/config/QR and CORS permits configured and own origins', async (t) => {
  const f = await fixture(t, { publicUrl: 'https://buzzer.example.com', allowedOrigins: ['https://host.example.com'] });
  const config = await (await fetch(`${f.url}/api/config`)).json();
  assert.ok(config.avatars.includes('🎵'));
  assert.ok(config.colors.every((color) => /^#[a-f\d]{6}$/i.test(color)));
  assert.deepEqual(config.sounds.map((sound) => sound.id), ['classic', 'horn', 'laser', 'duck', 'boing', 'siren', 'arcade', 'pop']);
  const svgResponse = await fetch(`${f.url}/api/rooms/${f.created.room.code}/qr.svg`);
  assert.equal(svgResponse.status, 200);
  assert.match(svgResponse.headers.get('content-type'), /image\/svg\+xml/);
  const svg = await svgResponse.text();
  assert.match(svg, /<svg/);
  assert.equal(svg.includes(f.created.session.token), false);
  for (const route of ['/src/assets/audio/test.mp3', '/src/assets/images/test.jpg', '/package.json', '/../server.js', '/build/index.html']) {
    assert.equal((await fetch(`${f.url}${route}`)).status, 404);
  }
  const permitted = await fetch(`${f.url}/api/config`, { headers: { Origin: 'https://host.example.com' } });
  assert.equal(permitted.headers.get('access-control-allow-origin'), 'https://host.example.com');
  const local = await f.client({ extraHeaders: { Origin: 'http://localhost:3000' } });
  assert.equal(local.connected, true);
  const own = await f.client({ extraHeaders: { Origin: f.url } });
  assert.equal(own.connected, true);
  const configured = await f.client({ extraHeaders: { Origin: 'https://host.example.com' } });
  assert.equal(configured.connected, true);
  await assert.rejects(f.client({ extraHeaders: { Origin: 'https://attacker.example.com' } }));
});

test('capacity, idle expiration, invalid sessions and request throttling fail safely', async (t) => {
  let now = Date.now();
  const f = await fixture(t, { maxPlayers: 1, maxTeams: 1, roomTtlMs: 500, epochNow: () => now });
  const player = await f.player();
  const extra = await f.client();
  assert.equal((await request(extra, 'room:join', { code: f.created.room.code, name: 'Excesso' })).code, 'CAPACITY');
  await request(f.host, 'team:create', { name: 'Equipe' });
  assert.equal((await request(f.host, 'team:create', { name: 'Excesso' })).code, 'CAPACITY');
  const resume = await request(extra, 'session:resume', { code: f.created.room.code, token: 'x'.repeat(43) });
  assert.equal(resume.code, 'SESSION_INVALID');
  const round = await f.start();
  let limited = false;
  for (let i = 0; i < 15; i += 1) {
    const reply = await request(player.socket, 'player:buzz', { roundId: round.id });
    if (reply.code === 'RATE_LIMIT') limited = true;
  }
  assert.equal(limited, true);
  now += 1000;
  const newHost = await f.client();
  assert.equal((await request(newHost, 'room:create', { name: 'Nova', hostName: 'Novo host', requestId: randomUUID() })).ok, true);
  assert.equal((await request(extra, 'session:resume', player.session)).code, 'ROOM_NOT_FOUND');
  assert.equal((await request(f.host, 'room:sync')).code, 'SESSION_INVALID');
});
