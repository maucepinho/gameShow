import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { BuzzerConnection, BuzzerController, BuzzerReply, BuzzerRoom, BuzzerSession, HostEvent } from './types';

const SESSION_KEY = 'gameshow:buzzer:host:v1';
const URL_KEY = 'gameshow:buzzer:url:v1';
const DEFAULT_URL = process.env.REACT_APP_BUZZER_URL || 'http://localhost:3001';

export function requestId(): string {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  if (!window.crypto?.getRandomValues) throw new Error('O buzzer exige um navegador atualizado com geração segura de identificadores.');
  const bytes = new Uint8Array(24);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function readStorage(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key: string, value: string | null): boolean {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    return true;
  } catch { return false; }
}

export function normalizeServerUrl(value: string): string {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Informe a URL do servidor, por exemplo https://meu-buzzer.onrender.com.');
  }
  if (window.location.protocol === 'https:' && url.protocol !== 'https:') {
    throw new Error('Nesta página, use um servidor com endereço HTTPS.');
  }
  return url.origin;
}

function savedSession(): { serverUrl: string; session: BuzzerSession } | null {
  try {
    const value = JSON.parse(readStorage(SESSION_KEY) || 'null');
    if (value?.session?.role !== 'host' || typeof value.session.token !== 'string' ||
        typeof value.session.code !== 'string') return null;
    return { serverUrl: normalizeServerUrl(value.serverUrl), session: value.session };
  } catch { return null; }
}

/** The service owns round order and scores. No host token is ever placed in a URL. */
export function useBuzzer(): BuzzerController {
  const [serverUrl, setServerUrl] = useState(() => readStorage(URL_KEY) || DEFAULT_URL);
  const [room, setRoom] = useState<BuzzerRoom | null>(null);
  const [connection, setConnection] = useState<BuzzerConnection>('disconnected');
  const [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const socketRef = useRef<Socket | null>(null);
  const roomRef = useRef<BuzzerRoom | null>(null);
  const sessionRef = useRef<BuzzerSession | null>(null);
  const readyRef = useRef(false);
  const mountedRef = useRef(true);
  const urlRef = useRef(serverUrl);
  const pendingRef = useRef(0);
  const desiredQuestionRef = useRef<{ key: string; label: string } | null>(null);
  const pendingStartRef = useRef<{ key: string; label: string; requestId?: string } | null>(null);
  const syncVersionRef = useRef(0);
  const questionQueueRef = useRef<Promise<void>>(Promise.resolve());

  const acceptRoom = useCallback((next: BuzzerRoom) => {
    if (!mountedRef.current) return;
    const previous = roomRef.current;
    if (previous && previous.code === next.code && previous.revision > next.revision) return;
    roomRef.current = next;
    setRoom(next);
  }, []);

  const send = useCallback((event: string, payload: Record<string, unknown>): Promise<BuzzerReply> => {
    const socket = socketRef.current;
    if (!socket?.connected) return Promise.resolve({ ok: false, error: 'Sem conexão com o buzzer. Aguarde a reconexão.' });
    return new Promise((resolve) => {
      // Check and emit synchronously: disconnected commands never enter Socket.IO's
      // send buffer. Reliable delivery still handles normal transport backpressure.
      socket.timeout(8000).emit(event, payload, (timeout: Error | null, reply: BuzzerReply) => {
        if (socket !== socketRef.current || !mountedRef.current) {
          resolve({ ok: false, error: 'A conexão mudou. Tente novamente.' });
        } else if (timeout || !reply || typeof reply.ok !== 'boolean') {
          resolve({ ok: false, error: 'O servidor não confirmou a ação. Confira o estado da sala antes de repetir.' });
        } else {
          if (reply.ok) acceptRoom(reply.room);
          resolve(reply);
        }
      });
    });
  }, [acceptRoom]);

  const forgetConnection = useCallback(() => {
    readyRef.current = false;
    const previous = socketRef.current;
    socketRef.current = null;
    if (previous) previous.sendBuffer.length = 0;
    previous?.removeAllListeners();
    previous?.disconnect();
    sessionRef.current = null;
    roomRef.current = null;
    syncVersionRef.current += 1;
    if (mountedRef.current) {
      setRoom(null);
      setConnection('disconnected');
    }
  }, []);

  const connect = useCallback((url: string, session: BuzzerSession | null, create?: {
    name: string; hostName: string; requestId: string;
  }): Promise<boolean> => {
    forgetConnection();
    urlRef.current = url;
    setServerUrl(url);
    writeStorage(URL_KEY, url);
    sessionRef.current = session;
    setError('');
    setConnection('connecting');
    const socket = io(url, { autoConnect: false, reconnection: true, timeout: 10000 });
    socketRef.current = socket;
    let firstSettled = false;
    let creation = create;
    let creationInFlight = false;
    return new Promise((resolve) => {
      const settle = (ok: boolean) => { if (!firstSettled) { firstSettled = true; resolve(ok); } };
      socket.on('room:state', (next: BuzzerRoom) => {
        if (socketRef.current === socket && readyRef.current) acceptRoom(next);
      });
      socket.on('room:expired', (expired: { code?: string }) => {
        if (socketRef.current !== socket || expired?.code !== sessionRef.current?.code) return;
        writeStorage(SESSION_KEY, null);
        forgetConnection();
        setError('Esta sala expirou. Crie uma nova sala para continuar.');
        settle(false);
      });
      socket.on('connect', async () => {
        if (socketRef.current !== socket || creationInFlight) return;
        readyRef.current = false;
        creationInFlight = true;
        const existing = sessionRef.current;
        const reply = existing
          ? await send('session:resume', { code: existing.code, token: existing.token })
          : creation
            ? await send('room:create', creation)
            : { ok: false as const, error: 'Crie uma sala para continuar.' };
        creationInFlight = false;
        if (socketRef.current !== socket || !mountedRef.current) return;
        if (!reply.ok) {
          setError(reply.error);
          if (reply.code) {
            if (reply.code === 'SESSION_INVALID' || reply.code === 'ROOM_NOT_FOUND') writeStorage(SESSION_KEY, null);
            forgetConnection();
          } else {
            setConnection('reconnecting');
            // A connection without a restored identity must never enable host controls.
            socket.disconnect();
            window.setTimeout(() => {
              if (socketRef.current === socket && mountedRef.current) socket.connect();
            }, 1500);
          }
          settle(false);
          return;
        }
        const restored = reply.session || existing;
        if (!restored || restored.role !== 'host') {
          setError('A sessão do apresentador não pôde ser restaurada.');
          forgetConnection();
          settle(false);
          return;
        }
        sessionRef.current = restored;
        creation = undefined;
        writeStorage(SESSION_KEY, JSON.stringify({ serverUrl: url, session: restored }));
        readyRef.current = true;
        acceptRoom(reply.room);
        setConnection('connected');
        setError('');
        setGeneration((value) => value + 1);
        settle(true);
      });
      socket.on('disconnect', () => {
        // A throttled browser can report connected after its ping has expired.
        // Socket.IO may then buffer an emit internally. Drop it before Socket.IO
        // clears acknowledgements, so it cannot replay ahead of session:resume.
        socket.sendBuffer.length = 0;
        if (socketRef.current !== socket || !mountedRef.current) return;
        readyRef.current = false;
        setConnection('reconnecting');
      });
      socket.on('connect_error', () => {
        if (socketRef.current !== socket || !mountedRef.current) return;
        readyRef.current = false;
        setConnection(sessionRef.current ? 'reconnecting' : 'disconnected');
        setError('Não foi possível conectar ao buzzer. Confira a URL e se o servidor está ativo.');
        settle(false);
      });
      socket.connect();
    });
  }, [acceptRoom, forgetConnection, send]);

  useEffect(() => {
    mountedRef.current = true;
    const saved = savedSession();
    if (saved) void connect(saved.serverUrl, saved.session);
    return () => {
      mountedRef.current = false;
      readyRef.current = false;
      if (socketRef.current) socketRef.current.sendBuffer.length = 0;
      socketRef.current?.removeAllListeners();
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [connect]);

  const request = useCallback(async (event: HostEvent, payload: Record<string, unknown> = {}) => {
    if (!readyRef.current) {
      if (mountedRef.current) setError('Aguarde o buzzer reconectar antes de continuar.');
      return false;
    }
    pendingRef.current += 1;
    if (mountedRef.current) setBusy(true);
    try {
      const reply = await send(event, payload);
      if (!reply.ok && (reply.code === 'SESSION_INVALID' || reply.code === 'ROOM_NOT_FOUND')) {
        writeStorage(SESSION_KEY, null);
        forgetConnection();
      }
      if (mountedRef.current) setError(reply.ok ? '' : reply.error);
      return reply.ok;
    } finally {
      pendingRef.current = Math.max(0, pendingRef.current - 1);
      if (mountedRef.current) setBusy(pendingRef.current > 0);
    }
  }, [send, forgetConnection]);

  const syncQuestion = useCallback((question: { key: string; label: string } | null): Promise<void> => {
    if (desiredQuestionRef.current?.key !== question?.key) {
      pendingStartRef.current = question ? { ...question } : null;
    }
    desiredQuestionRef.current = question;
    const version = ++syncVersionRef.current;
    const sync = async () => {
      if (version !== syncVersionRef.current || !readyRef.current) return;
      const desired = desiredQuestionRef.current;
      if (roomRef.current?.ended) return;
      if (desired) {
        // Restoring the same question must preserve its queue and result. A new
        // intent (including closing then reopening the same number) starts it.
        if (!pendingStartRef.current) {
          if (roomRef.current?.round.id && roomRef.current.round.questionKey === desired.key) return;
          pendingStartRef.current = { ...desired };
        }
        const intent = pendingStartRef.current;
        try { if (!intent.requestId) intent.requestId = requestId(); }
        catch (cause) {
          if (mountedRef.current) setError(cause instanceof Error ? cause.message : 'Não foi possível preparar a rodada.');
          return;
        }
        const accepted = await request('round:start', { questionKey: intent.key, label: intent.label, requestId: intent.requestId });
        if (accepted && pendingStartRef.current === intent) pendingStartRef.current = null;
      } else {
        const round = roomRef.current?.round;
        if (round?.id && round.status === 'open') await request('round:close', { roundId: round.id });
      }
    };
    // Serialize open/close so closing immediately after opening cannot leave an armed round behind.
    questionQueueRef.current = questionQueueRef.current.then(sync, sync);
    return questionQueueRef.current;
  }, [request]);

  const createRoom = useCallback(async (value: string, name: string, hostName: string) => {
    if (pendingRef.current) return false;
    let normalized: string;
    try { normalized = normalizeServerUrl(value); }
    catch (cause) {
      setError(cause instanceof Error && cause.message !== 'Invalid URL'
        ? cause.message : 'Informe uma URL completa, começando com http:// ou https://.');
      return false;
    }
    pendingRef.current += 1;
    setBusy(true);
    try { return await connect(normalized, null, { name, hostName, requestId: requestId() }); }
    catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : 'Não foi possível criar a sala.');
      return false;
    }
    finally {
      pendingRef.current = Math.max(0, pendingRef.current - 1);
      if (mountedRef.current) setBusy(pendingRef.current > 0);
    }
  }, [connect]);

  const disconnect = useCallback(() => {
    writeStorage(SESSION_KEY, null);
    forgetConnection();
  }, [forgetConnection]);
  const clearError = useCallback(() => setError(''), []);

  return { serverUrl, room, connection, generation, busy, error, createRoom, request, syncQuestion, disconnect, clearError };
}
