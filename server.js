// Ludo Masası — oyun sunucusu
// Statik dosyaları (public/) sunar ve WebSocket üzerinden online odaları yönetir.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const E = require('./public/engine.js');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

/* ---------------- statik dosyalar ---------------- */
const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
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

function makeCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (;;) { let c = ''; for (let i = 0; i < 4; i++) c += A[E.rnd(A.length)]; if (!rooms.has(c)) return c; }
}
const cleanNick = v => String(v || '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, '').trim().slice(0, 16) || 'Oyuncu';
const cleanPid = v => (typeof v === 'string' && /^[a-z0-9]{6,40}$/i.test(v) ? v : null);

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function presentPids(room) { const s = new Set(); room.clients.forEach(ws => s.add(ws.pid)); return s; }
function broadcast(room) {
  room.st.seq++;
  const msg = JSON.stringify({ t: 'state', st: { ...room.st, hostPid: room.hostPid, code: room.code } });
  room.clients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
}
function seatOf(room, pid) { return E.COLORS.find(c => room.st.seats[c] && !room.st.seats[c].bot && room.st.seats[c].pid === pid); }

/** Bağlantı durumlarını güncelle, gerekirse kurucu yetkisini devret. */
function refresh(room) {
  const st = room.st, present = presentPids(room);
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
  room.emptySince = room.clients.size ? 0 : (room.emptySince || Date.now());
}

function scheduleBot(room) {
  clearTimeout(room.botT);
  const st = room.st; if (st.phase !== 'play') return;
  const se = st.seats[st.turn]; if (!se) return;
  let wait = 0;
  if (!se.bot) { if (!se.off) return; wait = Math.max(0, OFFLINE_BOT_MS - (Date.now() - (room.offSince[se.pid] || Date.now()))); }
  room.botT = setTimeout(() => {
    const cur = room.st.seats[room.st.turn];
    if (room.st.phase !== 'play' || !cur || (!cur.bot && !cur.off)) return;
    E.botStep(room.st); broadcast(room); scheduleBot(room);
  }, wait + (st.dice == null ? 1100 : 900));
}
function changed(room) { broadcast(room); scheduleBot(room); }

function joinRoom(ws, room, nick) {
  if (ws.room && ws.room !== room) leave(ws);
  ws.room = room; room.clients.add(ws);
  const st = room.st;
  let seat = seatOf(room, ws.pid);
  if (seat) { if (st.phase === 'lobby') st.seats[seat].nick = nick; }
  else if (st.phase === 'lobby') {
    const free = E.SEAT_ORDER.find(c => !st.seats[c]);
    if (free) st.seats[free] = { pid: ws.pid, nick, bot: false };
  }
  send(ws, { t: 'joined', code: room.code });
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
  if (!ws.pid) return send(ws, { t: 'error', msg: 'Bağlantı kurulamadı, sayfayı yenile.' });

  if (m.t === 'create') {
    const room = { code: makeCode(), st: E.newState(), hostPid: ws.pid, clients: new Set(), offSince: {}, botT: null, emptySince: 0 };
    room.st.msg = 'Oda kuruldu.';
    rooms.set(room.code, room);
    return joinRoom(ws, room, cleanNick(m.nick));
  }
  if (m.t === 'join') {
    const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const room = rooms.get(code);
    if (!room) return send(ws, { t: 'error', msg: 'Bu kodla bir oda bulunamadı. Kodu kontrol et ya da yeni oda kur.', code: 'no_room' });
    return joinRoom(ws, room, cleanNick(m.nick));
  }
  if (m.t === 'leave') { leave(ws); return; }

  const room = ws.room; if (!room) return;
  const st = room.st, isHost = ws.pid === room.hostPid;

  if (m.t === 'act') { if (E.applyAct(st, m.a, ws.pid)) changed(room); return; }
  if (!isHost) return;
  if (m.t === 'addbot' && E.COLORS.includes(m.c) && !st.seats[m.c] && st.phase === 'lobby') {
    st.seats[m.c] = { pid: 'bot-' + m.c, nick: 'Bot ' + E.NAME[m.c], bot: true }; return changed(room);
  }
  if (m.t === 'rmbot' && E.COLORS.includes(m.c) && st.seats[m.c] && st.seats[m.c].bot && st.phase === 'lobby') {
    st.seats[m.c] = null; return changed(room);
  }
  if (m.t === 'start' && st.phase === 'lobby' && E.COLORS.filter(c => st.seats[c]).length >= 2) { E.startGame(st); return changed(room); }
  if (m.t === 'again' && st.phase === 'over') {
    E.COLORS.forEach(c => { if (st.seats[c] && st.seats[c].off) st.seats[c] = null; });
    if (E.COLORS.filter(c => st.seats[c]).length >= 2) E.startGame(st); else { st.phase = 'lobby'; st.msg = ''; }
    return changed(room);
  }
  if (m.t === 'tolobby' && st.phase !== 'lobby') { st.phase = 'lobby'; st.msg = ''; refresh(room); return changed(room); }
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

server.listen(PORT, () => console.log(`Ludo Masası çalışıyor: http://localhost:${PORT}`));
