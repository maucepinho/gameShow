import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BuzzerController, BuzzerRoom } from '../buzzer/types';
import { BuzzerPanel } from './BuzzerPanel';

const localServer = 'http://localhost:3001';
const wifi = 'http://192.168.0.20:3001';
const ethernet = 'http://192.168.0.30:3001';
const originalFetch = Object.getOwnPropertyDescriptor(global, 'fetch');
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
let fetchMock: jest.Mock;
let writeText: jest.Mock;

function controller(serverUrl = localServer): BuzzerController {
  const room: BuzzerRoom = {
    code: 'ABCDEF', name: 'Jogo musical', hostName: 'Apresentador', revision: 1,
    hostConnected: true, ended: false, teamMode: false, timerSeconds: 0,
    correctPoints: 1, incorrectPoints: 0, players: [], teams: [],
    round: { id: null, questionKey: '', label: '', status: 'waiting', startedAt: null,
      deadlineAt: null, durationSeconds: 0, activePlayerId: null, queue: [] },
  };
  return {
    serverUrl, room, connection: 'connected', generation: 1, busy: false, error: '',
    createRoom: jest.fn().mockResolvedValue(true), request: jest.fn().mockResolvedValue(true),
    syncQuestion: jest.fn().mockResolvedValue(undefined), disconnect: jest.fn(), clearError: jest.fn(),
  };
}

function response(participantBaseUrl = wifi, localUrls = [
  { name: 'Wi-Fi', url: wifi }, { name: 'Ethernet', url: ethernet },
]): Response {
  return { ok: true, json: async () => ({ participantBaseUrl, localUrls }) } as Response;
}

function invite(buzzer = controller()) {
  render(<BuzzerPanel buzzer={buzzer} pauseOnBuzz onPauseOnBuzzChange={jest.fn()} questionOpen={false} />);
  fireEvent.click(screen.getByText(/Buzzer dos jogadores/));
  fireEvent.click(screen.getByText('Convidar jogadores · link e QR code'));
}

beforeEach(() => {
  fetchMock = jest.fn();
  writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: fetchMock });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(() => {
  if (originalFetch) Object.defineProperty(global, 'fetch', originalFetch);
  else Reflect.deleteProperty(global, 'fetch');
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
  jest.restoreAllMocks();
});

test('descobre o Wi-Fi e compartilha o mesmo endereço no link, QR e área de transferência', async () => {
  fetchMock.mockResolvedValue(response());
  invite();
  const joinLink = `${wifi}/?room=ABCDEF`;
  expect(await screen.findByDisplayValue(joinLink)).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith(`${localServer}/api/connection-info`, expect.objectContaining({ signal: expect.anything() }));
  expect(screen.getByAltText('QR code para entrar na sala ABCDEF')).toHaveAttribute('src',
    `${localServer}/api/rooms/ABCDEF/qr.svg?base=${encodeURIComponent(wifi)}`);
  expect(screen.getByRole('link', { name: /Abrir tela do jogador/ })).toHaveAttribute('href', joinLink);
  fireEvent.click(screen.getByRole('button', { name: 'Copiar link' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(joinLink));
  expect(await screen.findByText('Link copiado! Envie aos jogadores.')).toBeInTheDocument();
});

test('selecionar outra interface atualiza o link e o QR juntos', async () => {
  fetchMock.mockResolvedValue(response());
  invite();
  await screen.findByDisplayValue(`${wifi}/?room=ABCDEF`);
  fireEvent.change(screen.getByLabelText('Endereço para os celulares'), { target: { value: ethernet } });
  expect(screen.getByLabelText('Link para entrar')).toHaveValue(`${ethernet}/?room=ABCDEF`);
  expect(screen.getByAltText('QR code para entrar na sala ABCDEF')).toHaveAttribute('src',
    `${localServer}/api/rooms/ABCDEF/qr.svg?base=${encodeURIComponent(ethernet)}`);
  fireEvent.click(screen.getByRole('button', { name: 'Copiar link' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${ethernet}/?room=ABCDEF`));
});

test('nunca disponibiliza localhost enquanto detecta a rede ou quando não encontra interface', async () => {
  let resolveFetch!: (value: Response) => void;
  fetchMock.mockReturnValue(new Promise<Response>((resolve) => { resolveFetch = resolve; }));
  invite();
  expect(screen.getByText('Preparando o link da rede local…')).toBeInTheDocument();
  expect(screen.getByLabelText('Link para entrar')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Copiar link' })).toBeDisabled();
  expect(screen.queryByAltText('QR code para entrar na sala ABCDEF')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Abrir tela do jogador/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Copiar link' }));
  expect(writeText).not.toHaveBeenCalled();

  await act(async () => { resolveFetch(response(localServer, [])); });
  expect(await screen.findByText(/Nenhuma conexão de rede foi encontrada/)).toBeInTheDocument();
  expect(screen.getByLabelText('Link para entrar')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Copiar link' })).toBeDisabled();
  expect(screen.queryByAltText('QR code para entrar na sala ABCDEF')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Copiar link' }));
  expect(writeText).not.toHaveBeenCalled();
});

test.each(['rede indisponível', 'HTTP sem suporte'] as const)('falha de detecção (%s) mostra orientação sem publicar localhost', async (failure) => {
  if (failure === 'rede indisponível') fetchMock.mockRejectedValue(new Error('Offline'));
  else fetchMock.mockResolvedValue({ ok: false });
  invite();
  expect(await screen.findByText(/Não foi possível detectar o endereço da rede/)).toBeInTheDocument();
  expect(screen.getByLabelText('Link para entrar')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Copiar link' })).toBeDisabled();
  expect(screen.queryByAltText('QR code para entrar na sala ABCDEF')).not.toBeInTheDocument();
  expect(writeText).not.toHaveBeenCalled();
});

test('modo internet preserva o link original e não solicita descoberta de interfaces', () => {
  const publicServer = 'https://buzzer.example.com';
  invite(controller(publicServer));
  expect(screen.getByLabelText('Link para entrar')).toHaveValue(`${publicServer}/?room=ABCDEF`);
  expect(screen.getByAltText('QR code para entrar na sala ABCDEF')).toHaveAttribute('src',
    `${publicServer}/api/rooms/ABCDEF/qr.svg`);
  expect(screen.getByRole('button', { name: 'Copiar link' })).toBeEnabled();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('usar servidor deste notebook reconfigura o formulário para criar a próxima sala local', () => {
  const buzzer = controller('https://buzzer.example.com');
  buzzer.room = null;
  render(<BuzzerPanel buzzer={buzzer} pauseOnBuzz onPauseOnBuzzChange={jest.fn()} questionOpen={false} />);
  expect(screen.getByLabelText('Endereço do servidor do buzzer')).toHaveValue('https://buzzer.example.com');
  fireEvent.click(screen.getByRole('button', { name: 'Usar servidor deste notebook' }));
  expect(screen.getByLabelText('Endereço do servidor do buzzer')).toHaveValue(localServer);
  fireEvent.click(screen.getByRole('button', { name: 'Criar sala' }));
  expect(buzzer.createRoom).toHaveBeenCalledWith(localServer, 'GameShow', 'Apresentador');
  expect(fetchMock).not.toHaveBeenCalled();
});
