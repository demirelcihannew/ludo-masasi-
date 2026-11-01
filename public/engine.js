/* Ludo kurallar motoru. s.msg bir olaydır ({k, c, d, r}); ekran kendi dilinde yazar.
   Ludo kurallar motoru — hem sunucu (Node) hem tarayıcı kullanır. */
(function () {
  const COLORS = ['red', 'green', 'yellow', 'blue'];           // saat yönünde sıra
  const SEAT_ORDER = ['red', 'yellow', 'green', 'blue'];       // 2 kişide karşılıklı otururlar
  const NAME = { red: 'Kırmızı', green: 'Yeşil', yellow: 'Sarı', blue: 'Mavi' };
  const TRACK = [[1,6],[2,6],[3,6],[4,6],[5,6],[6,5],[6,4],[6,3],[6,2],[6,1],[6,0],[7,0],[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[9,6],[10,6],[11,6],[12,6],[13,6],[14,6],[14,7],[14,8],[13,8],[12,8],[11,8],[10,8],[9,8],[8,9],[8,10],[8,11],[8,12],[8,13],[8,14],[7,14],[6,14],[6,13],[6,12],[6,11],[6,10],[6,9],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8],[0,7],[0,6]];
  const OFF = { red: 0, green: 13, yellow: 26, blue: 39 };
  const HOME = {
    red: [[1,7],[2,7],[3,7],[4,7],[5,7]], green: [[7,1],[7,2],[7,3],[7,4],[7,5]],
    yellow: [[13,7],[12,7],[11,7],[10,7],[9,7]], blue: [[7,13],[7,12],[7,11],[7,10],[7,9]]
  };
  const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
  const TEAM = { red: 0, yellow: 0, green: 1, blue: 1 };   // karşılıklı oturanlar aynı takım
  const TEAM_OF = c => TEAM[c];
  const MATE = { red: 'yellow', yellow: 'red', green: 'blue', blue: 'green' };
  /** Takımlı modda iki rengin aynı takımda olup olmadığı. */
  const isMate = (s, a, b) => !!s.teams && a !== b && TEAM[a] === TEAM[b];
  /** Takımlı mod yalnızca 4 oyuncuyla oynanır. */
  const teamsOk = s => COLORS.filter(c => s.seats[c]).length === 4;
  const TURN_MS = 20000;   // her karar (zar atma / taş seçme) için süre

  function rnd(n) {
    const c = typeof globalThis !== 'undefined' && globalThis.crypto;
    if (c && c.getRandomValues) { const a = new Uint32Array(1); c.getRandomValues(a); return a[0] % n; }
    return Math.floor(Math.random() * n);
  }
  const nk = (s, c) => (s.seats[c] ? s.seats[c].nick : NAME[c]);
  const gIdx = (c, p) => (p + OFF[c]) % 52;

  function newState() {
    return { v: 1, seq: 0, phase: 'lobby', seats: { red: null, green: null, yellow: null, blue: null }, order: [], turn: null,
      dice: null, sixes: 0, pcs: { red: [-1,-1,-1,-1], green: [-1,-1,-1,-1], yellow: [-1,-1,-1,-1], blue: [-1,-1,-1,-1] },
      ranks: [], lastRoll: null, rollId: 0, last: null, msg: null, game: 0, teams: false, winTeam: null };
  }
  function startGame(s) {
    s.phase = 'play'; s.order = COLORS.filter(c => s.seats[c]); s.turn = s.order[0]; s.dice = null; s.sixes = 0;
    s.ranks = []; s.last = null; s.lastRoll = null; s.game = (s.game || 0) + 1;
    s.teams = !!s.teams && teamsOk(s); s.winTeam = null;
    COLORS.forEach(c => (s.pcs[c] = [-1, -1, -1, -1]));
    s.msg = { k: 'start', c: s.turn };
  }
  function legal(s, c, d) {
    const out = [];
    s.pcs[c].forEach((p, i) => { if (p < 0) { if (d === 6) out.push(i); } else if (p + d <= 56) out.push(i); });
    return out;
  }
  function nextTurn(s, extra) {
    s.dice = null; if (extra) return;
    s.sixes = 0; let i = s.order.indexOf(s.turn);
    for (let k = 0; k < 4; k++) { i = (i + 1) % s.order.length; if (!s.ranks.includes(s.order[i])) { s.turn = s.order[i]; return; } }
  }
  function roll(s) {
    const c = s.turn, d = 1 + rnd(6); s.rollId++; s.lastRoll = { c, d, id: s.rollId };
    s.sixes = d === 6 ? s.sixes + 1 : 0;
    if (s.sixes === 3) { s.msg = { k: 'three6', c }; nextTurn(s, false); return; }
    const mv = legal(s, c, d);
    if (!mv.length) { s.msg = { k: 'nomove', c, d }; nextTurn(s, false); return; }
    s.dice = d; s.msg = { k: 'rolled', c, d };
    if (new Set(mv.map(i => s.pcs[c][i])).size === 1) doMove(s, mv[0]);
  }
  function doMove(s, i) {
    const c = s.turn, d = s.dice, p = s.pcs[c][i], np = p < 0 ? 0 : p + d; s.pcs[c][i] = np; let cap = 0;
    if (np <= 50) {
      const g = gIdx(c, np);
      if (!SAFE.has(g)) s.order.forEach(o => { if (o === c || isMate(s, o, c)) return;   // takım arkadaşı kırılmaz
        s.pcs[o].forEach((q, j) => { if (q >= 0 && q <= 50 && gIdx(o, q) === g) { s.pcs[o][j] = -1; cap++; } }); });
    }
    s.last = { c, i, from: p, to: np, cap, id: s.rollId };
    const fin = np === 56;
    if (cap) s.msg = { k: 'cap', c };
    else if (fin) s.msg = { k: 'fin', c };
    if (s.pcs[c].every(q => q === 56) && !s.ranks.includes(c)) { s.ranks.push(c); s.msg = { k: 'done', c, r: s.ranks.length }; }
    if (s.teams) {
      const t = TEAM[c], mates = s.order.filter(x => TEAM[x] === t);
      if (mates.every(x => s.ranks.includes(x))) {
        s.order.forEach(x => { if (!s.ranks.includes(x)) s.ranks.push(x); });
        s.winTeam = t; s.phase = 'over'; s.dice = null; s.msg = { k: 'winTeam', c }; return;
      }
    } else {
      const rest = s.order.filter(x => !s.ranks.includes(x));
      if (rest.length <= 1) { s.ranks.push(...rest); s.phase = 'over'; s.dice = null; s.msg = { k: 'win', c: s.ranks[0] }; return; }
    }
    nextTurn(s, (d === 6 || cap > 0 || fin) && !s.ranks.includes(c));
    if (s.ranks.includes(c)) nextTurn(s, false);
  }
  /** Bir oyuncunun hamlesini uygular; sırası değilse ya da hamle geçersizse hiçbir şey yapmaz. */
  function applyAct(s, a, actor) {
    if (s.phase !== 'play' || !a || typeof a !== 'object') return false;
    const seat = s.seats[s.turn]; if (!seat || seat.pid !== actor) return false;
    if (a.t === 'roll' && s.dice == null) { roll(s); return true; }
    if (a.t === 'move' && s.dice != null && Number.isInteger(a.i) && legal(s, s.turn, s.dice).includes(a.i)) { doMove(s, a.i); return true; }
    return false;
  }
  function botPick(s) {
    const c = s.turn, d = s.dice, mv = legal(s, c, d); let best = mv[0], bs = -1e9;
    const opp = s.order.filter(o => o !== c && !s.ranks.includes(o) && !isMate(s, o, c));
    const threatAt = g => opp.some(o => s.pcs[o].some(q => q >= 0 && q <= 50 && [1,2,3,4,5,6].some(k => (gIdx(o, q) + k) % 52 === g)));
    for (const i of mv) {
      const p = s.pcs[c][i], np = p < 0 ? 0 : p + d; let sc = np * 0.3;
      if (np === 56) sc += 100; if (p < 0) sc += 40;
      if (np <= 50) {
        const g = gIdx(c, np);
        if (!SAFE.has(g) && opp.some(o => s.pcs[o].some(q => q >= 0 && q <= 50 && gIdx(o, q) === g))) sc += 70;
        if (SAFE.has(g)) sc += 15; else if (threatAt(g)) sc -= 25;
      } else sc += 20;
      if (p >= 0 && p <= 50 && !SAFE.has(gIdx(c, p)) && threatAt(gIdx(c, p))) sc += 12;
      sc += rnd(5);
      if (sc > bs) { bs = sc; best = i; }
    }
    return best;
  }
  /** Şu anki karar adımının kimliği: yeni bir karar gerektiğinde değişir. */
  function stepKey(s) { return s.phase === 'play' ? `${s.game}:${s.rollId}:${s.turn}:${s.dice == null ? 'r' : 'm'}` : ''; }
  /** Yeni bir karar adımı başladıysa insan oyuncu için 20 sn'lik süreyi başlatır. */
  function armTimer(s, now) {
    const k = stepKey(s); if (k === s.stepKey) return; s.stepKey = k;
    const se = s.phase === 'play' && s.seats[s.turn];
    s.turnEnds = se && !se.bot ? now + TURN_MS : null;
  }
  /** Süresi dolan oyuncu için hamleyi otomatik yapar. */
  function timeoutStep(s) { s.to = { c: s.turn, n: ((s.to && s.to.n) || 0) + 1 }; botStep(s); }
  /** Bot (ya da çevrimdışı oyuncu yerine) bir adım oynar. */
  function botStep(s) { if (s.dice == null) roll(s); else doMove(s, botPick(s)); }

  /* Sunucunun iki oyunu aynı şekilde yönetebilmesi için ortak arayüz. */
  const deadline = s => (s.phase === 'play' ? s.turnEnds || null : null);
  const botDelay = s => (s.dice == null ? 1100 : 900);
  const view = s => s;            // Ludo'da gizli bilgi yok
  const perPlayer = false;

  const E = { deadline, botDelay, view, perPlayer, COLORS, SEAT_ORDER, NAME, TRACK, OFF, HOME, SAFE, rnd, nk, gIdx, newState, startGame, legal, roll, doMove, applyAct, botPick, botStep, TURN_MS, stepKey, armTimer, timeoutStep, TEAM, TEAM_OF, MATE, isMate, teamsOk };
  if (typeof module !== 'undefined' && module.exports) module.exports = E; else window.LudoEngine = E;
})();
