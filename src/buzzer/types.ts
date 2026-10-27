export type BuzzerSound = 'classic' | 'horn' | 'laser' | 'duck' | 'boing' | 'siren' | 'arcade' | 'pop';

export interface BuzzerPlayer {
  id: string;
  name: string;
  avatar: string;
  color: string;
  sound: BuzzerSound;
  teamId: string | null;
  score: number;
  connected: boolean;
  blocked: boolean;
}

export interface BuzzerTeam {
  id: string;
  name: string;
  color: string;
  score: number;
}

export interface BuzzerPress {
  playerId: string;
  rank: number;
  elapsedMs: number;
  outcome: 'pending' | 'correct' | 'incorrect';
}

export interface BuzzerRound {
  id: string | null;
  questionKey: string;
  label: string;
  status: 'waiting' | 'open' | 'closed';
  startedAt: number | null;
  deadlineAt: number | null;
  durationSeconds: number;
  activePlayerId: string | null;
  queue: BuzzerPress[];
}

export interface BuzzerRoom {
  code: string;
  name: string;
  hostName: string;
  revision: number;
  hostConnected: boolean;
  ended: boolean;
  teamMode: boolean;
  timerSeconds: number;
  correctPoints: number;
  incorrectPoints: number;
  players: BuzzerPlayer[];
  teams: BuzzerTeam[];
  round: BuzzerRound;
}

export interface BuzzerSession {
  role: 'host' | 'player';
  code: string;
  token: string;
  playerId?: string;
}

export type BuzzerReply =
  | { ok: true; room: BuzzerRoom; session?: BuzzerSession }
  | { ok: false; error: string; code?: string };

export type HostEvent =
  | 'round:start' | 'round:reset' | 'round:close' | 'round:judge'
  | 'room:settings' | 'room:end' | 'room:rematch' | 'room:reset-scores'
  | 'host:score' | 'team:create' | 'team:remove' | 'player:moderate';

export type BuzzerConnection = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface BuzzerController {
  serverUrl: string;
  room: BuzzerRoom | null;
  connection: BuzzerConnection;
  generation: number;
  busy: boolean;
  error: string;
  createRoom: (serverUrl: string, name: string, hostName: string) => Promise<boolean>;
  request: (event: HostEvent, payload?: Record<string, unknown>) => Promise<boolean>;
  syncQuestion: (question: { key: string; label: string } | null) => Promise<void>;
  disconnect: () => void;
  clearError: () => void;
}
