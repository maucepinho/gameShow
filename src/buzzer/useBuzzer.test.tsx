import { act, renderHook } from '@testing-library/react';
import { randomFillSync } from 'crypto';
import { BuzzerController, BuzzerReply, BuzzerRoom, BuzzerSession } from './types';
import { useBuzzer } from './useBuzzer';

const mockIo = jest.fn();
jest.mock('socket.io-client', () => ({ io: (...args: unknown[]) => mockIo(...args) }));

type Ack = (error: Error | null, reply: BuzzerReply) => void;
interface Packet {
  event: string;
  payload: Record<string, unknown>;
  ack: Ack;
  volatile: boolean;
  settled: boolean;
}

/** A manual transport keeps network acknowledgements independent of React renders. */
class FakeSocket {
  connected = false;
  pingExpired = false;
  packets: Packet[] = [];
  sendBuffer: Packet[] = [];
  pendingAcks = new Set<Packet>();
  listeners = new Map<string, Array<(...args: any[]) => unknown>>();
  connect = jest.fn(() => this);
  disconnect = jest.fn(() => {
    if (this.connected) this.serverDisconnect();
    return this;
  });
  removeAllListeners = jest.fn(() => { this.listeners.clear(); return this; });

  on(event: string, listener: (...args: any[]) => unknown) {
    this.listeners.set(event, [...(this.listeners.get(event) || []), listener]);
    return this;
  }

  timeout() { return this.emitter(false); }
  get volatile() { return { timeout: () => this.emitter(true) }; }

  private emitter(volatile: boolean) {
    return { emit: (event: string, payload: Record<string, unknown>, ack: Ack) => {
      const packet = { event, payload, ack, volatile, settled: false };
      this.pendingAcks.add(packet);
      if (!this.connected || this.pingExpired) {
        if (!volatile) this.sendBuffer.push(packet);
      } else this.packets.push(packet);
    } };
  }

  serverConnect() {
    this.connected = true;
    this.pingExpired = false;
    // Socket.IO flushes its internal buffer before emitting the connect event.
    this.packets.push(...this.sendBuffer);
    this.sendBuffer = [];
    this.dispatch('connect');
  }
  serverDisconnect() {
    this.connected = false;
    this.dispatch('disconnect', 'transport close');
    // Socket.IO clears acknowledgements after disconnect handlers. Buffered
    // packets retain their ack unless the application has removed them first.
    this.pendingAcks.forEach((packet) => {
      if (packet.settled || this.sendBuffer.includes(packet)) return;
      packet.settled = true;
      packet.ack(new Error('socket has been disconnected'), undefined as unknown as BuzzerReply);
    });
  }
  snapshot(room: BuzzerRoom) { this.dispatch('room:state', room); }
  expired(code = 'ABCDEF') { this.dispatch('room:expired', { code }); }
  events(event: string) { return this.packets.filter((packet) => packet.event === event); }

  respond(event: string, reply: BuzzerReply) {
    const packet = this.packets.find((item) => item.event === event && !item.settled);
    if (!packet) throw new Error(`No pending ${event} request`);
    packet.settled = true;
    packet.ack(null, reply);
  }

  loseAcknowledgement(event: string) {
    const packet = this.packets.find((item) => item.event === event && !item.settled);
    if (!packet) throw new Error(`No pending ${event} request`);
    packet.settled = true;
    packet.ack(new Error('ack timeout'), undefined as unknown as BuzzerReply);
  }

  private dispatch(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach((listener) => { void listener(...args); });
  }
}

let mockSocket: FakeSocket;
const SESSION_KEY = 'gameshow:buzzer:host:v1';
const session: BuzzerSession = { role: 'host', code: 'ABCDEF', token: 'test-host-session-token' };

function room(revision = 1): BuzzerRoom {
  return {
    code: 'ABCDEF', name: 'Música', hostName: 'Maurício', revision, hostConnected: true,
    ended: false, teamMode: false, timerSeconds: 0, correctPoints: 1, incorrectPoints: 0,
    players: [], teams: [], round: {
      id: null, questionKey: '', label: '', status: 'waiting', startedAt: null, deadlineAt: null,
      durationSeconds: 0, activePlayerId: null, queue: [],
    },
  };
}

function saveHostSession() {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ serverUrl: 'https://buzzer.example', session }));
}

async function connectedHost() {
  saveHostSession();
  const view = renderHook(() => useBuzzer());
  act(() => { mockSocket.serverConnect(); });
  await act(async () => { mockSocket.respond('session:resume', { ok: true, room: room(), session }); });
  return view;
}

async function startQuestion(controller: BuzzerController) {
  let pending: Promise<void>;
  act(() => { pending = controller.syncQuestion({ key: 'filmes:1', label: 'Filmes · Pergunta 1' }); });
  await act(async () => { await Promise.resolve(); });
  const opened = room(2);
  opened.round = { ...opened.round, id: 'round-1', questionKey: 'filmes:1', label: 'Filmes · Pergunta 1', status: 'open', startedAt: Date.now() };
  await act(async () => {
    mockSocket.respond('round:start', { ok: true, room: opened });
    await pending;
  });
  return opened;
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'crypto', { configurable: true, value: { getRandomValues: (array: Uint8Array) => randomFillSync(array) } });
  mockSocket = new FakeSocket();
  mockIo.mockReset().mockReturnValue(mockSocket);
});

afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test('restaura a identidade salva em toda conexão e só libera controles depois do acknowledgement', async () => {
  saveHostSession();
  const { result } = renderHook(() => useBuzzer());
  expect(mockIo).toHaveBeenCalledWith('https://buzzer.example', expect.objectContaining({ autoConnect: false, reconnection: true }));
  expect(result.current.connection).toBe('connecting');
  act(() => { mockSocket.serverConnect(); });
  expect(mockSocket.events('session:resume')[0].payload).toEqual({ code: 'ABCDEF', token: session.token });
  expect(result.current.connection).not.toBe('connected');
  await act(async () => { mockSocket.respond('session:resume', { ok: true, room: room(), session }); });
  expect(result.current.connection).toBe('connected');
  expect(result.current.generation).toBe(1);
  act(() => { mockSocket.serverDisconnect(); });
  expect(result.current.connection).toBe('reconnecting');
  act(() => { mockSocket.serverConnect(); });
  expect(mockSocket.events('session:resume')).toHaveLength(2);
  expect(result.current.connection).toBe('reconnecting');
  await act(async () => { mockSocket.respond('session:resume', { ok: true, room: room(2), session }); });
  expect(result.current.connection).toBe('connected');
  expect(result.current.generation).toBe(2);
});

test('comandos offline não são enviados nem acumulados para depois da reconexão', async () => {
  const { result } = await connectedHost();
  act(() => { mockSocket.serverDisconnect(); });
  let accepted: boolean | undefined;
  await act(async () => { accepted = await result.current.request('host:score', { playerId: 'ana', delta: 1 }); });
  expect(accepted).toBe(false);
  expect(mockSocket.events('host:score')).toHaveLength(0);
  act(() => { mockSocket.serverConnect(); });
  await act(async () => { mockSocket.respond('session:resume', { ok: true, room: room(2), session }); });
  expect(mockSocket.events('host:score')).toHaveLength(0);
  expect(result.current.error).toBe('');
});

test('comandos online usam envio confiável e retornam o estado confirmado pelo servidor', async () => {
  const { result } = await connectedHost();
  let pending: Promise<boolean>;
  act(() => { pending = result.current.request('room:settings', { timerSeconds: 30 }); });
  expect(result.current.busy).toBe(true);
  expect(mockSocket.events('room:settings')[0]).toEqual(expect.objectContaining({ payload: { timerSeconds: 30 }, volatile: false }));
  await act(async () => {
    mockSocket.respond('room:settings', { ok: true, room: { ...room(2), timerSeconds: 30 } });
    expect(await pending).toBe(true);
  });
  expect(result.current.busy).toBe(false);
  expect(result.current.room?.timerSeconds).toBe(30);
});

test('fechar antes da confirmação de abertura espera o novo roundId e fecha a rodada correta', async () => {
  const { result } = await connectedHost();
  let opening: Promise<void>;
  act(() => { opening = result.current.syncQuestion({ key: 'filmes:1', label: 'Filmes · Pergunta 1' }); });
  // Allow the serialized operation to reach the transport, leaving its ack pending.
  await act(async () => { await Promise.resolve(); });
  expect(mockSocket.events('round:start')).toHaveLength(1);
  const start = mockSocket.events('round:start')[0];
  expect(start.payload).toEqual({ questionKey: 'filmes:1', label: 'Filmes · Pergunta 1', requestId: expect.any(String) });
  let closing: Promise<void>;
  act(() => { closing = result.current.syncQuestion(null); });
  expect(mockSocket.events('round:close')).toHaveLength(0);
  const opened = room(2);
  opened.round = { ...opened.round, id: 'fresh-round-id', questionKey: 'filmes:1', label: 'Filmes · Pergunta 1', status: 'open', startedAt: Date.now() };
  await act(async () => {
    mockSocket.respond('round:start', { ok: true, room: opened });
    await opening;
  });
  expect(mockSocket.events('round:close')[0].payload).toEqual({ roundId: 'fresh-round-id' });
  await act(async () => {
    mockSocket.respond('round:close', { ok: true, room: { ...opened, revision: 3, round: { ...opened.round, status: 'closed' } } });
    await closing;
  });
  expect(result.current.room?.round.status).toBe('closed');
});

test('uma falha semântica de criação não tenta criar salas em loop', async () => {
  jest.useFakeTimers();
  const { result } = renderHook(() => useBuzzer());
  let creation: Promise<boolean>;
  act(() => { creation = result.current.createRoom('https://buzzer.example', '', 'Maurício'); });
  act(() => { mockSocket.serverConnect(); });
  await act(async () => {
    mockSocket.respond('room:create', { ok: false, error: 'Nome da sala inválido.', code: 'INVALID_INPUT' });
    expect(await creation).toBe(false);
  });
  act(() => { jest.advanceTimersByTime(10000); });
  expect(mockSocket.connect).toHaveBeenCalledTimes(1);
  expect(mockSocket.events('room:create')).toHaveLength(1);
  expect(result.current.connection).toBe('disconnected');
  expect(result.current.busy).toBe(false);
  expect(result.current.error).toBe('Nome da sala inválido.');
});

test('snapshots atrasados e acknowledgements antigos não fazem o estado regredir', async () => {
  const { result } = await connectedHost();
  let pending: Promise<boolean>;
  act(() => { pending = result.current.request('room:settings', { timerSeconds: 15 }); });
  act(() => { mockSocket.snapshot({ ...room(5), timerSeconds: 45 }); });
  act(() => { mockSocket.snapshot({ ...room(3), timerSeconds: 20 }); });
  await act(async () => {
    mockSocket.respond('room:settings', { ok: true, room: { ...room(4), timerSeconds: 15 } });
    await pending;
  });
  expect(result.current.room?.revision).toBe(5);
  expect(result.current.room?.timerSeconds).toBe(45);
});

test.each(['SESSION_INVALID', 'ROOM_NOT_FOUND'])('sessão expirada %s limpa a credencial salva', async (code) => {
  saveHostSession();
  const { result } = renderHook(() => useBuzzer());
  act(() => { mockSocket.serverConnect(); });
  await act(async () => { mockSocket.respond('session:resume', { ok: false, error: 'A sala expirou.', code }); });
  expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  expect(result.current.room).toBeNull();
  expect(result.current.connection).toBe('disconnected');
  expect(result.current.error).toBe('A sala expirou.');
});

test('aviso de expiração limpa somente a sala atual e impede novos comandos', async () => {
  const { result } = await connectedHost();
  act(() => { mockSocket.expired('OTHER1'); });
  expect(result.current.connection).toBe('connected');
  expect(localStorage.getItem(SESSION_KEY)).not.toBeNull();
  act(() => { mockSocket.expired(); });
  expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  expect(result.current.connection).toBe('disconnected');
  expect(result.current.room).toBeNull();
  expect(result.current.error).toBe('Esta sala expirou. Crie uma nova sala para continuar.');
  await act(async () => { expect(await result.current.request('room:end')).toBe(false); });
  expect(mockSocket.events('room:end')).toHaveLength(0);
});

test.each(['SESSION_INVALID', 'ROOM_NOT_FOUND'])('erro %s em um comando também apaga sessão sem ficar reconectando', async (code) => {
  const { result } = await connectedHost();
  let pending: Promise<boolean>;
  act(() => { pending = result.current.request('room:end'); });
  await act(async () => {
    mockSocket.respond('room:end', { ok: false, error: 'Sua sessão expirou.', code });
    expect(await pending).toBe(false);
  });
  expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  expect(result.current.room).toBeNull();
  expect(result.current.connection).toBe('disconnected');
  expect(result.current.busy).toBe(false);
  expect(result.current.error).toBe('Sua sessão expirou.');
});

test('ressincronizar a mesma pergunta após reconectar preserva a fila e o resultado da rodada', async () => {
  const { result } = await connectedHost();
  const opened = await startQuestion(result.current);
  const finished: BuzzerRoom = {
    ...opened, revision: 3,
    round: { ...opened.round, status: 'closed', queue: [{ playerId: 'ana', rank: 1, elapsedMs: 500, outcome: 'correct' }] },
  };
  act(() => { mockSocket.snapshot(finished); mockSocket.serverDisconnect(); });
  await act(async () => { await result.current.syncQuestion({ key: 'filmes:1', label: 'Filmes · Pergunta 1' }); });
  act(() => { mockSocket.serverConnect(); });
  await act(async () => { mockSocket.respond('session:resume', { ok: true, room: finished, session }); });
  await act(async () => { await result.current.syncQuestion({ key: 'filmes:1', label: 'Filmes · Pergunta 1' }); });
  expect(mockSocket.events('round:start')).toHaveLength(1);
  expect(result.current.room?.round).toEqual(finished.round);
});

test('fechar e reabrir o mesmo número gera uma intenção nova e inicia outra rodada', async () => {
  const { result } = await connectedHost();
  const opened = await startQuestion(result.current);
  const firstId = mockSocket.events('round:start')[0].payload.requestId;
  let closing: Promise<void>;
  act(() => { closing = result.current.syncQuestion(null); });
  await act(async () => { await Promise.resolve(); });
  await act(async () => {
    mockSocket.respond('round:close', { ok: true, room: { ...opened, revision: 3, round: { ...opened.round, status: 'closed' } } });
    await closing;
  });
  let reopening: Promise<void>;
  act(() => { reopening = result.current.syncQuestion({ key: 'filmes:1', label: 'Filmes · Pergunta 1' }); });
  await act(async () => { await Promise.resolve(); });
  expect(mockSocket.events('round:start')).toHaveLength(2);
  expect(mockSocket.events('round:start')[1].payload.requestId).not.toBe(firstId);
  await act(async () => {
    mockSocket.respond('round:start', { ok: true, room: { ...opened, revision: 4, round: { ...opened.round, id: 'round-2' } } });
    await reopening;
  });
  expect(result.current.room?.round.id).toBe('round-2');
});

test('trocar o número offline registra a intenção e só envia a nova pergunta após reconectar', async () => {
  const { result } = await connectedHost();
  const opened = await startQuestion(result.current);
  act(() => { mockSocket.serverDisconnect(); });
  await act(async () => { await result.current.syncQuestion({ key: 'filmes:2', label: 'Filmes · Pergunta 2' }); });
  expect(mockSocket.events('round:start')).toHaveLength(1);
  act(() => { mockSocket.serverConnect(); });
  await act(async () => { mockSocket.respond('session:resume', { ok: true, room: { ...opened, revision: 3, round: { ...opened.round, status: 'closed' } }, session }); });
  let resync: Promise<void>;
  act(() => { resync = result.current.syncQuestion({ key: 'filmes:2', label: 'Filmes · Pergunta 2' }); });
  await act(async () => { await Promise.resolve(); });
  expect(mockSocket.events('round:start')).toHaveLength(2);
  expect(mockSocket.events('round:start')[1].payload).toEqual({ questionKey: 'filmes:2', label: 'Filmes · Pergunta 2', requestId: expect.any(String) });
  await act(async () => {
    mockSocket.respond('round:start', { ok: true, room: { ...opened, revision: 4, round: { ...opened.round, id: 'round-2', questionKey: 'filmes:2', label: 'Filmes · Pergunta 2' } } });
    await resync;
  });
  expect(result.current.room?.round.questionKey).toBe('filmes:2');
});

test('retry depois de perder a confirmação de abertura reutiliza requestId para não apagar a fila', async () => {
  const { result } = await connectedHost();
  let opening: Promise<void>;
  act(() => { opening = result.current.syncQuestion({ key: 'filmes:1', label: 'Filmes · Pergunta 1' }); });
  await act(async () => { await Promise.resolve(); });
  const firstRequestId = mockSocket.events('round:start')[0].payload.requestId;
  await act(async () => { mockSocket.loseAcknowledgement('round:start'); await opening; });
  const accepted = room(2);
  accepted.round = { ...accepted.round, id: 'round-already-created', questionKey: 'filmes:1', label: 'Filmes · Pergunta 1', status: 'closed', queue: [{ playerId: 'ana', rank: 1, elapsedMs: 350, outcome: 'correct' }] };
  act(() => { mockSocket.serverDisconnect(); mockSocket.serverConnect(); });
  await act(async () => { mockSocket.respond('session:resume', { ok: true, room: accepted, session }); });
  let retry: Promise<void>;
  act(() => { retry = result.current.syncQuestion({ key: 'filmes:1', label: 'Filmes · Pergunta 1' }); });
  await act(async () => { await Promise.resolve(); });
  expect(mockSocket.events('round:start')).toHaveLength(2);
  expect(mockSocket.events('round:start')[1].payload.requestId).toBe(firstRequestId);
  await act(async () => { mockSocket.respond('round:start', { ok: true, room: accepted }); await retry; });
  expect(result.current.room?.round.id).toBe('round-already-created');
  expect(result.current.room?.round.queue).toEqual(accepted.round.queue);
});

test('um comando retido por ping expirado é descartado antes do resume e mantém a credencial do apresentador', async () => {
  const { result } = await connectedHost();
  const savedCredential = localStorage.getItem(SESSION_KEY);
  // A background tab may still report connected after the engine ping expired.
  mockSocket.pingExpired = true;
  expect(mockSocket.connected).toBe(true);
  let pending: Promise<boolean>;
  act(() => { pending = result.current.request('host:score', { playerId: 'ana', delta: 10 }); });
  expect(mockSocket.sendBuffer).toHaveLength(1);
  expect(mockSocket.events('host:score')).toHaveLength(0);
  act(() => { mockSocket.serverDisconnect(); });
  expect(mockSocket.sendBuffer).toHaveLength(0);
  await act(async () => { expect(await pending).toBe(false); });
  expect(result.current.connection).toBe('reconnecting');
  expect(result.current.busy).toBe(false);
  expect(localStorage.getItem(SESSION_KEY)).toBe(savedCredential);
  act(() => { mockSocket.serverConnect(); });
  expect(mockSocket.events('host:score')).toHaveLength(0);
  expect(mockSocket.events('session:resume')).toHaveLength(2);
  expect(mockSocket.events('session:resume')[1].payload).toEqual({ code: session.code, token: session.token });
  await act(async () => { mockSocket.respond('session:resume', { ok: true, room: room(2), session }); });
  expect(result.current.connection).toBe('connected');
  expect(result.current.error).toBe('');
  expect(localStorage.getItem(SESSION_KEY)).toBe(savedCredential);
  expect(mockSocket.events('host:score')).toHaveLength(0);
});
