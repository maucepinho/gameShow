'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const { connectionInfo, localUrls } = require('./network');

const AVATARS = Object.freeze(['🎵', '🎸', '🥁', '🎤', '🎹', '🎷', '🎺', '🦊', '🐼', '🐸', '🦁', '🐱', '🚀', '⭐', '⚡', '👑']);
const COLORS = Object.freeze(['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#a78bfa', '#f472b6', '#fb923c', '#e2e8f0']);
const SOUNDS = Object.freeze([
  { id: 'classic', name: 'Clássico' }, { id: 'horn', name: 'Buzina' },
  { id: 'laser', name: 'Laser' }, { id: 'duck', name: 'Pato' },
  { id: 'boing', name: 'Boing' }, { id: 'siren', name: 'Sirene' },
  { id: 'arcade', name: 'Arcade' }, { id: 'pop', name: 'Pop' },
]);
const SOUND_IDS = new Set(SOUNDS.map(({ id }) => id));
const DEFAULT_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

class RequestError extends Error {
  constructor(message, code = 'INVALID_INPUT') {
    super(message);
    this.code = code;
  }
}

function fail(message, code) { throw new RequestError(message, code); }
function has(object, key) { return Object.hasOwn(object, key); }
function textValue(value, label, max, min = 1) {
  if (typeof value !== 'string') fail(`${label} inválido.`);
  const clean = value.trim();
  if (clean.length < min || clean.length > max || /[\u0000-\u001f\u007f]/u.test(clean)) {
    fail(`${label} deve ter entre ${min} e ${max} caracteres.`);
  }
  return clean;
}
function integer(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label} deve ser inteiro de ${min} a ${max}.`);
  return value;
}
function booleanValue(value, label) {
  if (typeof value !== 'boolean') fail(`${label} inválido.`);
  return value;
}
function colorValue(value) {
  if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) fail('Cor inválida.');
  return value.toLowerCase();
}
function avatarValue(value) {
  if (!AVATARS.includes(value)) fail('Avatar inválido.');
  return value;
}
function soundValue(value) {
  if (!SOUND_IDS.has(value)) fail('Som inválido.');
  return value;
}
function roomCode(value) {
  const code = textValue(value, 'Código da sala', 6, 6).toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(code)) fail('Código da sala inválido.');
  return code;
}
function originValue(value) {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch { return null; }
}
function publicBaseValue(value) {
  if (!value) return null;
  const parsed = new URL(value);
  if (!originValue(value) || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) {
    throw new Error('PUBLIC_URL deve ser uma URL http(s) sem caminho, credenciais ou parâmetros.');
  }
  return parsed.origin;
}
function emptyRound() {
  return { id: null, questionKey: '', label: '', status: 'waiting', startedAt: null,
    deadlineAt: null, durationSeconds: 0, activePlayerId: null, queue: [] };
}

/** Single-process, in-memory authoritative service. Do not use multiple replicas. */
function createBuzzerServer(options = {}) {
  const app = express();
  app.disable('x-powered-by');
  const httpServer = http.createServer(app);
  const rooms = new Map();
  const creations = new Map();
  const ipRates = new Map();
  const baseUrl = publicBaseValue(options.publicUrl ?? (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL));
  const origins = new Set(DEFAULT_ORIGINS);
  const additional = options.allowedOrigins ?? (process.env.ALLOWED_ORIGINS || '').split(',');
  for (const value of additional) {
    if (!value.trim()) continue;
    const origin = originValue(value.trim());
    if (!origin) throw new Error('ALLOWED_ORIGINS contém uma origem inválida.');
    origins.add(origin);
  }
  if (baseUrl) origins.add(baseUrl);

  function networkInterfaces() {
    return typeof options.networkInterfaces === 'function' ? options.networkInterfaces() : options.networkInterfaces;
  }
  function serverPort() {
    return httpServer.address()?.port || 3001;
  }
  function requestConnectionInfo(request) {
    return connectionInfo({
      port: serverPort(), interfaces: networkInterfaces(), publicUrl: baseUrl,
      requestOrigin: originValue(`${request.secure ? 'https' : 'http'}://${request.get('host')}`),
      remoteAddress: request.socket.remoteAddress,
      forwarded: Boolean(request.headers.forwarded || request.headers['x-forwarded-for'] || request.headers['x-forwarded-host']),
    });
  }
  function allowedPresenterOrigin(origin) {
    return origins.has(origin) || (!baseUrl && localUrls(3000, networkInterfaces()).some(({ url }) => url === origin));
  }

  const limits = {
    rooms: options.maxRooms ?? 200,
    players: options.maxPlayers ?? 100,
    teams: options.maxTeams ?? 20,
    ttlMs: options.roomTtlMs ?? 24 * 60 * 60 * 1000,
    maxAgeMs: options.roomMaxAgeMs ?? 7 * 24 * 60 * 60 * 1000,
    rememberedRequests: options.maxRememberedRequests ?? 5000,
  };
  const epochNow = options.epochNow || Date.now;
  const monotonicNow = options.monotonicNow || (() => performance.now());

  function allowedOrigin(origin, request) {
    if (!origin) return true; // Native clients/health checks have no browser Origin.
    if (allowedPresenterOrigin(origin)) return true;
    const ownHost = request.headers.host;
    return origin === `http://${ownHost}` || origin === `https://${ownHost}`;
  }

  const io = new Server(httpServer, {
    maxHttpBufferSize: 16 * 1024,
    cors: {
      origin: (origin, callback) => callback(null, !origin || allowedPresenterOrigin(origin) || undefined),
      methods: ['GET', 'POST'],
    },
    allowRequest: (request, callback) => callback(null, allowedOrigin(request.headers.origin, request)),
    // Compression is unnecessary for these tiny snapshots.
    perMessageDeflate: false,
  });
  // Socket.IO's origin callback has no request; own-origin is always allowed by
  // allowRequest and needs no CORS response in a same-origin browser.

  function replyError(error) {
    if (error instanceof RequestError) return { ok: false, error: error.message, code: error.code };
    // Do not expose error internals, payloads, identities or credentials.
    console.error('Falha interna em uma operação do buzzer.');
    return { ok: false, error: 'Não foi possível concluir a operação.', code: 'INTERNAL_ERROR' };
  }
  function snapshot(room) {
    return {
      code: room.code, name: room.name, hostName: room.hostName, revision: room.revision,
      hostConnected: room.hostSockets.size > 0, ended: room.ended, teamMode: room.teamMode,
      timerSeconds: room.timerSeconds, correctPoints: room.correctPoints, incorrectPoints: room.incorrectPoints,
      players: [...room.players.values()].map((player) => ({
        id: player.id, name: player.name, avatar: player.avatar, color: player.color, sound: player.sound,
        teamId: player.teamId, score: player.score, blocked: player.blocked, connected: player.sockets.size > 0,
      })),
      teams: [...room.teams.values()].map((team) => ({ ...team,
        score: [...room.players.values()].reduce((sum, player) => sum + (player.teamId === team.id ? player.score : 0), 0),
      })),
      round: { ...room.round, queue: room.round.queue.map((press) => ({ ...press })) },
    };
  }
  function broadcast(room) {
    room.revision += 1;
    room.updatedAt = epochNow();
    io.to(room.code).emit('room:state', snapshot(room));
  }
  function stopTimer(room) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
  }
  function closeRound(room) {
    stopTimer(room);
    if (room.round.status === 'open') room.round.status = 'closed';
    // Preserve the pending contestant: the host may judge registered answers
    // after the deadline (or after manually closing the buttons).
  }
  function expireDeadline(room) {
    if (room.round.status === 'open' && room.round.durationSeconds > 0 &&
        monotonicNow() - room.roundMonotonic >= room.round.durationSeconds * 1000) {
      closeRound(room);
      broadcast(room);
    }
  }
  function scheduleDeadline(room, roundId) {
    if (room.round.durationSeconds <= 0) return;
    const remaining = room.round.durationSeconds * 1000 - (monotonicNow() - room.roundMonotonic);
    room.timer = setTimeout(() => {
      room.timer = null;
      if (rooms.get(room.code) !== room || room.round.id !== roundId || room.round.status !== 'open') return;
      expireDeadline(room);
      if (room.round.status === 'open') scheduleDeadline(room, roundId);
    }, Math.max(1, remaining));
    room.timer.unref();
  }
  function advanceActive(room) {
    if (room.roundResolved) { room.round.activePlayerId = null; return; }
    room.round.activePlayerId = room.round.queue.find((press) => {
      const player = room.players.get(press.playerId);
      return press.outcome === 'pending' && player && !player.blocked;
    })?.playerId || null;
  }
  function newRound(room, { questionKey, label, durationSeconds }) {
    stopTimer(room);
    room.roundMonotonic = monotonicNow();
    room.nextRank = 1;
    room.roundResolved = false;
    const startedAt = epochNow();
    room.round = {
      id: crypto.randomUUID(), questionKey, label, status: 'open', startedAt,
      deadlineAt: durationSeconds ? startedAt + durationSeconds * 1000 : null,
      durationSeconds, activePlayerId: null, queue: [],
    };
    room.judgments.clear();
    scheduleDeadline(room, room.round.id);
  }
  function requestId(value, minimum = 1) { return textValue(value, 'Identificador da operação', 128, minimum); }
  function checkRepeated(room, id, signature) {
    if (room.requests.has(id)) {
      if (room.requests.get(id) !== signature) fail('Identificador já usado em outra operação.', 'REQUEST_CONFLICT');
      return true;
    }
    if (room.requests.size >= limits.rememberedRequests) fail('Limite de rodadas desta sala atingido. Crie uma nova sala.', 'CAPACITY');
    return false;
  }
  function auth(socket, role) {
    const session = socket.data.session;
    const room = session && rooms.get(session.code);
    if (!room) fail('Entre novamente na sala.', 'SESSION_INVALID');
    if (role && session.role !== role) fail(role === 'host' ? 'Apenas o apresentador pode fazer isso.' : 'Apenas participantes podem fazer isso.', 'UNAUTHORIZED');
    if (session.role === 'player' && !room.players.has(session.playerId)) fail('Sua sessão não é mais válida.', 'SESSION_INVALID');
    room.updatedAt = epochNow();
    return { room, session };
  }
  function host(socket, { allowEnded = false } = {}) {
    const result = auth(socket, 'host');
    if (result.room.ended && !allowEnded) fail('A partida foi encerrada. Inicie uma revanche.', 'ROOM_ENDED');
    return result.room;
  }
  function matchingRound(room, id) {
    if (typeof id !== 'string' || id !== room.round.id) fail('Esta rodada já mudou. Aguarde a sincronização.', 'STALE_ROUND');
  }
  function findPlayer(room, id) {
    const player = typeof id === 'string' && room.players.get(id);
    if (!player) fail('Jogador não encontrado.', 'PLAYER_NOT_FOUND');
    return player;
  }
  function teamIdValue(room, value) {
    if (value === null) return null;
    if (typeof value !== 'string' || !room.teams.has(value)) fail('Equipe não encontrada.', 'TEAM_NOT_FOUND');
    return value;
  }
  function scoreAfter(player, delta) {
    return integer(player.score + delta, 'Pontuação total', -1000000000, 1000000000);
  }
  function detach(socket, notify = true) {
    const session = socket.data.session;
    if (!session) return;
    const room = rooms.get(session.code);
    socket.leave(session.code);
    delete socket.data.session;
    if (!room) return;
    if (session.role === 'host') {
      room.hostSockets.delete(socket.id);
      if (!room.hostSockets.size) closeRound(room);
    } else room.players.get(session.playerId)?.sockets.delete(socket.id);
    if (notify) broadcast(room);
  }
  function attach(socket, room, role, playerId) {
    const current = socket.data.session;
    if (current?.code === room.code && current.role === role && current.playerId === playerId) return;
    detach(socket);
    socket.data.session = { code: room.code, role, ...(playerId ? { playerId } : {}) };
    socket.join(room.code);
    if (role === 'host') room.hostSockets.add(socket.id);
    else room.players.get(playerId).sockets.add(socket.id);
    broadcast(room);
  }
  function sessionReply(room, role, token, playerId) {
    return { ok: true, room: snapshot(room), session: { code: room.code, role, token, ...(playerId ? { playerId } : {}) } };
  }
  function rateLimit(map, key, limit, windowMs) {
    const now = monotonicNow();
    let entry = map.get(key);
    if (!entry || now - entry.started >= windowMs) {
      entry = { started: now, count: 0 };
      map.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > limit) fail('Muitas tentativas. Aguarde alguns segundos.', 'RATE_LIMIT');
  }
  function deleteRoom(room) {
    stopTimer(room);
    rooms.delete(room.code);
    if (room.creationId) creations.delete(room.creationId);
    io.to(room.code).emit('room:expired', { code: room.code });
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.session?.code === room.code) {
        delete socket.data.session;
        socket.leave(room.code);
      }
    }
  }
  function sweep() {
    const now = epochNow();
    for (const room of rooms.values()) {
      if (now - room.updatedAt >= limits.ttlMs || now - room.createdAt >= limits.maxAgeMs) deleteRoom(room);
    }
    const monotonic = monotonicNow();
    for (const [key, entry] of ipRates) if (monotonic - entry.started > 10 * 60 * 1000) ipRates.delete(key);
  }
  const sweepTimer = setInterval(sweep, Math.min(60000, Math.max(1000, limits.ttlMs)));
  sweepTimer.unref();

  io.on('connection', (socket) => {
    const rates = new Map();
    const ip = socket.handshake.address || 'unknown';
    function on(event, handler) {
      socket.on(event, (payload, acknowledgement) => {
        const ack = typeof acknowledgement === 'function' ? acknowledgement : () => {};
        try {
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('Solicitação inválida.');
          rateLimit(rates, 'all', 160, 10000);
          if (event === 'player:buzz') rateLimit(rates, 'buzz', 12, 1000);
          const result = handler(payload);
          ack(result);
        } catch (error) { ack(replyError(error)); }
      });
    }

    on('room:create', (payload) => {
      // This unpredictable ID also authenticates an initial-create retry before
      // the host has received its token. Clients must use crypto.randomUUID().
      const id = requestId(payload.requestId, 16);
      const name = textValue(payload.name, 'Nome da sala', 80);
      const hostName = textValue(payload.hostName, 'Nome do apresentador', 40);
      const signature = JSON.stringify([name, hostName]);
      const previous = creations.get(id);
      if (previous) {
        if (previous.signature !== signature) fail('Identificador já usado em outra sala.', 'REQUEST_CONFLICT');
        const room = rooms.get(previous.code);
        if (room) {
          attach(socket, room, 'host');
          return sessionReply(room, 'host', room.hostToken);
        }
      }
      rateLimit(ipRates, `${ip}:create`, 12, 10 * 60 * 1000);
      sweep();
      if (rooms.size >= limits.rooms) fail('Servidor cheio. Tente novamente mais tarde.', 'CAPACITY');
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code;
      do { code = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join(''); } while (rooms.has(code));
      const now = epochNow();
      const room = {
        code, name, hostName, hostToken: crypto.randomBytes(32).toString('base64url'), hostSockets: new Set(),
        creationId: id, createdAt: now, updatedAt: now, revision: 0, ended: false, teamMode: false,
        timerSeconds: 0, correctPoints: 1, incorrectPoints: 0,
        players: new Map(), teams: new Map(), requests: new Map(), judgments: new Map(),
        round: emptyRound(), roundMonotonic: 0, nextRank: 1, roundResolved: false, timer: null,
      };
      rooms.set(code, room);
      creations.set(id, { code, signature });
      attach(socket, room, 'host');
      return sessionReply(room, 'host', room.hostToken);
    });

    on('room:join', (payload) => {
      const code = roomCode(payload.code);
      const room = rooms.get(code);
      if (!room) fail('Sala não encontrada ou expirada.', 'ROOM_NOT_FOUND');
      if (room.ended) fail('Esta partida foi encerrada.', 'ROOM_ENDED');
      const current = socket.data.session;
      if (current?.code === code && current.role === 'player') {
        const player = room.players.get(current.playerId);
        if (player) return sessionReply(room, 'player', player.token, player.id);
      }
      rateLimit(ipRates, `${ip}:join`, 180, 60000);
      if (room.players.size >= limits.players) fail('A sala está cheia.', 'CAPACITY');
      const name = textValue(payload.name, 'Nome do jogador', 32);
      const index = room.players.size;
      const player = {
        id: crypto.randomUUID(), token: crypto.randomBytes(32).toString('base64url'), name,
        avatar: has(payload, 'avatar') ? avatarValue(payload.avatar) : AVATARS[index % AVATARS.length],
        color: has(payload, 'color') ? colorValue(payload.color) : COLORS[index % COLORS.length],
        sound: has(payload, 'sound') ? soundValue(payload.sound) : 'classic',
        teamId: has(payload, 'teamId') ? teamIdValue(room, payload.teamId) : null,
        score: 0, blocked: false, sockets: new Set(),
      };
      room.players.set(player.id, player);
      attach(socket, room, 'player', player.id);
      return sessionReply(room, 'player', player.token, player.id);
    });

    on('session:resume', (payload) => {
      rateLimit(rates, 'resume', 20, 10000);
      let code;
      try { code = roomCode(payload.code); } catch { fail('Sua sessão não é mais válida. Entre novamente.', 'SESSION_INVALID'); }
      const room = rooms.get(code);
      if (!room) fail('Sala não encontrada ou expirada.', 'ROOM_NOT_FOUND');
      const token = payload.token;
      if (typeof token !== 'string' || !/^[A-Za-z\d_-]{43}$/.test(token)) {
        fail('Sua sessão não é mais válida. Entre novamente.', 'SESSION_INVALID');
      }
      if (token === room.hostToken) {
        attach(socket, room, 'host');
        return sessionReply(room, 'host', token);
      }
      const player = [...room.players.values()].find((item) => item.token === token);
      if (!player) fail('Sua sessão expirou ou foi removida. Entre novamente.', 'SESSION_INVALID');
      attach(socket, room, 'player', player.id);
      return sessionReply(room, 'player', token, player.id);
    });

    on('room:sync', () => {
      const { room } = auth(socket);
      expireDeadline(room);
      return { ok: true, room: snapshot(room) };
    });

    on('player:update', (payload) => {
      const { room, session } = auth(socket, 'player');
      const player = findPlayer(room, session.playerId);
      const changes = {};
      if (has(payload, 'name')) changes.name = textValue(payload.name, 'Nome do jogador', 32);
      if (has(payload, 'avatar')) changes.avatar = avatarValue(payload.avatar);
      if (has(payload, 'color')) changes.color = colorValue(payload.color);
      if (has(payload, 'sound')) changes.sound = soundValue(payload.sound);
      if (has(payload, 'teamId')) changes.teamId = teamIdValue(room, payload.teamId);
      Object.assign(player, changes);
      broadcast(room);
      return { ok: true, room: snapshot(room) };
    });

    on('player:buzz', (payload) => {
      const { room, session } = auth(socket, 'player');
      const player = findPlayer(room, session.playerId);
      matchingRound(room, payload.roundId);
      if (room.ended) fail('A partida foi encerrada.', 'ROOM_ENDED');
      if (player.blocked) fail('Seu botão foi bloqueado pelo apresentador.', 'PLAYER_BLOCKED');
      // A retry of an already accepted press remains successful after closure.
      if (room.round.queue.some((press) => press.playerId === player.id)) return { ok: true, room: snapshot(room) };
      expireDeadline(room);
      if (!room.hostSockets.size) fail('O apresentador está desconectado.', 'HOST_OFFLINE');
      if (room.round.status !== 'open') fail('O botão ainda não está liberado.', 'ROUND_CLOSED');
      room.round.queue.push({ playerId: player.id, rank: room.nextRank++,
        elapsedMs: Math.max(0, Math.floor(monotonicNow() - room.roundMonotonic)), outcome: 'pending' });
      advanceActive(room);
      broadcast(room);
      return { ok: true, room: snapshot(room) };
    });

    on('round:start', (payload) => {
      const room = host(socket);
      const id = requestId(payload.requestId);
      const questionKey = textValue(payload.questionKey, 'Questão', 256);
      const label = textValue(payload.label, 'Identificação da questão', 160);
      const durationSeconds = has(payload, 'durationSeconds') ? integer(payload.durationSeconds, 'Tempo', 0, 600) : room.timerSeconds;
      const signature = JSON.stringify(['start', questionKey, label, has(payload, 'durationSeconds') ? durationSeconds : null]);
      if (!checkRepeated(room, id, signature)) {
        newRound(room, { questionKey, label, durationSeconds });
        room.requests.set(id, signature);
        broadcast(room);
      }
      return { ok: true, room: snapshot(room) };
    });

    on('round:reset', (payload) => {
      const room = host(socket);
      const id = requestId(payload.requestId);
      const signature = JSON.stringify(['reset', payload.roundId]);
      if (!checkRepeated(room, id, signature)) {
        matchingRound(room, payload.roundId);
        const { questionKey, label } = room.round;
        newRound(room, { questionKey, label, durationSeconds: room.timerSeconds });
        room.requests.set(id, signature);
        broadcast(room);
      }
      return { ok: true, room: snapshot(room) };
    });

    on('round:close', (payload) => {
      const room = host(socket, { allowEnded: true });
      if (room.round.id === null && (payload.roundId === null || payload.roundId === undefined)) {
        return { ok: true, room: snapshot(room) };
      }
      matchingRound(room, payload.roundId);
      if (room.round.status === 'open') { closeRound(room); broadcast(room); }
      return { ok: true, room: snapshot(room) };
    });

    on('round:judge', (payload) => {
      const room = host(socket);
      matchingRound(room, payload.roundId);
      const player = findPlayer(room, payload.playerId);
      const correct = booleanValue(payload.correct, 'Resultado');
      const points = has(payload, 'points') ? integer(payload.points, 'Pontos', -100000, 100000) : (correct ? room.correctPoints : room.incorrectPoints);
      const previous = room.judgments.get(player.id);
      // A duplicate cannot award twice even when defaults changed meanwhile.
      if (previous) {
        if (previous.correct !== correct || (has(payload, 'points') && previous.points !== points)) {
          fail('Esta resposta já foi julgada.', 'ALREADY_JUDGED');
        }
        return { ok: true, room: snapshot(room) };
      }
      if (room.roundResolved) fail('Esta rodada já teve uma resposta correta. Reinicie para continuar.', 'ROUND_RESOLVED');
      expireDeadline(room);
      if (room.round.activePlayerId !== player.id) fail('Este jogador não é o próximo da fila.', 'NOT_ACTIVE_PLAYER');
      const press = room.round.queue.find((item) => item.playerId === player.id && item.outcome === 'pending');
      if (!press) fail('Esta resposta já foi julgada.', 'ALREADY_JUDGED');
      const newScore = scoreAfter(player, points);
      player.score = newScore;
      press.outcome = correct ? 'correct' : 'incorrect';
      room.judgments.set(player.id, { correct, points });
      if (correct) { closeRound(room); room.roundResolved = true; room.round.activePlayerId = null; }
      else advanceActive(room);
      broadcast(room);
      return { ok: true, room: snapshot(room) };
    });

    on('room:settings', (payload) => {
      const room = host(socket);
      const changes = {};
      if (has(payload, 'name')) changes.name = textValue(payload.name, 'Nome da sala', 80);
      if (has(payload, 'teamMode')) changes.teamMode = booleanValue(payload.teamMode, 'Modo de equipes');
      if (has(payload, 'timerSeconds')) changes.timerSeconds = integer(payload.timerSeconds, 'Tempo', 0, 600);
      if (has(payload, 'correctPoints')) changes.correctPoints = integer(payload.correctPoints, 'Pontos por acerto', -100000, 100000);
      if (has(payload, 'incorrectPoints')) changes.incorrectPoints = integer(payload.incorrectPoints, 'Pontos por erro', -100000, 100000);
      Object.assign(room, changes);
      broadcast(room);
      return { ok: true, room: snapshot(room) };
    });

    on('host:score', (payload) => {
      const room = host(socket, { allowEnded: true });
      const player = findPlayer(room, payload.playerId);
      const delta = integer(payload.delta, 'Ajuste de pontos', -1000000, 1000000);
      player.score = scoreAfter(player, delta);
      broadcast(room);
      return { ok: true, room: snapshot(room) };
    });

    on('team:create', (payload) => {
      const room = host(socket);
      if (room.teams.size >= limits.teams) fail('Limite de equipes atingido.', 'CAPACITY');
      const team = { id: crypto.randomUUID(), name: textValue(payload.name, 'Nome da equipe', 32),
        color: has(payload, 'color') ? colorValue(payload.color) : COLORS[room.teams.size % COLORS.length] };
      room.teams.set(team.id, team);
      broadcast(room);
      return { ok: true, room: snapshot(room) };
    });

    on('team:remove', (payload) => {
      const room = host(socket);
      const teamId = teamIdValue(room, payload.teamId);
      if (!teamId) fail('Equipe não encontrada.', 'TEAM_NOT_FOUND');
      room.teams.delete(teamId);
      for (const player of room.players.values()) if (player.teamId === teamId) player.teamId = null;
      broadcast(room);
      return { ok: true, room: snapshot(room) };
    });

    on('player:moderate', (payload) => {
      const room = host(socket, { allowEnded: true });
      const player = findPlayer(room, payload.playerId);
      const blocked = has(payload, 'blocked') ? booleanValue(payload.blocked, 'Bloqueio') : player.blocked;
      const remove = has(payload, 'remove') ? booleanValue(payload.remove, 'Remoção') : false;
      const teamId = has(payload, 'teamId') ? teamIdValue(room, payload.teamId) : player.teamId;
      if (remove) {
        room.players.delete(player.id);
        room.round.queue = room.round.queue.filter((press) => press.playerId !== player.id);
        for (const socketId of player.sockets) {
          const target = io.sockets.sockets.get(socketId);
          if (!target) continue;
          target.emit('session:removed', { code: room.code });
          target.leave(room.code);
          delete target.data.session;
        }
      } else { player.blocked = blocked; player.teamId = teamId; }
      advanceActive(room);
      broadcast(room);
      return { ok: true, room: snapshot(room) };
    });

    on('room:reset-scores', () => {
      const room = host(socket);
      for (const player of room.players.values()) player.score = 0;
      closeRound(room);
      room.round.queue = [];
      room.round.activePlayerId = null;
      room.judgments.clear();
      broadcast(room);
      return { ok: true, room: snapshot(room) };
    });

    on('room:end', () => {
      const room = host(socket, { allowEnded: true });
      room.ended = true;
      closeRound(room);
      broadcast(room);
      return { ok: true, room: snapshot(room) };
    });

    on('room:rematch', () => {
      const room = host(socket, { allowEnded: true });
      stopTimer(room);
      room.ended = false;
      room.round = emptyRound();
      room.roundResolved = false;
      room.judgments.clear();
      for (const player of room.players.values()) player.score = 0;
      broadcast(room);
      return { ok: true, room: snapshot(room) };
    });

    socket.on('disconnect', () => detach(socket));
  });

  app.use((request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const origin = request.headers.origin;
    if (origin && allowedOrigin(origin, request)) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    }
    if (request.method === 'OPTIONS') return response.sendStatus(204);
    next();
  });
  app.get('/health', (_request, response) => response.json({ ok: true, service: 'gameshow-buzzer', rooms: rooms.size }));
  app.get('/api/config', (_request, response) => response.json({ avatars: AVATARS, colors: COLORS, sounds: SOUNDS }));
  app.get('/api/connection-info', (request, response) => {
    const info = requestConnectionInfo(request);
    response.setHeader('Cache-Control', 'no-store');
    if (!info.participantBaseUrl) return response.status(400).json({ ok: false, error: 'Endereço do servidor inválido.' });
    return response.json(info);
  });
  app.get('/api/rooms/:code/qr.svg', async (request, response) => {
    try {
      const code = roomCode(request.params.code);
      if (!rooms.has(code)) return response.status(404).json({ ok: false, error: 'Sala não encontrada.', code: 'ROOM_NOT_FOUND' });
      // Hosted deployments must configure PUBLIC_URL / RENDER_EXTERNAL_URL so
      // links do not depend on untrusted Host or reverse-proxy headers.
      const info = requestConnectionInfo(request);
      let origin = info.participantBaseUrl;
      if (request.query.base !== undefined) {
        const selected = request.query.base;
        if (typeof selected !== 'string' || ![...info.localUrls.map(({ url }) => url), baseUrl, origin].includes(selected)) {
          return response.status(400).json({ ok: false, error: 'Endereço de conexão inválido.', code: 'INVALID_BASE_URL' });
        }
        origin = selected;
      }
      if (!origin) return response.status(400).json({ ok: false, error: 'Endereço do servidor inválido.' });
      const url = `${origin}/?room=${encodeURIComponent(code)}`;
      const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 260 });
      response.setHeader('Cache-Control', 'no-store');
      response.type('image/svg+xml').send(svg);
    } catch (error) {
      response.status(error instanceof RequestError ? 400 : 500).json(replyError(error));
    }
  });
  // This separate folder contains only participant HTML/CSS/JS. The quiz and its
  // local audio/image library are deliberately outside this static root.
  app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny', index: 'index.html' }));
  app.use((_request, response) => response.status(404).json({ ok: false, error: 'Página não encontrada.' }));

  return {
    app, httpServer, io,
    listen(port = 3001, hostname = '0.0.0.0') {
      return new Promise((resolve, reject) => {
        const onError = (error) => { httpServer.off('listening', onListening); reject(error); };
        const onListening = () => { httpServer.off('error', onError); resolve(httpServer.address()); };
        httpServer.once('error', onError);
        httpServer.once('listening', onListening);
        httpServer.listen(port, hostname);
      });
    },
    close() {
      clearInterval(sweepTimer);
      for (const room of rooms.values()) stopTimer(room);
      return new Promise((resolve) => io.close(() => resolve()));
    },
  };
}

module.exports = { createBuzzerServer };
