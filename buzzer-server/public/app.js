/* Participant client. Room timing, order and scores always come from the server. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const SESSION_PREFIX = 'gameshow.buzzer.player.';
  const LAST_ROOM_KEY = 'gameshow.buzzer.lastRoom';
  const PROFILE_KEY = 'gameshow.buzzer.profile';
  const defaults = {
    avatars: ['🎵', '🎸', '🥁', '🎤', '🎹', '🎷', '🎺', '🦊', '🐼', '🐸', '🦁', '🐱', '🚀', '⭐', '⚡', '👑'],
    colors: ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#a78bfa', '#f472b6', '#fb923c', '#e2e8f0'],
    sounds: [
      { id: 'classic', name: 'Clássico' }, { id: 'horn', name: 'Buzina' },
      { id: 'laser', name: 'Laser' }, { id: 'duck', name: 'Pato' },
      { id: 'boing', name: 'Mola' }, { id: 'siren', name: 'Sirene' },
      { id: 'arcade', name: 'Fliperama' }, { id: 'pop', name: 'Estalo' },
    ],
  };
  const getStored = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
  const saveStored = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* A private browser may refuse persistence. */ } };
  const removeStored = (key) => { try { localStorage.removeItem(key); } catch { /* No persistence available. */ } };
  const normalizeCode = (value) => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  const queryCode = normalizeCode(new URLSearchParams(location.search).get('room'));
  const lastRoom = getStored(LAST_ROOM_KEY);
  let candidateCode = queryCode || normalizeCode(lastRoom);
  let preferences = getStored(PROFILE_KEY) || {};
  let config = defaults;
  let room = null;
  let session = null;
  let authorized = false;
  let resuming = false;
  let joining = false;
  let saving = false;
  let profileDirty = false;
  let teamSignature = '';
  let buzzAttemptRound = null;
  let pendingBuzz = false;
  let noticeTimer;
  let audioContext = null;
  let audioEnabled = false;
  let audioMuted = false;
  let seenRoundId = null;
  let seenOwnPress = false;
  let seenOutcome = 'pending';
  let lifecycle = 0;
  let resumeRetryTimer;

  function notice(message, error = false) {
    clearTimeout(noticeTimer);
    $('notice').textContent = message;
    $('notice').dataset.error = String(error);
    $('notice').hidden = !message;
    if (message) noticeTimer = setTimeout(() => { $('notice').hidden = true; }, error ? 9000 : 4500);
  }

  function addOption(select, value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }

  function loadOptions() {
    const avatarValue = $('profile-avatar').value || preferences.avatar;
    const colorValue = $('profile-color').value || preferences.color;
    const soundValue = $('profile-sound').value || preferences.sound;
    $('profile-avatar').replaceChildren();
    config.avatars.forEach((avatar) => addOption($('profile-avatar'), avatar, avatar));
    $('profile-color').replaceChildren();
    const colorNames = { '#FF6B6B': 'Coral', '#FFD166': 'Amarelo', '#06D6A0': 'Verde', '#4CC9F0': 'Azul', '#A78BFA': 'Roxo', '#F472B6': 'Rosa', '#FB923C': 'Laranja', '#E2E8F0': 'Prata' };
    config.colors.forEach((color, index) => addOption($('profile-color'), color, `${colorNames[color.toUpperCase()] || `Cor ${index + 1}`} · ${color}`));
    $('profile-sound').replaceChildren();
    config.sounds.forEach((sound) => addOption($('profile-sound'), sound.id, sound.name));
    if (config.avatars.includes(avatarValue)) $('profile-avatar').value = avatarValue;
    if (config.colors.includes(colorValue)) $('profile-color').value = colorValue;
    if (config.sounds.some((sound) => sound.id === soundValue)) $('profile-sound').value = soundValue;
    if (room) renderProfile();
  }

  function validConfig(value) {
    return value && Array.isArray(value.avatars) && value.avatars.length && value.avatars.every((entry) => typeof entry === 'string') && Array.isArray(value.colors) && value.colors.length && value.colors.every((entry) => /^#[\da-f]{6}$/i.test(entry)) && Array.isArray(value.sounds) && value.sounds.length && value.sounds.every((entry) => entry && typeof entry.id === 'string' && typeof entry.name === 'string');
  }

  function player() { return room?.players.find((entry) => entry.id === session?.playerId); }
  function ownPress() { return room?.round.queue.find((entry) => entry.playerId === session?.playerId); }
  function connected() { return Boolean(socket?.connected && authorized); }
  function canBuzz() {
    const me = player();
    return connected() && !pendingBuzz && !room.ended && room.hostConnected && me && !me.blocked && room.round.status === 'open' && !ownPress() && buzzAttemptRound !== room.round.id;
  }

  function request(event, payload = {}) {
    return new Promise((resolve) => {
      if (!socket?.connected) { resolve({ ok: false, error: 'Sem conexão. Aguarde a reconexão.' }); return; }
      socket.timeout(6500).emit(event, payload, (error, reply) => {
        resolve(error ? { ok: false, error: 'O servidor demorou a responder. Tente novamente.' } : reply || { ok: false, error: 'Resposta inválida do servidor.' });
      });
    });
  }

  function storeSession(nextSession) {
    session = nextSession;
    candidateCode = nextSession.code;
    saveStored(SESSION_PREFIX + nextSession.code, nextSession);
    saveStored(LAST_ROOM_KEY, nextSession.code);
    const url = new URL(location.href);
    url.searchParams.set('room', nextSession.code);
    history.replaceState(null, '', url.pathname + url.search);
  }

  function acceptRoom(nextRoom, { resumed = false } = {}) {
    if (!nextRoom || nextRoom.code !== session?.code) return;
    if (!resumed && room && nextRoom.revision < room.revision) return;
    room = nextRoom;
    const me = player();
    if (!me) {
      authorized = false;
      socket.sendBuffer.length = 0;
      removeStored(SESSION_PREFIX + session.code);
      session = null;
      room = null;
      notice('Sua participação foi removida. Fale com o apresentador para entrar novamente.', true);
      showJoin();
      updateConnection();
      return;
    }
    if (seenRoundId !== room.round.id || resumed) {
      seenRoundId = room.round.id;
      seenOwnPress = Boolean(ownPress());
      seenOutcome = ownPress()?.outcome || 'pending';
      buzzAttemptRound = ownPress() ? room.round.id : null;
      pendingBuzz = false;
    }
    const press = ownPress();
    if (press && !seenOwnPress) {
      seenOwnPress = true;
      playSound(me.sound);
      vibrate(press.rank === 1 ? [70, 40, 100] : 70);
    }
    if (press && press.outcome !== seenOutcome) {
      seenOutcome = press.outcome;
      if (press.outcome === 'correct') { playOutcome(true); vibrate([80, 60, 150]); }
      if (press.outcome === 'incorrect') { playOutcome(false); vibrate([160, 60, 160]); }
    }
    render();
  }

  function showJoin() {
    $('join-view').hidden = false;
    $('game-view').hidden = true;
    $('room-code').value = candidateCode;
    $('join-name').value = preferences.name || $('join-name').value;
    updateConnection();
  }

  async function resume(saved) {
    if (!saved || saved.role !== 'player' || !saved.token || !saved.code) return false;
    const turn = lifecycle;
    resuming = true;
    clearTimeout(resumeRetryTimer);
    authorized = false;
    updateConnection();
    const reply = await request('session:resume', { code: saved.code, token: saved.token });
    if (turn !== lifecycle || !socket.connected) return false;
    resuming = false;
    if (reply.ok) {
      storeSession(reply.session || saved);
      authorized = true;
      profileDirty = false;
      acceptRoom(reply.room, { resumed: true });
      updateConnection();
      return true;
    }
    if (['SESSION_INVALID', 'SESSION_EXPIRED', 'INVALID_SESSION', 'ROOM_NOT_FOUND', 'UNAUTHORIZED'].includes(reply.code)) {
      removeStored(SESSION_PREFIX + saved.code);
      session = null;
      room = null;
      showJoin();
    } else {
      // A transient acknowledgement timeout must not strand a connected player.
      resumeRetryTimer = setTimeout(() => {
        if (turn === lifecycle && socket.connected && !authorized && !resuming) void resume(saved);
      }, 5000);
    }
    notice(reply.error || 'Não foi possível recuperar sua participação.', true);
    updateConnection();
    return false;
  }

  function updateConnection() {
    const online = Boolean(socket?.connected);
    const awaitingSession = Boolean(session && !authorized);
    const state = !online ? 'offline' : resuming || awaitingSession ? 'connecting' : 'online';
    $('connection').dataset.state = state;
    $('connection').lastElementChild.textContent = !online ? 'Reconectando…' : resuming || awaitingSession ? 'Recuperando sala…' : 'Conectado';
    $('join-submit').disabled = !online || joining || resuming;
    $('join-submit').firstChild.textContent = resuming ? 'Recuperando participação… ' : joining ? 'Entrando… ' : 'Entrar na sala ';
    $('profile-save').disabled = !connected() || saving;
    $('profile-save').textContent = saving ? 'Salvando…' : 'Salvar alterações';
    if (room) renderRound();
  }

  function render() {
    if (!room || !session) return;
    $('join-view').hidden = true;
    $('game-view').hidden = false;
    $('game-code').textContent = room.code;
    $('room-name').textContent = room.name;
    const me = player();
    $('my-name').textContent = me.name;
    $('my-avatar').textContent = me.avatar;
    $('my-avatar').style.borderColor = safeColor(me.color, '#1DB954');
    $('my-avatar').style.backgroundColor = `${safeColor(me.color, '#1DB954')}20`;
    $('my-team').textContent = room.teams.find((entry) => entry.id === me.teamId)?.name || (room.teamMode ? 'Sem equipe' : 'Jogador individual');
    $('my-score').textContent = String(me.score);
    renderRound();
    renderQueue();
    renderScores();
    renderProfile();
    updateConnection();
  }

  function setRoundStatus(kind, eyebrow, title, detail, label, hint) {
    $('round-status').dataset.kind = kind;
    $('status-eyebrow').textContent = eyebrow;
    $('status-title').textContent = title;
    $('status-detail').textContent = detail;
    $('buzzer').dataset.kind = kind;
    $('buzzer-label').textContent = label;
    $('buzzer-help').textContent = hint;
  }

  function renderRound() {
    if (!room) return;
    const me = player();
    const press = ownPress();
    $('round-label').textContent = room.round.label || 'Aguardando a próxima pergunta';
    $('buzzer').disabled = !canBuzz();
    $('round-hint').textContent = room.ended ? 'Acompanhe o resultado final no placar' : 'Um toque por rodada · ordem registrada pelo servidor';
    if (!connected()) {
      setRoundStatus('offline', 'CONEXÃO INTERROMPIDA', 'Reconectando à sala…', 'Seu nome e seus pontos serão recuperados. Aguarde para apertar.', 'SEM REDE', 'Reconexão automática');
    } else if (room.ended) {
      const ordered = [...room.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'pt-BR'));
      const rank = ordered.findIndex((entry) => entry.id === me.id) + 1;
      setRoundStatus('ended', 'FIM DE JOGO', 'Partida encerrada', `Você terminou em ${rank}º lugar com ${me.score} ${me.score === 1 ? 'ponto' : 'pontos'}. Valeu por jogar!`, 'ATÉ A PRÓXIMA', 'O apresentador pode iniciar outra partida');
    } else if (me.blocked) {
      setRoundStatus('blocked', 'PARTICIPAÇÃO PAUSADA', 'Seu buzzer está bloqueado', 'Fale com o apresentador para liberar sua participação.', 'PAUSADO', 'Acompanhe o placar abaixo');
    } else if (!room.hostConnected) {
      setRoundStatus('offline', 'APRESENTADOR DESCONECTADO', 'Uma pausa no jogo', 'Aguarde o apresentador voltar e liberar a próxima rodada.', 'AGUARDE', 'Seus pontos estão preservados');
    } else if (press?.outcome === 'correct') {
      setRoundStatus('correct', 'MANDOU BEM!', 'Resposta correta!', 'Os pontos já estão no placar. Prepare-se para a próxima.', 'ACERTOU!', `${press.rank}º na ordem de chegada`);
    } else if (press?.outcome === 'incorrect') {
      setRoundStatus('incorrect', 'AINDA TEM JOGO', 'Não foi dessa vez', 'Sua resposta foi marcada como incorreta. Aguarde a próxima pergunta.', 'ERROU', `${press.rank}º na ordem de chegada`);
    } else if (press && room.round.activePlayerId === me.id && room.round.status === 'open') {
      setRoundStatus('first', 'É A SUA VEZ', 'Pode responder!', 'Fale sua resposta para o apresentador. Boa sorte!', `${press.rank}º`, 'Sua vez de responder');
    } else if (press) {
      const detail = room.round.status === 'open' ? 'Seu toque foi registrado. Aguarde sua vez de responder.' : 'A rodada terminou. Seu lugar na ordem está registrado abaixo.';
      setRoundStatus('rank', 'TOQUE REGISTRADO', `Você foi o ${press.rank}º!`, detail, `${press.rank}º`, 'Registrado pelo servidor');
    } else if (pendingBuzz || buzzAttemptRound === room.round.id && room.round.id) {
      setRoundStatus('waiting', 'ENVIANDO SEU TOQUE', 'Confirmando a chegada…', 'Aguarde a confirmação do servidor.', 'ENVIADO', 'Verificando sua posição');
    } else if (room.round.status === 'open') {
      setRoundStatus('open', 'VALENDO!', 'Sabe a resposta?', 'Aperte o botão para entrar na ordem de resposta.', 'BUZZ!', 'Toque aqui ou pressione espaço');
    } else if (room.round.status === 'closed') {
      setRoundStatus('closed', 'RODADA ENCERRADA', 'Aguarde a próxima', 'O botão será liberado automaticamente na próxima pergunta.', 'FECHADO', 'A próxima chance vem aí');
    } else {
      setRoundStatus('waiting', 'PRONTO PARA JOGAR', 'Aguarde o apresentador', 'O botão será liberado quando a pergunta começar.', 'AGUARDE', 'A próxima pergunta vem aí');
    }
    renderTimer();
  }

  function renderTimer() {
    const deadline = room?.round.deadlineAt;
    const visible = Boolean(deadline && room.round.status === 'open' && connected() && room.hostConnected && !room.ended);
    $('timer').hidden = !visible;
    if (visible) {
      const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      $('timer').textContent = `◷ ${seconds}s`;
      $('timer').classList.toggle('urgent', seconds <= 5);
      $('timer').setAttribute('aria-label', `Tempo aproximado restante: ${seconds} segundos. O servidor controla o encerramento.`);
    }
  }

  function safeColor(value, fallback = '#1DB954') { return /^#[\da-f]{6}$/i.test(value || '') ? value : fallback; }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function makeRow({ rank, name, avatar, subtitle, value, active, mine, outcome, color }) {
    const row = element('li', `list-row${active ? ' is-active' : ''}${mine ? ' is-me' : ''}`);
    row.append(element('span', 'row-rank', String(rank)));
    if (avatar) {
      const avatarNode = element('span', 'row-avatar', avatar);
      avatarNode.setAttribute('aria-hidden', 'true');
      row.append(avatarNode);
    } else if (color) {
      const dot = element('span', 'team-dot');
      dot.style.backgroundColor = safeColor(color);
      dot.setAttribute('aria-hidden', 'true');
      row.append(dot);
    }
    const main = element('span', 'row-main');
    main.append(element('span', 'row-name', name + (mine ? ' (você)' : '')));
    if (subtitle) main.append(element('span', 'row-subtitle', subtitle));
    row.append(main);
    row.append(element('span', `row-value ${outcome || ''}`, value));
    return row;
  }

  function renderQueue() {
    $('queue-count').textContent = String(room.round.queue.length);
    $('queue-empty').hidden = room.round.queue.length > 0;
    $('queue-list').replaceChildren();
    room.round.queue.forEach((entry) => {
      const member = room.players.find((item) => item.id === entry.playerId);
      if (!member) return;
      const active = room.round.activePlayerId === entry.playerId && room.round.status === 'open' && !room.ended;
      let subtitle = active ? 'Respondendo agora' : entry.outcome === 'correct' ? 'Resposta correta' : entry.outcome === 'incorrect' ? 'Resposta incorreta' : room.round.status === 'open' ? 'Aguardando sua vez' : 'Toque registrado';
      if (!member.connected) subtitle += ' · desconectado';
      $('queue-list').append(makeRow({ rank: `${entry.rank}º`, name: member.name, avatar: member.avatar, subtitle, active, mine: member.id === session.playerId, outcome: entry.outcome, value: entry.outcome === 'correct' ? '✓' : entry.outcome === 'incorrect' ? '×' : `${(entry.elapsedMs / 1000).toFixed(2)}s` }));
    });
  }

  function renderScores() {
    $('player-count').textContent = `${room.players.length} ${room.players.length === 1 ? 'jogador' : 'jogadores'}`;
    $('player-scores').replaceChildren();
    [...room.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'pt-BR')).forEach((member, index) => {
      const team = room.teams.find((entry) => entry.id === member.teamId);
      const status = member.blocked ? 'Buzzer pausado' : member.connected ? 'Online' : 'Desconectado';
      $('player-scores').append(makeRow({ rank: index + 1, name: member.name, avatar: member.avatar, subtitle: `${team ? `${team.name} · ` : ''}${status}`, mine: member.id === session.playerId, value: String(member.score) }));
    });
    $('team-scores-wrap').hidden = !room.teamMode;
    $('team-scores').replaceChildren();
    [...room.teams].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'pt-BR')).forEach((team, index) => {
      const count = room.players.filter((member) => member.teamId === team.id).length;
      $('team-scores').append(makeRow({ rank: index + 1, name: team.name, color: team.color, subtitle: `${count} ${count === 1 ? 'jogador' : 'jogadores'}`, value: String(team.score) }));
    });
  }

  function renderProfile() {
    const me = player();
    if (!me) return;
    $('team-field').hidden = !room.teamMode;
    const signature = JSON.stringify(room.teams.map((team) => [team.id, team.name]));
    if (signature !== teamSignature) {
      const selected = profileDirty ? $('profile-team').value : me.teamId;
      $('profile-team').replaceChildren();
      addOption($('profile-team'), '', 'Sem equipe');
      room.teams.forEach((team) => addOption($('profile-team'), team.id, team.name));
      $('profile-team').value = selected || '';
      teamSignature = signature;
    }
    if (!profileDirty) {
      $('profile-name').value = me.name;
      $('profile-avatar').value = me.avatar;
      $('profile-color').value = me.color;
      $('profile-sound').value = me.sound;
      $('profile-team').value = me.teamId || '';
    }
    for (const control of $('profile-form').elements) control.disabled = !connected() || saving;
  }

  async function unlockAudio(force = false) {
    if (audioMuted && !force) return false;
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) { notice('Este navegador não oferece sons sintetizados. O buzzer continua funcionando.', true); return false; }
      audioContext ||= new Context();
      await audioContext.resume();
      audioEnabled = audioContext.state === 'running';
      if (force) audioMuted = false;
      updateAudioButton();
      return audioEnabled;
    } catch { notice('Não foi possível ativar o som. Verifique as permissões do navegador.', true); return false; }
  }

  function updateAudioButton() {
    $('audio-toggle').textContent = audioEnabled ? 'Som ativado ♪' : 'Ativar som';
    $('audio-toggle').setAttribute('aria-pressed', String(audioEnabled));
  }

  function tone(frequency, endFrequency, duration, type = 'sine', offset = 0, volume = 0.12) {
    if (!audioEnabled || audioContext?.state !== 'running') return;
    const start = audioContext.currentTime + offset;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, frequency), start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }

  function playSound(id) {
    switch (id) {
      case 'horn': tone(174, 174, 0.32, 'sawtooth', 0, 0.075); tone(220, 220, 0.32, 'sawtooth', 0, 0.06); break;
      case 'laser': tone(1450, 80, 0.38, 'sawtooth', 0, 0.085); break;
      case 'duck': tone(580, 230, 0.15, 'square', 0, 0.06); tone(540, 210, 0.18, 'square', 0.17, 0.06); break;
      case 'boing': tone(160, 720, 0.11, 'triangle'); tone(720, 110, 0.42, 'triangle', 0.1); break;
      case 'siren': tone(450, 1000, 0.2, 'triangle'); tone(1000, 450, 0.22, 'triangle', 0.2); break;
      case 'arcade': [523, 659, 784, 1047].forEach((frequency, index) => tone(frequency, frequency, 0.13, 'square', index * 0.07, 0.055)); break;
      case 'pop': tone(750, 70, 0.1, 'sine', 0, 0.18); break;
      default: tone(660, 660, 0.15, 'square', 0, 0.07); tone(880, 880, 0.2, 'square', 0.15, 0.065);
    }
  }
  function playOutcome(correct) {
    const notes = correct ? [523, 659, 784] : [240, 160];
    notes.forEach((frequency, index) => tone(frequency, correct ? frequency : frequency * 0.7, 0.22, 'triangle', index * 0.12, 0.13));
  }
  function vibrate(pattern) { try { navigator.vibrate?.(pattern); } catch { /* Vibration is optional. */ } }

  async function buzz() {
    if (!canBuzz()) return;
    void unlockAudio();
    const roundId = room.round.id;
    const turn = lifecycle;
    pendingBuzz = true;
    buzzAttemptRound = roundId;
    renderRound();
    // Volatile emission is intentional: a press must never queue while offline.
    socket.volatile.timeout(4000).emit('player:buzz', { roundId }, async (error, reply) => {
      if (turn !== lifecycle || room?.round.id !== roundId) return;
      pendingBuzz = false;
      if (!error && reply?.ok) {
        acceptRoom(reply.room);
        return;
      }
      if (!error && reply && !reply.ok) notice(reply.error || 'Seu toque não foi registrado.', true);
      // Only an authoritative sync can permit a retry after an uncertain response.
      const sync = await request('room:sync');
      if (turn !== lifecycle || !authorized || room?.round.id !== roundId) return;
      if (sync.ok) {
        acceptRoom(sync.room);
        if (!ownPress()) buzzAttemptRound = null;
        if (error) notice(ownPress() ? 'Toque confirmado. Sua posição está abaixo.' : 'Seu toque não chegou. Se o botão estiver liberado, aperte novamente.', !ownPress());
      } else if (error) notice('Não foi possível confirmar seu toque. Aguardando reconexão.', true);
      renderRound();
    });
  }

  $('room-code').value = candidateCode;
  $('join-name').value = preferences.name || '';
  loadOptions();
  fetch('/api/config', { cache: 'no-store' }).then((response) => response.ok ? response.json() : Promise.reject()).then((value) => {
    if (validConfig(value)) { config = value; loadOptions(); }
  }).catch(() => { /* The server still validates every submitted option. */ });

  let socket = null;
  if (typeof window.io !== 'function') {
    $('connection').dataset.state = 'offline';
    $('connection').lastElementChild.textContent = 'Sem conexão';
    notice('Não foi possível carregar a conexão com o jogo. Recarregue a página.', true);
    return;
  }
  socket = window.io({ autoConnect: false, reconnection: true, reconnectionDelay: 700, reconnectionDelayMax: 5000, timeout: 10000 });
  socket.on('connect', async () => {
    lifecycle += 1;
    authorized = false;
    resuming = false;
    pendingBuzz = false;
    updateConnection();
    const saved = session || getStored(SESSION_PREFIX + candidateCode);
    if (saved?.role === 'player') await resume(saved);
    else showJoin();
  });
  socket.on('disconnect', () => {
    // Drop stale commands before Socket.IO clears acknowledgements/reconnects.
    socket.sendBuffer.length = 0;
    lifecycle += 1;
    authorized = false;
    resuming = false;
    joining = false;
    saving = false;
    pendingBuzz = false;
    clearTimeout(resumeRetryTimer);
    updateConnection();
    if (room) renderProfile();
  });
  socket.on('connect_error', () => { authorized = false; resuming = false; updateConnection(); });
  socket.on('room:state', (nextRoom) => { if (authorized) acceptRoom(nextRoom); });
  function invalidateSession(message) {
    lifecycle += 1;
    socket.sendBuffer.length = 0;
    clearTimeout(resumeRetryTimer);
    if (session) removeStored(SESSION_PREFIX + session.code);
    session = null;
    room = null;
    authorized = false;
    resuming = false;
    pendingBuzz = false;
    showJoin();
    notice(message, true);
  }
  socket.on('session:removed', () => invalidateSession('O apresentador removeu sua participação. Fale com ele para entrar novamente.'));
  socket.on('room:expired', () => invalidateSession('Essa sala expirou. Peça um novo código ao apresentador.'));
  socket.connect();

  $('join-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!socket.connected || joining || resuming) return;
    const code = normalizeCode($('room-code').value);
    const name = $('join-name').value.trim();
    if (code.length !== 6 || !name) { notice('Preencha o código de 6 caracteres da sala e seu nome.', true); return; }
    void unlockAudio();
    candidateCode = code;
    const saved = getStored(SESSION_PREFIX + code);
    if (saved?.role === 'player') { await resume(saved); return; }
    const turn = lifecycle;
    joining = true;
    updateConnection();
    const payload = {
      code, name,
      avatar: config.avatars.includes(preferences.avatar) ? preferences.avatar : config.avatars[0],
      color: config.colors.includes(preferences.color) ? preferences.color : config.colors[0],
      sound: config.sounds.some((entry) => entry.id === preferences.sound) ? preferences.sound : config.sounds[0].id,
    };
    const reply = await request('room:join', payload);
    if (turn !== lifecycle) return;
    joining = false;
    if (reply.ok && reply.session?.role === 'player') {
      preferences = { ...preferences, name };
      saveStored(PROFILE_KEY, preferences);
      storeSession(reply.session);
      authorized = true;
      profileDirty = false;
      acceptRoom(reply.room, { resumed: true });
    } else notice(reply.error || 'Não foi possível entrar nessa sala.', true);
    updateConnection();
  });

  $('switch-room').addEventListener('click', () => {
    lifecycle += 1;
    socket.sendBuffer.length = 0;
    socket.disconnect();
    session = null;
    room = null;
    candidateCode = '';
    authorized = false;
    profileDirty = false;
    teamSignature = '';
    removeStored(LAST_ROOM_KEY);
    const url = new URL(location.href);
    url.searchParams.delete('room');
    history.replaceState(null, '', url.pathname + url.search);
    showJoin();
    socket.connect();
    $('room-code').focus();
  });

  $('profile-form').addEventListener('input', () => { profileDirty = true; });
  $('profile-form').addEventListener('change', () => { profileDirty = true; });
  $('profile-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!connected() || saving) return;
    const name = $('profile-name').value.trim();
    if (!name) { notice('Preencha seu nome ou apelido.', true); return; }
    const payload = { name, avatar: $('profile-avatar').value, color: $('profile-color').value, sound: $('profile-sound').value, ...(room.teamMode ? { teamId: $('profile-team').value || null } : {}) };
    const turn = lifecycle;
    saving = true;
    renderProfile();
    updateConnection();
    const reply = await request('player:update', payload);
    if (turn !== lifecycle) return;
    saving = false;
    if (reply.ok) {
      preferences = { name: payload.name, avatar: payload.avatar, color: payload.color, sound: payload.sound };
      saveStored(PROFILE_KEY, preferences);
      profileDirty = false;
      acceptRoom(reply.room);
      notice('Seu estilo foi atualizado.');
    } else notice(reply.error || 'Não foi possível salvar suas alterações.', true);
    renderProfile();
    updateConnection();
  });

  $('audio-toggle').addEventListener('click', async () => {
    if (audioEnabled) { audioEnabled = false; audioMuted = true; updateAudioButton(); }
    else if (await unlockAudio(true)) playSound(player()?.sound || 'classic');
  });
  $('preview-sound').addEventListener('click', async () => { if (await unlockAudio(true)) playSound($('profile-sound').value); });
  $('buzzer').addEventListener('click', buzz);
  document.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || $('game-view').hidden) return;
    if (event.target.closest('input, select, textarea, button, a, summary, [contenteditable="true"]')) return;
    event.preventDefault();
    void buzz();
  });
  window.addEventListener('online', () => { if (!socket.connected) socket.connect(); });
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !connected()) return;
    const turn = lifecycle;
    const reply = await request('room:sync');
    if (turn === lifecycle && authorized && reply.ok) acceptRoom(reply.room);
  });
  setInterval(renderTimer, 250);
})();
