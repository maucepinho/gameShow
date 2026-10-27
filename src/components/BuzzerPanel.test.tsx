import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { BuzzerController, BuzzerRoom } from '../buzzer/types';
import { BuzzerPanel } from './BuzzerPanel';
import { BuzzerRound } from './BuzzerRound';

function createController(): BuzzerController {
  const room: BuzzerRoom = {
    code: 'ABCDEF', name: 'Jogo de música', hostName: 'Maurício', revision: 1,
    hostConnected: true, ended: false, teamMode: true, timerSeconds: 30,
    correctPoints: 10, incorrectPoints: -5,
    players: [
      { id: 'ana', name: 'Ana', avatar: '🎵', color: '#00ff00', sound: 'classic', teamId: 'verde', score: 10, connected: true, blocked: false },
      { id: 'bia', name: 'Bia', avatar: '⭐', color: '#ff0000', sound: 'horn', teamId: null, score: 0, connected: false, blocked: false },
    ],
    teams: [{ id: 'verde', name: 'Verde', color: '#00ff00', score: 10 }],
    round: {
      id: 'round-1', questionKey: 'filmes:1', label: 'Filmes · Pergunta 1', status: 'open', startedAt: Date.now(),
      deadlineAt: null, durationSeconds: 0, activePlayerId: 'ana',
      queue: [{ playerId: 'ana', rank: 1, elapsedMs: 1234, outcome: 'pending' }],
    },
  };
  return {
    serverUrl: 'https://buzzer.example', room, connection: 'connected', generation: 1, busy: false, error: '',
    createRoom: jest.fn().mockResolvedValue(true), request: jest.fn().mockResolvedValue(true),
    syncQuestion: jest.fn().mockResolvedValue(undefined), disconnect: jest.fn(), clearError: jest.fn(),
  };
}

function showPanel(buzzer: BuzzerController) {
  render(<BuzzerPanel buzzer={buzzer} pauseOnBuzz onPauseOnBuzzChange={jest.fn()} questionOpen={false} />);
  fireEvent.click(screen.getByText(/Buzzer dos jogadores/));
}

afterEach(() => { jest.restoreAllMocks(); });

test('cria a sala com o servidor e nomes informados', () => {
  const buzzer = createController();
  buzzer.room = null;
  render(<BuzzerPanel buzzer={buzzer} pauseOnBuzz onPauseOnBuzzChange={jest.fn()} questionOpen={false} />);
  fireEvent.change(screen.getByLabelText('Endereço do servidor do buzzer'), { target: { value: 'https://meu-buzzer.example' } });
  fireEvent.change(screen.getByLabelText('Nome da partida'), { target: { value: 'Noite musical' } });
  fireEvent.change(screen.getByLabelText('Apresentador'), { target: { value: 'Maurício' } });
  fireEvent.click(screen.getByRole('button', { name: 'Criar sala' }));
  expect(buzzer.createRoom).toHaveBeenCalledWith('https://meu-buzzer.example', 'Noite musical', 'Maurício');
});

test('convida por link e QR públicos e ajusta pontos do jogador escolhido', () => {
  const buzzer = createController();
  showPanel(buzzer);
  fireEvent.click(screen.getByText('Convidar jogadores · link e QR code'));
  expect(screen.getByLabelText('Link para entrar')).toHaveValue('https://buzzer.example/?room=ABCDEF');
  expect(screen.getByAltText('QR code para entrar na sala ABCDEF')).toHaveAttribute('src', 'https://buzzer.example/api/rooms/ABCDEF/qr.svg');
  fireEvent.click(screen.getByRole('button', { name: 'Dar 1 ponto a Ana' }));
  expect(buzzer.request).toHaveBeenCalledWith('host:score', { playerId: 'ana', delta: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Tirar 1 ponto de Bia' }));
  expect(buzzer.request).toHaveBeenCalledWith('host:score', { playerId: 'bia', delta: -1 });
});

test('gerencia equipe, bloqueio e pontuação personalizada por identidade do jogador', () => {
  const buzzer = createController();
  showPanel(buzzer);
  fireEvent.click(screen.getByText('Gerenciar Bia'));
  const controls = within(screen.getByRole('group', { name: 'Controles de Bia' }));
  fireEvent.change(controls.getByLabelText('Equipe'), { target: { value: 'verde' } });
  expect(buzzer.request).toHaveBeenCalledWith('player:moderate', { playerId: 'bia', teamId: 'verde' });
  fireEvent.click(controls.getByRole('button', { name: 'Bloquear botão' }));
  expect(buzzer.request).toHaveBeenCalledWith('player:moderate', { playerId: 'bia', blocked: true });
  fireEvent.change(controls.getByLabelText('Alterar pontos'), { target: { value: '-20' } });
  fireEvent.click(controls.getByRole('button', { name: 'Aplicar' }));
  expect(buzzer.request).toHaveBeenCalledWith('host:score', { playerId: 'bia', delta: -20 });
});

test('respeita cancelamento antes de zerar pontos ou apagar o acesso do apresentador', () => {
  const buzzer = createController();
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  showPanel(buzzer);
  fireEvent.click(screen.getByText('Controles da partida'));
  fireEvent.click(screen.getByRole('button', { name: 'Zerar placar' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sair da sala e esquecer acesso' }));
  expect(buzzer.request).not.toHaveBeenCalled();
  expect(buzzer.disconnect).not.toHaveBeenCalled();
  expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('acesso de apresentador salvo neste navegador será apagado'));
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Zerar placar' }));
  expect(buzzer.request).toHaveBeenCalledWith('room:reset-scores');
});

test('envia regras de rodada e pontuação como números', () => {
  const buzzer = createController();
  showPanel(buzzer);
  fireEvent.click(screen.getByText('Regras e preferências'));
  fireEvent.change(screen.getByLabelText('Tempo para tocar (segundos)'), { target: { value: '20' } });
  fireEvent.change(screen.getByLabelText('Pontos por erro'), { target: { value: '-2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar regras' }));
  expect(buzzer.request).toHaveBeenCalledWith('room:settings', { name: 'Jogo de música', teamMode: true, timerSeconds: 20, correctPoints: 10, incorrectPoints: -2 });
});

test('exige fechar a pergunta antes de revanche ou de zerar o placar', () => {
  render(<BuzzerPanel buzzer={createController()} pauseOnBuzz onPauseOnBuzzChange={jest.fn()} questionOpen />);
  fireEvent.click(screen.getByText(/Buzzer dos jogadores/));
  fireEvent.click(screen.getByText('Controles da partida'));
  expect(screen.getByRole('button', { name: 'Revanche' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Zerar placar' })).toBeDisabled();
  expect(screen.getByText('Feche a pergunta para iniciar uma revanche ou zerar o placar.')).toBeInTheDocument();
});

test('julga o jogador ativo mesmo depois de fechar o tempo de novos toques', () => {
  const buzzer = createController();
  buzzer.room!.round.status = 'closed';
  render(<BuzzerRound buzzer={buzzer} />);
  expect(screen.getByText('1,23 s')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Acertou (+10 pts)' }));
  expect(buzzer.request).toHaveBeenCalledWith('round:judge', { roundId: 'round-1', playerId: 'ana', correct: true });
});

test('rearmar envia identificador da rodada e chave única de operação', () => {
  const buzzer = createController();
  render(<BuzzerRound buzzer={buzzer} />);
  fireEvent.click(screen.getByRole('button', { name: 'Rearmar botões' }));
  expect(buzzer.request).toHaveBeenCalledWith('round:reset', { roundId: 'round-1', requestId: expect.any(String) });
});

test.each(['reconnecting', 'disconnected'] as const)('bloqueia controles da rodada enquanto %s', (connection) => {
  const buzzer = createController();
  buzzer.connection = connection;
  render(<BuzzerRound buzzer={buzzer} />);
  screen.getAllByRole('button').forEach((button) => expect(button).toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'Acertou (+10 pts)' }));
  expect(buzzer.request).not.toHaveBeenCalled();
});
