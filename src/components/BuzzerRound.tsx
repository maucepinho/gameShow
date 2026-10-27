import React, { useEffect, useState } from 'react';
import { BuzzerController } from '../buzzer/types';
import './BuzzerRound.css';

interface Props { buzzer: BuzzerController; }

function elapsedLabel(elapsedMs: number) {
  return `${(elapsedMs / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s`;
}

export function BuzzerRound({ buzzer }: Props) {
  const [now, setNow] = useState(Date.now());
  const room = buzzer.room;
  const round = room?.round;
  const online = buzzer.connection === 'connected';
  const activePlayer = room?.players.find((player) => player.id === round?.activePlayerId);
  const disabled = !online || buzzer.busy || !round?.id || Boolean(room?.ended);

  useEffect(() => {
    setNow(Date.now());
    if (!round?.deadlineAt || round.status !== 'open') return;
    const interval = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(interval);
  }, [round?.id, round?.deadlineAt, round?.status]);

  if (!room || !round) return null;

  const remaining = round.deadlineAt ? Math.max(0, Math.ceil((round.deadlineAt - now) / 1000)) : null;
  const canJudge = !disabled && Boolean(activePlayer) && round.queue.some((press) => press.playerId === activePlayer?.id && press.outcome === 'pending');
  const signedPoints = (points: number) => `${points > 0 ? '+' : ''}${points}`;
  const status = room.ended ? 'Partida encerrada' : !online ? (buzzer.connection === 'reconnecting' || buzzer.connection === 'connecting' ? 'Reconectando…' : 'Buzzer desconectado') : round.status === 'open' ? 'Botões liberados' : round.status === 'closed' ? 'Botões fechados' : 'Preparando rodada';

  return (
    <aside className="buzzer-round" aria-label="Buzzer desta pergunta">
      <div className="buzzer-round-heading"><h2><span aria-hidden="true">⚡</span> Buzzer</h2><span className="buzzer-round-code">{room.code}</span></div>
      <div className={`buzzer-round-status${online && round.status === 'open' && !room.ended ? ' buzzer-round-status-open' : ''}`} role="status">{status}</div>
      <p className="buzzer-round-label">{round.label || 'Aguarde a abertura da pergunta.'}</p>
      {round.deadlineAt && round.status === 'open' && <div className={`buzzer-round-timer${remaining !== null && remaining <= 5 ? ' buzzer-round-timer-ending' : ''}`} role="timer" aria-label="Tempo restante para tocar">{remaining}s <span>para tocar</span></div>}
      {!online && <p className="buzzer-round-note">Os controles voltam quando a conexão for restabelecida. A fila e os pontos são preservados; confira a rodada antes de rearmar.</p>}
      {buzzer.error && <p className="buzzer-round-error" role="alert">{buzzer.error}</p>}

      <div className="buzzer-round-active" aria-live="polite" aria-atomic="true">
        {activePlayer ? <><span>Vez de responder</span><strong><span aria-hidden="true">{activePlayer.avatar} </span>{activePlayer.name}</strong>{activePlayer.teamId && <small>{room.teams.find((team) => team.id === activePlayer.teamId)?.name}</small>}</> : <><span>{round.status === 'open' ? 'Quem sabe a resposta?' : 'Aguardando próxima rodada'}</span><strong>{round.status === 'open' ? 'Aguardando um toque…' : 'Abra outro número ou rearme'}</strong></>}
      </div>
      <div className="buzzer-round-judge">
        <button type="button" className="buzzer-round-correct" disabled={!canJudge} onClick={() => { void buzzer.request('round:judge', { roundId: round.id, playerId: activePlayer?.id, correct: true }); }}>Acertou <span>({signedPoints(room.correctPoints)} pts)</span></button>
        <button type="button" className="buzzer-round-incorrect" disabled={!canJudge} onClick={() => { void buzzer.request('round:judge', { roundId: round.id, playerId: activePlayer?.id, correct: false }); }}>Errou <span>({signedPoints(room.incorrectPoints)} pts)</span></button>
      </div>

      <h3 className="buzzer-round-queue-heading">Ordem de chegada <span>({round.queue.length})</span></h3>
      {round.queue.length === 0 ? <p className="buzzer-round-empty">Os toques aparecem aqui em tempo real.</p> : <ol className="buzzer-round-queue" aria-label="Ordem dos toques">{round.queue.map((press) => {
        const player = room.players.find((item) => item.id === press.playerId);
        const outcome = press.outcome === 'correct' ? 'Acertou' : press.outcome === 'incorrect' ? 'Errou' : press.playerId === round.activePlayerId ? 'Respondendo' : 'Na fila';
        return <li key={press.playerId} className={`${press.playerId === round.activePlayerId ? 'buzzer-round-queue-active ' : ''}buzzer-round-outcome-${press.outcome}`}>
          <span className="buzzer-round-rank">{press.rank}º</span>
          <span className="buzzer-round-player"><strong>{player?.avatar || '👤'} {player?.name || 'Jogador removido'}</strong><small>{outcome}</small></span>
          <span className="buzzer-round-elapsed">{elapsedLabel(press.elapsedMs)}</span>
        </li>;
      })}</ol>}

      <div className="buzzer-round-actions">
        <button type="button" disabled={disabled} onClick={() => { void buzzer.request('round:reset', { roundId: round.id, requestId: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}` }); }}>Rearmar botões</button>
        <button type="button" disabled={disabled || round.status !== 'open'} onClick={() => { void buzzer.request('round:close', { roundId: round.id }); }}>Fechar botões</button>
      </div>
      <p className="buzzer-round-note">Rearmar limpa a fila desta pergunta e mantém os pontos. Um acerto fecha os botões; um erro chama o próximo jogador.</p>
    </aside>
  );
}
