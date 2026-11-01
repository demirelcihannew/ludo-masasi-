// Oyun sunucusu — Ludo Masası ve Son Kart
// Statik dosyaları (public/) sunar ve WebSocket üzerinden online odaları yönetir.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

// Her oyunun kural motoru aynı arayüzü sunar: newState/startGame/applyAct/botStep/
// deadline/timeoutStep/armTimer/view. Oda hangi oyunsa onun motoru kullanılır.
const ENGINES = { ludo: require('./public/engine.js'), cards: require('./public/cards.js') };
const GAMES = Object.keys(ENGINES);
const eng = room => ENGINES[room.game];
const rnd = n => crypto.randomInt(n);

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

/* ---------------- statik dosyalar ---------------- */
const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (url === '/api/room') {
    const code = String(((req.url || '').split('?')[1] || '').replace(/^.*\bcode=/, '').split('&')[0] || '')
      .toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const room = rooms.get(code);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(room ? { code, game: room.game, phase: room.st.phase } : {}));
  }
  if (url === '/' || !path.extname(url)) url = '/index.html';
  const file = path.normalize(path.join(PUBLIC, url));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Bulunamadı'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

/* ---------------- odalar ---------------- */
const rooms = new Map();   // kod -> oda
const OFFLINE_BOT_MS = 15000;       // bağlantısı kopan oyuncunun yerine bot bu süreden sonra oynar
const EMPTY_ROOM_MS = 30 * 60000;   // kimsenin kalmadığı oda bu süreden sonra silinir
const CHAT_KEEP = 40;               // odada saklanan son mesaj sayısı
const CHAT_GAP_MS = 600;            // aynı kişinin iki mesajı arasındaki en kısa süre
const CHAT_MAX = 140;               // bir mesajdaki en fazla karakter

function makeCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (;;) { let c = ''; for (let i = 0; i < 4; i++) c += A[rnd(A.length)]; if (!rooms.has(c)) return c; }
}
const cleanNick = v => String(v || '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, '').trim().slice(0, 16);
const cleanPid = v => (typeof v === 'string' && /^[a-z0-9]{6,40}$/i.test(v) ? v : null);
// Mesajlar istemcide metin olarak basılır; burada yalnızca görünmez/kontrol karakterleri ayıklanır.
const cleanText = v => String(v || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function presentPids(room) { const s = new Set(); room.clients.forEach(ws => s.add(ws.pid)); return s; }
/** Durumu yayar. Kart oyununda eller gizli olduğu için her oyuncuya kendi görünümü gider. */
function broadcast(room) {
  const E = eng(room); room.st.seq++;
  const head = { t: 'state', now: Date.now(), game: room.game };
  const wrap = pid => JSON.stringify({ ...head, st: { ...E.view(room.st, pid), hostPid: room.hostPid, code: room.code } });
  if (!E.perPlayer) {
    const msg = wrap(null);
    room.clients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
    return;
  }
  const cache = new Map();
  room.clients.forEach(ws => {
    if (ws.readyState !== 1) return;
    let j = cache.get(ws.pid); if (!j) { j = wrap(ws.pid); cache.set(ws.pid, j); }
    ws.send(j);
  });
}
function seatOf(room, pid) { return eng(room).COLORS.find(c => room.st.seats[c] && !room.st.seats[c].bot && room.st.seats[c].pid === pid); }

/** Bağlantı durumlarını güncelle, gerekirse kurucu yetkisini devret. */
function refresh(room) {
  const E = eng(room), st = room.st, present = presentPids(room);
  E.COLORS.forEach(c => {
    const se = st.seats[c]; if (!se || se.bot) return;
    const off = !present.has(se.pid);
    if (st.phase === 'lobby' && off) { st.seats[c] = null; return; }
    if (!!se.off !== off) { se.off = off; if (off) room.offSince[se.pid] = Date.now(); else delete room.offSince[se.pid]; }
  });
  if (!present.has(room.hostPid)) {
    const seated = E.COLORS.map(c => st.seats[c]).find(se => se && !se.bot && present.has(se.pid));
    const any = [...present][0];
    if (seated || any) room.hostPid = seated ? seated.pid : any;
  }
  if (st.phase === 'lobby' && st.teams && !E.teamsOk(st)) st.teams = false;
  room.emptySince = room.clients.size ? 0 : (room.emptySince || Date.now());
}

function scheduleBot(room) {
  clearTimeout(room.botT);
  const E = eng(room), st = room.st; if (st.phase !== 'play') return;
  const se = st.seats[st.turn]; if (!se) return;
  const botDelay = E.botDelay(st), now = Date.now();
  let wait = botDelay, human = !se.bot;
  if (human) {
    // süre dolunca ya da (bağlantısı koptuysa) 15 sn sonra hamle otomatik yapılır
    const byClock = (E.deadline(st) || now) - now;
    const byOffline = se.off ? Math.max(0, OFFLINE_BOT_MS - (now - (room.offSince[se.pid] || now))) + botDelay : Infinity;
    wait = Math.max(0, Math.min(byClock, byOffline));
  } else if (E.deadline(st)) {
    // bot oynarken de "Son kart!" gibi ayrı bir sayaç işleyebilir
    wait = Math.max(0, Math.min(botDelay, E.deadline(st) - now));
  }
  const key = st.stepKey + '|' + (st.call ? st.call.by + ':' + st.call.done : '');
  room.botT = setTimeout(() => {
    const s = room.st, cur = s.seats[s.turn];
    if (s.phase !== 'play' || !cur) return;
    if (key !== s.stepKey + '|' + (s.call ? s.call.by + ':' + s.call.done : '')) return;
    const t = Date.now();
    if (human && !cur.bot && !cur.off) E.timeoutStep(s, t);
    else if (E.deadline(s) && E.deadline(s) <= t) E.timeoutStep(s, t);
    else E.botStep(s, t);
    changed(room);
  }, wait);
}
function changed(room) { eng(room).armTimer(room.st, Date.now()); broadcast(room); scheduleBot(room); }

function joinRoom(ws, room, nick) {
  if (ws.room && ws.room !== room) leave(ws);
  ws.room = room; room.clients.add(ws);
  const E = eng(room), st = room.st;
  let seat = seatOf(room, ws.pid);
  if (seat) { if (st.phase === 'lobby') st.seats[seat].nick = nick; }
  else if (st.phase === 'lobby') {
    const free = E.SEAT_ORDER.find(c => !st.seats[c]);
    if (free) st.seats[free] = { pid: ws.pid, nick, bot: false };
  }
  send(ws, { t: 'joined', code: room.code, game: room.game });
  if (room.chat.length) send(ws, { t: 'chatlog', items: room.chat });
  refresh(room); changed(room);
}
function leave(ws) {
  const room = ws.room; if (!room) return;
  room.clients.delete(ws); ws.room = null;
  refresh(room); changed(room);
}

/* ---------------- mesajlar ---------------- */
function handle(ws, m) {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'hello') { ws.pid = cleanPid(m.pid); return; }
  if (!ws.pid) return send(ws, { t: 'error', code: 'conn' });

  if (m.t === 'create') {
    const game = GAMES.includes(m.game) ? m.game : 'ludo';
    const room = { code: makeCode(), game, st: ENGINES[game].newState(), hostPid: ws.pid, clients: new Set(),
      offSince: {}, botT: null, emptySince: 0, chat: [], chatId: 0 };
    room.st.msg = null;
    rooms.set(room.code, room);
    return joinRoom(ws, room, cleanNick(m.nick));
  }
  if (m.t === 'join') {
    const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const room = rooms.get(code);
    if (!room) return send(ws, { t: 'error', code: 'no_room' });
    // Oyuncu başka bir oyunun sayfasından geldiyse doğru sayfaya yönlendirilir.
    if (m.game && m.game !== room.game) return send(ws, { t: 'wrongGame', code, game: room.game });
    return joinRoom(ws, room, cleanNick(m.nick));
  }
  if (m.t === 'leave') { leave(ws); return; }

  const room = ws.room; if (!room) return;
  const E = eng(room), st = room.st, isHost = ws.pid === room.hostPid;

  if (m.t === 'chat') {
    const text = cleanText(m.text); if (!text) return;
    const now = Date.now(); if (now - (ws.lastChat || 0) < CHAT_GAP_MS) return; ws.lastChat = now;
    const seat = seatOf(room, ws.pid);
    const item = { id: ++room.chatId, pid: ws.pid, c: seat || null, nick: cleanNick(seat ? st.seats[seat].nick : m.nick), text };
    room.chat.push(item); if (room.chat.length > CHAT_KEEP) room.chat.shift();
    const out = JSON.stringify({ t: 'chat', item });
    room.clients.forEach(c => { if (c.readyState === 1) c.send(out); });
    return;
  }
  if (m.t === 'act') { if (E.applyAct(st, m.a, ws.pid, Date.now())) changed(room); return; }
  if (!isHost) return;
  if (m.t === 'addbot' && E.COLORS.includes(m.c) && !st.seats[m.c] && st.phase === 'lobby') {
    st.seats[m.c] = { pid: 'bot-' + m.c, nick: '', bot: true }; return changed(room);
  }
  if (m.t === 'rmbot' && E.COLORS.includes(m.c) && st.seats[m.c] && st.seats[m.c].bot && st.phase === 'lobby') {
    st.seats[m.c] = null; return changed(room);
  }
  if (m.t === 'teams' && st.phase === 'lobby') {
    st.teams = !!m.on && E.teamsOk(st); return changed(room);
  }
  if (m.t === 'start' && st.phase === 'lobby' && E.COLORS.filter(c => st.seats[c]).length >= 2) { E.startGame(st); return changed(room); }
  if (m.t === 'again' && st.phase === 'over') {
    E.COLORS.forEach(c => { if (st.seats[c] && st.seats[c].off) st.seats[c] = null; });
    if (E.COLORS.filter(c => st.seats[c]).length >= 2) E.startGame(st); else { st.phase = 'lobby'; st.msg = null; }
    return changed(room);
  }
  if (m.t === 'tolobby' && st.phase !== 'lobby') { st.phase = 'lobby'; st.msg = null; refresh(room); return changed(room); }
}

const wss = new WebSocketServer({ server, maxPayload: 4096 });
wss.on('connection', ws => {
  ws.alive = true; ws.room = null; ws.pid = null; ws.budget = 30;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => {
    if (--ws.budget < 0) return;              // basit hız sınırı: saniyede ~30 mesaj
    let m; try { m = JSON.parse(raw); } catch { return; }
    try { handle(ws, m); } catch (e) { console.error('mesaj hatası', e); }
  });
  ws.on('close', () => leave(ws));
});
setInterval(() => wss.clients.forEach(ws => { ws.budget = 30; }), 1000);
setInterval(() => {
  wss.clients.forEach(ws => { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.ping(); });
  const now = Date.now();
  rooms.forEach((room, code) => { if (!room.clients.size && room.emptySince && now - room.emptySince > EMPTY_ROOM_MS) { clearTimeout(room.botT); rooms.delete(code); } });
}, 30000);

server.listen(PORT, () => console.log(`Oyun sunucusu çalışıyor: http://localhost:${PORT}`));
