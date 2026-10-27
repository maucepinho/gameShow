# Buzzer protocol

Socket.IO 4.x; all requests take a JSON object and an acknowledgement. Reply is `{ok:true,room,session?}` or `{ok:false,error,code?}`. `room:state` broadcasts the public room snapshot after every mutation. Never put credentials in snapshots, URLs, QR codes or logs. Frontend TypeScript schema is `src/buzzer/types.ts`.

## Sessions

- `room:create {name,hostName,requestId}` creates room and returns host session `{role:'host',code,token}`. Generate requestId with crypto.randomUUID(); this unpredictable 16..128 character value is a transient credential for retrying creation before the host token is received. Do not publish or put it in URLs.
- `room:join {code,name,avatar?,color?,sound?,teamId?}` returns player session `{role:'player',code,token,playerId}`.
- `session:resume {code,token}` restores either role; player identity and scores survive socket reconnection.
- `room:sync {}` returns current authorized snapshot.
- `player:update {name?,avatar?,color?,sound?,teamId?}` edits only the authenticated player.
- `player:buzz {roundId}` registers a single press for current round, only while host is online and round is open. Order/timing are decided by server arrival. First pending entry is active; others may still press to establish their rank. Duplicate presses are idempotent. Reject stale round IDs.

## Host only

- `round:start {questionKey,label,requestId,durationSeconds?}` opens a fresh round with new ID, clears queue and uses room timer by default. Repeated requestId does not reset twice. Labels contain category and question number, never the answer.
- `round:reset {roundId,requestId}` starts fresh with same question/key. Requires matching current ID.
- `round:close {roundId}` closes matching round to new presses; no scores change and the registered queue remains judgeable. Closing a waiting/null round is idempotent.
- `round:judge {roundId,playerId,correct,points?}` judges matching active pending player exactly once, including after manual closure or deadline. Correct adds room.correctPoints (or supplied points), closes and resolves the round; incorrect adds room.incorrectPoints (or supplied points) and advances to next pending player without reopening a closed round. Queue preserves the original order. Late presses while open may become active after incorrect answers. A resolved round never awards another correct answer unless reset.
- `host:score {playerId,delta}` adjusts player score; team score is derived from members.
- `room:settings {name?,teamMode?,timerSeconds?,correctPoints?,incorrectPoints?}` updates defaults. Timer is 0 (off) or 1..600 seconds; new defaults apply on next start/reset.
- `team:create {name,color?}` creates team; `team:remove {teamId}` removes it and unassigns players.
- `player:moderate {playerId,blocked?,remove?,teamId?}` manages player. Removing drops credentials; blocking prevents further buzzes.
- `room:reset-scores {}` zeroes scores, closes round and clears outcomes/queue.
- `room:end {}` closes round and shows final scores. `room:rematch {}` reuses same code/players/teams with zero scores and waiting round.

## Rules

Room snapshot matches BuzzerRoom, including computed team scores and connected flags. Empty round: id null, key/label empty, status waiting, startedAt/deadlineAt null, durationSeconds 0, activePlayerId null, queue []. Public round timestamps use server epoch milliseconds; elapsedMs uses a monotonic clock. Deadline is enforced on server for every press and by timer. Host disconnect closes current round; players cannot buzz until host reconnects and starts/rearms. Multiple sockets with same token represent one identity. Clients must resume on each socket connect and disable controls until acknowledgement. Server mutations are synchronous before broadcast/ack to prevent double winners. Validate all input and bound lengths, points, capacity and request frequency; use unpredictable tokens and room codes. Never trust client score, timestamps or identity fields. Rooms may expire after idle timeout. Server may optionally persist state, but documentation must state durability limitations of the chosen host.

Current implementation stores rooms in memory (lost on process restart), expires them after 24h idle / 7 days maximum, and bounds rooms to 100 players, 20 teams, and 5,000 remembered start/reset requests. `SESSION_INVALID` and `ROOM_NOT_FOUND` indicate saved credentials should be discarded. `session:removed {code}` and `room:expired {code}` notify connected clients of removed identities/expired rooms. A removed player's arrival ranks are not reassigned to other players.

## HTTP

- `/` serves only lightweight participant UI; join query `?room=ABCDEF`.
- `/health` returns health JSON.
- `/api/rooms/:code/qr.svg` returns QR of participant join URL, with PUBLIC_URL or RENDER_EXTERNAL_URL base when configured, otherwise request host. Code is public; token is never embedded.
- `/api/config` returns allowed avatars/colors/sound IDs and names for participant customization.
- Socket.IO browser client available at `/socket.io/socket.io.js`.

Default development port 3001; PORT and PUBLIC_URL configurable. CORS allows participant service origin plus ALLOWED_ORIGINS (default http://localhost:3000,http://127.0.0.1:3000). Accept local host frontend connecting to public HTTPS service. Deploy one instance unless shared state/adapter is implemented. Never serve the quiz build or its media from this server.
