import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { BuzzerController } from './buzzer/types';
import { enableBuzzerAudio, playBuzzerSound } from './buzzer/sounds';
import App from './App';

let mockBuzzer: BuzzerController;
jest.mock('./buzzer/useBuzzer', () => ({ useBuzzer: () => mockBuzzer }));
jest.mock('./buzzer/sounds', () => ({ enableBuzzerAudio: jest.fn(), playBuzzerSound: jest.fn() }));
jest.mock('./data/questions', () => ({
  questionsByCategory: {
    filmes: [
      { id: 1, audioSrc: '/filme1.mp3', posterSrc: '/filme1.jpg', title: 'Resposta secreta do filme 1' },
      { id: 2, audioSrc: '/filme2.mp3', posterSrc: '/filme2.jpg', title: 'Resposta secreta do filme 2' },
    ],
    desenhos: [{ id: 1, audioSrc: '/desenho1.mp3', posterSrc: '/desenho1.jpg', title: 'Resposta secreta do desenho' }],
    novelas: [], seriados: [],
  },
}));

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  mockBuzzer = {
    serverUrl: 'https://buzzer.example', connection: 'connected', generation: 1, busy: false, error: '',
    room: {
      code: 'ABCDEF', name: 'GameShow', hostName: 'Maurício', revision: 1,
      hostConnected: true, ended: false, teamMode: false, timerSeconds: 0, correctPoints: 1, incorrectPoints: 0,
      players: [
        { id: 'ana', name: 'Ana', avatar: '🎵', color: '#1db954', sound: 'classic', teamId: null, score: 0, connected: true, blocked: false },
        { id: 'bia', name: 'Bia', avatar: '⭐', color: '#ffd166', sound: 'horn', teamId: null, score: 0, connected: true, blocked: false },
      ],
      teams: [], round: { id: null, questionKey: '', label: '', status: 'waiting', startedAt: null, deadlineAt: null, durationSeconds: 0, activePlayerId: null, queue: [] },
    },
    createRoom: jest.fn().mockResolvedValue(true), request: jest.fn().mockResolvedValue(true),
    syncQuestion: jest.fn().mockResolvedValue(undefined), disconnect: jest.fn(), clearError: jest.fn(),
  };
});

afterEach(() => { jest.restoreAllMocks(); });

function openMovieQuestion(id = 1) {
  fireEvent.click(screen.getByRole('button', { name: /^Filmes / }));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Pergunta ${id}`) }));
}

function receiveFirstPress() {
  mockBuzzer = {
    ...mockBuzzer,
    room: {
      ...mockBuzzer.room!,
      round: {
        ...mockBuzzer.room!.round, id: 'round-1', questionKey: 'filmes:1', label: 'Filmes · Pergunta 1',
        status: 'open', activePlayerId: 'ana', queue: [{ playerId: 'ana', rank: 1, elapsedMs: 300, outcome: 'pending' }],
      },
    },
  };
}

test('abrir cada número sincroniza a pergunta sem divulgar o título da resposta e fechar sincroniza null', () => {
  render(<App />);
  openMovieQuestion();
  expect(mockBuzzer.syncQuestion).toHaveBeenLastCalledWith({ key: 'filmes:1', label: 'Filmes · Pergunta 1' });
  expect(JSON.stringify((mockBuzzer.syncQuestion as jest.Mock).mock.calls)).not.toContain('Resposta secreta');
  fireEvent.click(screen.getByRole('button', { name: 'Fechar pergunta' }));
  expect(mockBuzzer.syncQuestion).toHaveBeenLastCalledWith(null);
  fireEvent.click(screen.getByRole('button', { name: 'Pergunta 2' }));
  expect(mockBuzzer.syncQuestion).toHaveBeenLastCalledWith({ key: 'filmes:2', label: 'Filmes · Pergunta 2' });
  expect(enableBuzzerAudio).toHaveBeenCalledTimes(2);
});

test('IDs repetidos em categorias diferentes geram rodadas diferentes', () => {
  render(<App />);
  openMovieQuestion();
  fireEvent.click(screen.getByRole('button', { name: 'Fechar pergunta' }));
  fireEvent.click(screen.getByRole('button', { name: 'Trocar categoria' }));
  fireEvent.click(screen.getByRole('button', { name: /^Desenhos / }));
  fireEvent.click(screen.getByRole('button', { name: 'Pergunta 1' }));
  expect(mockBuzzer.syncQuestion).toHaveBeenLastCalledWith({ key: 'desenhos:1', label: 'Desenhos · Pergunta 1' });
});

test('uma nova conexão ressincroniza a pergunta aberta preservando a rodada e mudanças normais do placar não repetem a sincronização', () => {
  const { rerender } = render(<App />);
  openMovieQuestion();
  const count = (mockBuzzer.syncQuestion as jest.Mock).mock.calls.length;
  mockBuzzer = { ...mockBuzzer, room: { ...mockBuzzer.room!, revision: 2 } };
  rerender(<App />);
  expect(mockBuzzer.syncQuestion).toHaveBeenCalledTimes(count);
  mockBuzzer = { ...mockBuzzer, connection: 'reconnecting' };
  rerender(<App />);
  expect(mockBuzzer.syncQuestion).toHaveBeenCalledTimes(count + 1);
  expect(mockBuzzer.syncQuestion).toHaveBeenLastCalledWith({ key: 'filmes:1', label: 'Filmes · Pergunta 1' });
  mockBuzzer = { ...mockBuzzer, connection: 'connected', generation: 2 };
  rerender(<App />);
  expect(mockBuzzer.syncQuestion).toHaveBeenCalledTimes(count + 2);
  expect(mockBuzzer.syncQuestion).toHaveBeenLastCalledWith({ key: 'filmes:1', label: 'Filmes · Pergunta 1' });
});

test('o primeiro toque pausa a música e toca o som escolhido sem repetir em novos toques da mesma rodada', () => {
  const { rerender } = render(<App />);
  openMovieQuestion();
  fireEvent.click(screen.getByRole('button', { name: 'Tocar áudio' }));
  expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
  receiveFirstPress();
  rerender(<App />);
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
  expect(playBuzzerSound).toHaveBeenCalledWith('classic');
  expect(screen.getByRole('button', { name: 'Tocar áudio' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tocar áudio' }));
  mockBuzzer = { ...mockBuzzer, room: { ...mockBuzzer.room!, round: { ...mockBuzzer.room!.round, queue: [...mockBuzzer.room!.round.queue, { playerId: 'bia', rank: 2, elapsedMs: 500, outcome: 'pending' }] } } };
  rerender(<App />);
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
  expect(playBuzzerSound).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Pausar áudio' })).toBeInTheDocument();
});

test('a preferência de pausar música pode ser desligada e fica salva neste navegador', () => {
  const { rerender } = render(<App />);
  fireEvent.click(screen.getByText(/Buzzer dos jogadores/));
  fireEvent.click(screen.getByText('Regras e preferências'));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Pausar a música no primeiro toque' }));
  expect(localStorage.getItem('gameshow:buzzer:pause-audio')).toBe('false');
  openMovieQuestion();
  fireEvent.click(screen.getByRole('button', { name: 'Tocar áudio' }));
  receiveFirstPress();
  rerender(<App />);
  expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Pausar áudio' })).toBeInTheDocument();
  expect(playBuzzerSound).toHaveBeenCalledTimes(1);
});

test('o jogo continua com áudio e revelação quando não há sala do buzzer', () => {
  mockBuzzer.room = null;
  mockBuzzer.connection = 'disconnected';
  render(<App />);
  openMovieQuestion();
  expect(screen.queryByRole('complementary', { name: 'Buzzer desta pergunta' })).not.toBeInTheDocument();
  expect(mockBuzzer.syncQuestion).toHaveBeenLastCalledWith({ key: 'filmes:1', label: 'Filmes · Pergunta 1' });
  fireEvent.click(screen.getByRole('button', { name: 'Tocar áudio' }));
  fireEvent.click(screen.getByRole('button', { name: 'Revelar resposta' }));
  expect(screen.getByRole('img', { name: 'Resposta secreta do filme 1' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Fechar pergunta' }));
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Pergunta 1, já aberta' })).toHaveClass('answered');
});
