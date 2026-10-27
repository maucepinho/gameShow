import React, { useEffect, useRef, useState } from 'react';
import { BuzzerController, BuzzerPlayer, BuzzerRoom } from '../buzzer/types';
import './BuzzerPanel.css';

interface Props {
  buzzer: BuzzerController;
  pauseOnBuzz: boolean;
  onPauseOnBuzzChange: (value: boolean) => void;
  questionOpen: boolean;
}

const connectionLabels = {
  connected: 'Conectado',
  connecting: 'Conectando…',
  reconnecting: 'Reconectando…',
  disconnected: 'Desconectado',
};

function loopbackAddress(value: string): boolean {
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname); }
  catch { return false; }
}

function baseAddress(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Endereço inválido.');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Endereço inválido.');
  }
  return url.origin;
}

interface LocalConnection {
  server: string;
  code: string;
  loading: boolean;
  baseUrl: string;
  choices: Array<{ name: string; url: string }>;
  error: string;
}

function PlayerRow({ player, room, buzzer }: {
  player: BuzzerPlayer;
  room: BuzzerRoom;
  buzzer: BuzzerController;
}) {
  const [delta, setDelta] = useState('5');
  const disabled = buzzer.connection !== 'connected' || buzzer.busy || room.ended;
  const team = room.teams.find((item) => item.id === player.teamId);

  const adjustScore = (amount: number) => {
    void buzzer.request('host:score', { playerId: player.id, delta: amount });
  };

  return (
    <li className={`bzr-player${player.blocked ? ' bzr-player-blocked' : ''}`}>
      <div className="bzr-player-main">
        <span className="bzr-avatar" style={{ borderColor: player.color }} aria-hidden="true">{player.avatar}</span>
        <div className="bzr-player-name">
          <strong>{player.name}</strong>
          <span>{player.connected ? 'Online' : 'Offline'}{player.blocked ? ' · Bloqueado' : ''}{team ? ` · ${team.name}` : ''}</span>
        </div>
        <strong className="bzr-score" aria-label={`${player.score} pontos`}>{player.score}</strong>
        <div className="bzr-score-buttons">
          <button type="button" disabled={disabled} onClick={() => adjustScore(-1)} aria-label={`Tirar 1 ponto de ${player.name}`}>−1</button>
          <button type="button" disabled={disabled} onClick={() => adjustScore(1)} aria-label={`Dar 1 ponto a ${player.name}`}>+1</button>
        </div>
      </div>
      <details className="bzr-player-manage" aria-label={`Controles de ${player.name}`}>
        <summary>Gerenciar {player.name}</summary>
        <form className="bzr-inline-form" onSubmit={(event) => {
          event.preventDefault();
          const amount = Number(delta);
          if (Number.isInteger(amount) && amount !== 0 && Math.abs(amount) <= 1000000) adjustScore(amount);
        }}>
          <label>Alterar pontos
            <input type="number" value={delta} onChange={(event) => setDelta(event.target.value)} min="-1000000" max="1000000" step="1" required disabled={disabled} />
          </label>
          <button type="submit" disabled={disabled || !delta || Number(delta) === 0}>Aplicar</button>
        </form>
        <p className="bzr-help">Use um valor negativo para descontar pontos.</p>
        <label className="bzr-team-select">Equipe
          <select value={player.teamId || ''} disabled={disabled} onChange={(event) => {
            void buzzer.request('player:moderate', { playerId: player.id, teamId: event.target.value || null });
          }}>
            <option value="">Sem equipe</option>
            {room.teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <div className="bzr-actions">
          <button type="button" disabled={disabled} onClick={() => {
            void buzzer.request('player:moderate', { playerId: player.id, blocked: !player.blocked });
          }}>{player.blocked ? 'Desbloquear botão' : 'Bloquear botão'}</button>
          <button type="button" className="bzr-danger" disabled={disabled} onClick={() => {
            if (window.confirm(`Remover ${player.name}? Os pontos desse jogador serão removidos e ele precisará entrar novamente.`)) {
              void buzzer.request('player:moderate', { playerId: player.id, remove: true });
            }
          }}>Remover jogador</button>
        </div>
      </details>
    </li>
  );
}

export function BuzzerPanel({ buzzer, pauseOnBuzz, onPauseOnBuzzChange, questionOpen }: Props) {
  const [serverUrl, setServerUrl] = useState(buzzer.serverUrl);
  const [name, setName] = useState('GameShow');
  const [hostName, setHostName] = useState('Apresentador');
  const [teamName, setTeamName] = useState('');
  const [teamColor, setTeamColor] = useState('#1db954');
  const [roomName, setRoomName] = useState('');
  const [teamMode, setTeamMode] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState('0');
  const [correctPoints, setCorrectPoints] = useState('1');
  const [incorrectPoints, setIncorrectPoints] = useState('0');
  const [copyStatus, setCopyStatus] = useState('');
  const [localConnection, setLocalConnection] = useState<LocalConnection | null>(null);
  const [expanded, setExpanded] = useState(!buzzer.room);
  const linkRef = useRef<HTMLInputElement>(null);
  const room = buzzer.room;
  const online = buzzer.connection === 'connected';
  const disabled = !online || buzzer.busy || Boolean(room?.ended);

  useEffect(() => { setServerUrl(buzzer.serverUrl); }, [buzzer.serverUrl]);
  useEffect(() => {
    if (room) {
      setRoomName(room.name);
      setTeamMode(room.teamMode);
      setTimerSeconds(String(room.timerSeconds));
      setCorrectPoints(String(room.correctPoints));
      setIncorrectPoints(String(room.incorrectPoints));
    }
  }, [room?.code, room?.name, room?.teamMode, room?.timerSeconds, room?.correctPoints, room?.incorrectPoints]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setCopyStatus(''); }, [room?.code, buzzer.serverUrl]);

  useEffect(() => {
    if (!room?.code || !loopbackAddress(buzzer.serverUrl)) {
      setLocalConnection(null);
      return;
    }
    const server = buzzer.serverUrl.replace(/\/+$/, '');
    const code = room.code;
    let disposed = false;
    const abort = new AbortController();
    const initial: LocalConnection = { server, code, loading: true, baseUrl: '', choices: [], error: '' };
    setLocalConnection(initial);
    const discover = async () => {
      try {
        const response = await fetch(`${server}/api/connection-info`, { signal: abort.signal });
        if (!response.ok) throw new Error('Servidor sem informações de rede.');
        const info = await response.json();
        const baseUrl = baseAddress(info.participantBaseUrl);
        if (!Array.isArray(info.localUrls)) throw new Error('Resposta inválida.');
        const choices = info.localUrls.map((entry: { name?: unknown; url?: unknown }) => ({
          name: typeof entry.name === 'string' ? entry.name : 'Rede local', url: baseAddress(entry.url),
        }));
        if (!choices.some((entry: { url: string }) => entry.url === baseUrl)) choices.unshift({ name: 'Endereço configurado', url: baseUrl });
        if (!disposed) setLocalConnection({ ...initial, loading: false, baseUrl, choices });
      } catch {
        if (!disposed) setLocalConnection({ ...initial, loading: false, error: 'Não foi possível detectar o endereço da rede. Reinicie npm run dev e confira a conexão Wi-Fi do notebook.' });
      }
    };
    void discover();
    return () => { disposed = true; abort.abort(); };
  }, [room?.code, buzzer.serverUrl]);

  const needsLocalAddress = loopbackAddress(buzzer.serverUrl);
  const currentLocal = localConnection?.code === room?.code && localConnection?.server === buzzer.serverUrl.replace(/\/+$/, '') ? localConnection : null;
  const participantBase = needsLocalAddress ? currentLocal?.baseUrl || '' : buzzer.serverUrl.replace(/\/+$/, '');
  const inviteReady = Boolean(room && participantBase && !loopbackAddress(participantBase));
  const joinLink = room && inviteReady ? `${participantBase}/?room=${encodeURIComponent(room.code)}` : '';
  const qrLink = room ? `${buzzer.serverUrl.replace(/\/+$/, '')}/api/rooms/${encodeURIComponent(room.code)}/qr.svg${participantBase && participantBase !== buzzer.serverUrl.replace(/\/+$/, '') ? `?base=${encodeURIComponent(participantBase)}` : ''}` : '';
  const sortedPlayers = room ? [...room.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'pt-BR')) : [];
  const onlinePlayers = room?.players.filter((player) => player.connected).length || 0;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(joinLink);
      setCopyStatus('Link copiado! Envie aos jogadores.');
    } catch {
      linkRef.current?.focus();
      linkRef.current?.select();
      setCopyStatus('O navegador não permitiu copiar. O link está selecionado: copie e envie aos jogadores.');
    }
  };

  return (
    <section className="buzzer-panel" aria-label="Central do buzzer">
      <details className="bzr-shell" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary className="bzr-header">
          <span><span aria-hidden="true">⚡</span> Buzzer dos jogadores</span>
          <span className={`bzr-connection bzr-connection-${buzzer.connection}`}>{connectionLabels[buzzer.connection]}{room ? ` · ${room.code}` : ''}</span>
        </summary>
        <div className="bzr-content">
          {buzzer.error && <div className="bzr-error" role="alert"><span>{buzzer.error}</span><button type="button" onClick={buzzer.clearError} aria-label="Fechar aviso do buzzer">×</button></div>}

          {!room ? (
            <form className="bzr-create" onSubmit={(event) => {
              event.preventDefault();
              void buzzer.createRoom(serverUrl.trim(), name.trim(), hostName.trim());
            }}>
              <p className="bzr-help">Conecte os celulares e o notebook à mesma rede Wi-Fi. O notebook será o servidor da partida. Ao abrir um número do tabuleiro, os botões são liberados automaticamente.</p>
              <label>Endereço do servidor do buzzer
                <input type="url" value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="http://localhost:3001" required disabled={buzzer.busy} autoComplete="url" />
              </label>
              <button type="button" disabled={buzzer.busy} onClick={() => setServerUrl('http://localhost:3001')}>Usar servidor deste notebook</button>
              <div className="bzr-form-grid">
                <label>Nome da partida<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required disabled={buzzer.busy} /></label>
                <label>Apresentador<input value={hostName} onChange={(event) => setHostName(event.target.value)} maxLength={40} required disabled={buzzer.busy} autoComplete="nickname" /></label>
              </div>
              <button className="bzr-primary" type="submit" disabled={buzzer.busy || !name.trim() || !hostName.trim()}>{buzzer.busy ? 'Criando sala…' : 'Criar sala'}</button>
            </form>
          ) : (
            <>
              <div className="bzr-room-summary">
                <div><h2>{room.name}</h2><p>{room.hostName} · {onlinePlayers} de {room.players.length} jogadores online</p></div>
                <div className="bzr-code"><span>Código da sala</span><strong>{room.code}</strong></div>
              </div>
              {!online && <p className="bzr-notice" role="status">{buzzer.connection === 'reconnecting' || buzzer.connection === 'connecting' ? 'Reconectando à sala. Os botões ficam fechados durante a desconexão.' : 'Sem conexão com a sala. Verifique a internet e o servidor.'} A fila e os pontos são preservados. Ao voltar, confira a rodada antes de rearmar.</p>}
              {room.ended && <p className="bzr-notice" role="status">Partida encerrada. Confira o placar abaixo ou inicie uma revanche com os mesmos jogadores.</p>}
              <details className="bzr-section">
                <summary>Convidar jogadores · link e QR code</summary>
                <div className="bzr-invite">
                  <div className="bzr-invite-link">
                    {needsLocalAddress && currentLocal && currentLocal.choices.length > 1 && <label>Endereço para os celulares
                      <select value={participantBase} onChange={(event) => {
                        const baseUrl = event.target.value;
                        setLocalConnection((previous) => previous ? { ...previous, baseUrl } : previous);
                        setCopyStatus('');
                      }}>
                        {currentLocal.choices.map((entry) => <option key={entry.url} value={entry.url}>{entry.name} · {entry.url}</option>)}
                      </select>
                    </label>}
                    <label>Link para entrar<input ref={linkRef} value={joinLink} readOnly onFocus={(event) => event.target.select()} /></label>
                    <div className="bzr-actions"><button type="button" disabled={!inviteReady} onClick={() => { void copyLink(); }}>Copiar link</button>{inviteReady && <a href={joinLink} target="_blank" rel="noreferrer">Abrir tela do jogador ↗</a>}</div>
                    {needsLocalAddress && !currentLocal?.error && !inviteReady && <p className="bzr-notice" role="status">{!currentLocal || currentLocal.loading ? 'Preparando o link da rede local…' : 'Nenhuma conexão de rede foi encontrada. Conecte o notebook ao Wi-Fi e crie uma nova sala.'}</p>}
                    {needsLocalAddress && currentLocal?.error && <p className="bzr-notice" role="status">{currentLocal.error}</p>}
                    <p className="bzr-help">No modo local, os celulares precisam estar no mesmo Wi-Fi do notebook. Compartilhe este link ou QR; localhost funciona somente no próprio notebook.</p>
                    <p className="bzr-copy-status" role="status">{copyStatus}</p>
                  </div>
                  {inviteReady && <img className="bzr-qr" src={qrLink} width="160" height="160" alt={`QR code para entrar na sala ${room.code}`} loading="lazy" />}
                </div>
              </details>

              <details className="bzr-section" open>
                <summary>Placar e jogadores ({room.players.length})</summary>
                {room.teamMode && room.teams.length > 0 && <ol className="bzr-team-scores" aria-label="Placar por equipe">{[...room.teams].sort((a, b) => b.score - a.score).map((team) => (
                  <li key={team.id}><span className="bzr-color-dot" style={{ background: team.color }} aria-hidden="true" /><strong>{team.name}</strong><span>{team.score} pts</span></li>
                ))}</ol>}
                {room.players.length === 0 ? <p className="bzr-help">Aguardando jogadores. Compartilhe o link ou o QR code da sala.</p> : <ol className="bzr-player-list" aria-label="Placar individual">{sortedPlayers.map((player) => <PlayerRow key={player.id} player={player} room={room} buzzer={buzzer} />)}</ol>}
              </details>

              <details className="bzr-section">
                <summary>Equipes ({room.teams.length})</summary>
                <p className="bzr-help">O placar de cada equipe soma os pontos dos integrantes. Atribua a equipe em “Gerenciar” no jogador.</p>
                {room.teams.length > 0 && <ul className="bzr-team-list">{room.teams.map((team) => <li key={team.id}><span className="bzr-color-dot" style={{ background: team.color }} aria-hidden="true" /><span>{team.name} · {room.players.filter((player) => player.teamId === team.id).length} jogadores</span><button type="button" disabled={disabled} className="bzr-danger" aria-label={`Remover equipe ${team.name}`} onClick={() => {
                  if (window.confirm(`Remover a equipe ${team.name}? Os jogadores e seus pontos individuais serão mantidos.`)) void buzzer.request('team:remove', { teamId: team.id });
                }}>Remover</button></li>)}</ul>}
                <form className="bzr-inline-form" onSubmit={async (event) => {
                  event.preventDefault();
                  if (await buzzer.request('team:create', { name: teamName.trim(), color: teamColor })) setTeamName('');
                }}>
                  <label>Nova equipe<input value={teamName} onChange={(event) => setTeamName(event.target.value)} maxLength={32} required disabled={disabled} placeholder="Nome da equipe" /></label>
                  <label className="bzr-color-field">Cor<input type="color" value={teamColor} onChange={(event) => setTeamColor(event.target.value)} disabled={disabled} /></label>
                  <button type="submit" disabled={disabled || !teamName.trim()}>Criar equipe</button>
                </form>
              </details>

              <details className="bzr-section">
                <summary>Regras e preferências</summary>
                <label className="bzr-checkbox"><input type="checkbox" checked={pauseOnBuzz} onChange={(event) => onPauseOnBuzzChange(event.target.checked)} />Pausar a música no primeiro toque</label>
                <p className="bzr-help">{questionOpen ? 'A pergunta está aberta. Use os controles ao lado da carta para julgar respostas ou rearmar os botões.' : 'Ao abrir uma pergunta, uma nova rodada começa. Ao fechá-la, os botões são fechados.'}</p>
                <form className="bzr-settings" onSubmit={(event) => {
                  event.preventDefault();
                  void buzzer.request('room:settings', { name: roomName.trim(), teamMode, timerSeconds: Number(timerSeconds), correctPoints: Number(correctPoints), incorrectPoints: Number(incorrectPoints) });
                }}>
                  <label>Nome da partida<input value={roomName} onChange={(event) => setRoomName(event.target.value)} maxLength={80} required disabled={disabled} /></label>
                  <label className="bzr-checkbox"><input type="checkbox" checked={teamMode} onChange={(event) => setTeamMode(event.target.checked)} disabled={disabled} />Mostrar placar por equipes</label>
                  <div className="bzr-form-grid bzr-settings-numbers">
                    <label>Tempo para tocar (segundos)<input type="number" min="0" max="600" step="1" required value={timerSeconds} onChange={(event) => setTimerSeconds(event.target.value)} disabled={disabled} /></label>
                    <label>Pontos por acerto<input type="number" min="-100000" max="100000" step="1" required value={correctPoints} onChange={(event) => setCorrectPoints(event.target.value)} disabled={disabled} /></label>
                    <label>Pontos por erro<input type="number" min="-100000" max="100000" step="1" required value={incorrectPoints} onChange={(event) => setIncorrectPoints(event.target.value)} disabled={disabled} /></label>
                  </div>
                  <p className="bzr-help">Tempo 0 significa sem limite. Para penalizar um erro, use pontos negativos. As regras valem na próxima rodada ou ao rearmar.</p>
                  <button type="submit" disabled={disabled || !roomName.trim()}>Salvar regras</button>
                </form>
              </details>

              <details className="bzr-section">
                <summary>Controles da partida</summary>
                <div className="bzr-actions">
                  <button type="button" disabled={disabled} onClick={() => {
                    if (window.confirm('Encerrar a partida e fechar os botões? O placar final ficará disponível para os jogadores.')) void buzzer.request('room:end');
                  }}>Encerrar partida</button>
                  <button type="button" disabled={!online || buzzer.busy || questionOpen} onClick={() => {
                    if (window.confirm('Iniciar uma revanche? Todos os pontos serão zerados; sala, jogadores e equipes serão mantidos.')) void buzzer.request('room:rematch');
                  }}>Revanche</button>
                  <button type="button" className="bzr-danger" disabled={disabled || questionOpen} onClick={() => {
                    if (window.confirm('Zerar todos os pontos e fechar a rodada atual? Essa alteração não pode ser desfeita.')) void buzzer.request('room:reset-scores');
                  }}>Zerar placar</button>
                </div>
                {questionOpen && <p className="bzr-help">Feche a pergunta para iniciar uma revanche ou zerar o placar.</p>}
                <p className="bzr-help">Mantenha esta aba aberta durante a partida. A ordem dos toques é definida pelo servidor; a conexão de cada jogador pode influenciar o tempo de chegada.</p>
                <button type="button" className="bzr-danger bzr-disconnect" disabled={buzzer.busy} onClick={() => {
                  if (window.confirm('Sair desta sala? O acesso de apresentador salvo neste navegador será apagado e você não poderá controlar esta sala novamente. Os jogadores perderão o apresentador.')) buzzer.disconnect();
                }}>Sair da sala e esquecer acesso</button>
              </details>
            </>
          )}
        </div>
      </details>
    </section>
  );
}
