/* Son Kart — kart oyunu kural motoru. Hem sunucu (Node) hem tarayıcı kullanır.
   s.msg bir olaydır ({k, c, ...}); ekran kendi dilinde yazar.
   Oyuncular Ludo ile aynı koltuk anahtarlarını kullanır (red/green/yellow/blue),
   bu yalnızca oyuncu kimliğidir; kartların rengiyle karıştırılmamalı. */
(function () {
  const COLORS = ['red', 'green', 'yellow', 'blue'];        // koltuk sırası = oynama sırası
  const SEAT_ORDER = ['red', 'yellow', 'green', 'blue'];    // odaya giriş sırası
  const NAME = { red: 'Kırmızı', green: 'Yeşil', yellow: 'Sarı', blue: 'Mavi' };
  const SUITS = ['red', 'yellow', 'green', 'blue'];         // kart renkleri
  const HAND0 = 7;             // başlangıç el büyüklüğü
  const TURN_MS = 20000;       // bir hamle için süre
  const CALL_MS = 4500;        // "Son kart!" deme süresi
  const CALL_PEN = 2;          // demezse çekilen ceza kartı

  function rnd(n) {
    const c = typeof globalThis !== 'undefined' && globalThis.crypto;
    if (c && c.getRandomValues) { const a = new Uint32Array(1); c.getRandomValues(a); return a[0] % n; }
    return Math.floor(Math.random() * n);
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  const nk = (s, c) => (s.seats[c] ? s.seats[c].nick : NAME[c]);

  /** 108 kartlık deste: her renkte bir 0, ikişer 1-9, ikişer atla/ters/+2; 4 joker, 4 joker+4. */
  function buildDeck() {
    const d = [];
    SUITS.forEach(c => {
      d.push({ c, v: '0' });
      for (let n = 1; n <= 9; n++) { d.push({ c, v: String(n) }); d.push({ c, v: String(n) }); }
      ['skip', 'rev', 'draw2'].forEach(v => { d.push({ c, v }); d.push({ c, v }); });
    });
    for (let i = 0; i < 4; i++) { d.push({ c: 'wild', v: 'wild' }); d.push({ c: 'wild', v: 'draw4' }); }
    return d;
  }

  function newState() {
    return { v: 1, seq: 0, phase: 'lobby', seats: { red: null, green: null, yellow: null, blue: null },
      order: [], turn: null, dir: 1, deck: [], discard: [], hands: { red: [], green: [], yellow: [], blue: [] },
      color: null, drawn: null, call: null, ranks: [], msg: null, game: 0, moves: 0,
      turnEnds: null, stepKey: '' };
  }

  function startGame(s) {
    s.phase = 'play'; s.order = COLORS.filter(c => s.seats[c]); s.dir = 1;
    s.ranks = []; s.drawn = null; s.call = null; s.game = (s.game || 0) + 1; s.moves = 0;
    s.deck = shuffle(buildDeck());
    COLORS.forEach(c => (s.hands[c] = []));
    s.order.forEach(c => { for (let i = 0; i < HAND0; i++) s.hands[c].push(s.deck.pop()); });
    // İlk kart joker olmasın: joker çıkarsa destenin altına konur.
    let first = s.deck.pop();
    while (first.c === 'wild') { s.deck.unshift(first); first = s.deck.pop(); }
    s.discard = [first]; s.color = first.c; s.turn = s.order[0];
    s.msg = { k: 'start', c: s.turn };
    // İlk kart etki kartıysa etkisi ilk oyuncuya uygulanır.
    if (first.v === 'skip') s.turn = nextActive(s, s.turn);
    else if (first.v === 'rev') { if (active(s).length > 2) { s.dir = -1; s.turn = nextActive(s, s.turn); } else s.turn = nextActive(s, s.turn); }
    else if (first.v === 'draw2') { drawCards(s, s.turn, 2); s.turn = nextActive(s, s.turn); }
    return s;
  }

  const active = s => s.order.filter(c => !s.ranks.includes(c));
  /** Sıradaki oyuncu: bitirenleri atlar, yönü dikkate alır. */
  function nextActive(s, from, step) {
    const act = active(s); if (!act.length) return from;
    const n = s.order.length; let i = s.order.indexOf(from);
    for (let k = 0; k < n * 2; k++) {
      i = (i + (step || 1) * s.dir + n * 2) % n;
      if (!s.ranks.includes(s.order[i])) return s.order[i];
    }
    return from;
  }
  const top = s => s.discard[s.discard.length - 1];

  /** Elin i. kartı şu an oynanabilir mi? Joker+4 yalnızca elde o renkten kart yokken. */
  function canPlay(s, p, i) {
    const hand = s.hands[p], card = hand[i]; if (!card) return false;
    if (card.c === 'wild') {
      if (card.v !== 'draw4') return true;
      return !hand.some((x, j) => j !== i && x.c === s.color);
    }
    return card.c === s.color || card.v === top(s).v;
  }
  function legal(s, p) { const out = []; s.hands[p].forEach((_, i) => { if (canPlay(s, p, i)) out.push(i); }); return out; }

  /** Deste bitince ıskarta (en üstteki hariç) karıştırılıp deste olur. */
  function refill(s) {
    if (s.deck.length || s.discard.length < 2) return;
    const keep = s.discard.pop();
    s.deck = shuffle(s.discard.map(c => (c.c === 'wild' ? { c: 'wild', v: c.v } : c)));
    s.discard = [keep];
  }
  function drawCards(s, p, n) {
    let got = 0;
    for (let k = 0; k < n; k++) { refill(s); if (!s.deck.length) break; s.hands[p].push(s.deck.pop()); got++; }
    return got;
  }

  /** Bir oyuncu elini bitirdiğinde sıralamaya eklenir; tek kişi kalınca oyun biter. */
  function checkOut(s, p) {
    if (s.hands[p].length || s.ranks.includes(p)) return false;
    s.ranks.push(p); s.call = null;
    s.msg = { k: 'out', c: p, r: s.ranks.length };
    const rest = active(s);
    if (rest.length <= 1) {
      s.ranks.push(...rest); s.phase = 'over'; s.turnEnds = null;
      s.msg = { k: 'win', c: s.ranks[0] };
      return true;
    }
    return false;
  }

  function playCard(s, i, wildColor, now) {
    const p = s.turn, hand = s.hands[p];
    const card = hand.splice(i, 1)[0];
    s.discard.push(card); s.drawn = null; s.moves++;
    s.color = card.c === 'wild' ? (SUITS.includes(wildColor) ? wildColor : SUITS[rnd(4)]) : card.c;
    const ev = { k: 'play', c: p, card: { c: card.c, v: card.v }, col: s.color }; s.msg = ev;

    let skip = 0, draw = 0;
    if (card.v === 'skip') skip = 1;
    else if (card.v === 'rev') { if (active(s).length > 2) s.dir *= -1; else skip = 1; }
    else if (card.v === 'draw2') { draw = 2; skip = 1; }
    else if (card.v === 'draw4') { draw = 4; skip = 1; }

    // Son karta düşen oyuncu süresi içinde "Son kart!" demeli.
    if (hand.length === 1) s.call = { p, by: now + CALL_MS, done: !!(s.seats[p] && s.seats[p].bot) };
    if (checkOut(s, p)) return;

    const nxt = nextActive(s, p);
    // Oynanan kartın sonucu aynı mesaja eklenir: "… +2 oynadı. Ayşe 2 kart çekti."
    if (draw) { drawCards(s, nxt, draw); ev.eff = { k: 'drewN', c: nxt, n: draw }; }
    else if (skip) ev.eff = { k: 'skipped', c: nxt };
    else if (card.v === 'rev') ev.eff = { k: 'rev' };
    s.turn = skip ? nextActive(s, nxt) : nxt;
  }

  /** Kart çeker: çekilen oynanabiliyorsa oyuncu isterse onu oynar, istemezse pas geçer. */
  function drawTurn(s, now) {
    const p = s.turn; s.moves++;
    const got = drawCards(s, p, 1);
    if (!got) { s.drawn = null; s.turn = nextActive(s, p); s.msg = { k: 'nodeck', c: p }; return; }
    const i = s.hands[p].length - 1;
    s.msg = { k: 'drew', c: p };
    if (canPlay(s, p, i)) { s.drawn = i; }
    else { s.drawn = null; s.turn = nextActive(s, p); }
  }
  function passTurn(s) { const p = s.turn; s.moves++; s.drawn = null; s.turn = nextActive(s, p); s.msg = { k: 'passed', c: p }; }

  /** Süresi dolan "Son kart!" çağrısını cezalandırır. */
  function callPenalty(s) {
    const cl = s.call; if (!cl || cl.done) { s.call = null; return false; }
    s.call = null;
    if (s.hands[cl.p].length !== 1 || s.ranks.includes(cl.p)) return false;
    drawCards(s, cl.p, CALL_PEN); s.moves++;
    s.msg = { k: 'penalty', c: cl.p, n: CALL_PEN };
    return true;
  }

  function applyAct(s, a, actor, now) {
    if (s.phase !== 'play' || !a || typeof a !== 'object') return false;
    now = now || Date.now();
    // "Son kart!" sırası beklemeden, kartı düşen oyuncu tarafından söylenir.
    if (a.t === 'call') {
      const cl = s.call, seat = cl && s.seats[cl.p];
      if (!cl || cl.done || !seat || seat.pid !== actor) return false;
      cl.done = true; s.msg = { k: 'called', c: cl.p }; s.moves++; return true;
    }
    const seat = s.seats[s.turn]; if (!seat || seat.pid !== actor) return false;
    if (a.t === 'play' && Number.isInteger(a.i) && canPlay(s, s.turn, a.i)) {
      if (s.drawn != null && a.i !== s.drawn) return false;   // çektikten sonra yalnızca o kart oynanır
      playCard(s, a.i, a.col, now); return true;
    }
    if (a.t === 'draw' && s.drawn == null) { drawTurn(s, now); return true; }
    if (a.t === 'pass' && s.drawn != null) { passTurn(s); return true; }
    return false;
  }

  /* ---------------- bot ---------------- */
  const POINTS = { skip: 20, rev: 20, draw2: 20, wild: 50, draw4: 50 };
  const cardVal = c => (POINTS[c.v] != null ? POINTS[c.v] : Number(c.v) || 0);
  /** Elde en çok bulunan renk; joker oynarken bu seçilir. */
  function bestColor(s, p) {
    const n = {}; SUITS.forEach(c => (n[c] = 0));
    s.hands[p].forEach(c => { if (c.c !== 'wild') n[c.c]++; });
    let best = SUITS[rnd(4)], bv = -1;
    SUITS.forEach(c => { if (n[c] > bv) { bv = n[c]; best = c; } });
    return best;
  }
  /** Bot hamlesi: rakibi az kartlıysa saldırır, jokeri sona saklar. */
  function botChoice(s) {
    const p = s.turn;
    const mv = s.drawn != null ? (canPlay(s, p, s.drawn) ? [s.drawn] : []) : legal(s, p);
    if (!mv.length) return s.drawn != null ? { t: 'pass' } : { t: 'draw' };
    const nxt = nextActive(s, p), nxtN = s.hands[nxt] ? s.hands[nxt].length : 7;
    let best = mv[0], bs = -1e9;
    for (const i of mv) {
      const card = s.hands[p][i]; let sc = 0;
      if (card.c === 'wild') sc -= card.v === 'draw4' ? 28 : 34;     // jokeri elde tut
      else sc += 10 + cardVal(card) * 0.35;
      if (nxtN <= 2 && (card.v === 'draw2' || card.v === 'draw4' || card.v === 'skip' || card.v === 'rev')) sc += 55;
      if (card.c !== 'wild' && card.c === s.color) sc += 6;          // renk zincirini sürdür
      const same = s.hands[p].filter(x => x.c === card.c).length;
      if (card.c !== 'wild') sc += same * 1.5;
      if (s.hands[p].length === 2) sc += cardVal(card) * 0.4;        // bitirirken yüksek kartı at
      sc += rnd(4);
      if (sc > bs) { bs = sc; best = i; }
    }
    const card = s.hands[p][best];
    return { t: 'play', i: best, col: card.c === 'wild' ? bestColor(s, p) : undefined };
  }
  /** Bot (ya da süresi dolan oyuncu yerine) bir hamle yapar. */
  function botStep(s, now) {
    now = now || Date.now();
    const a = botChoice(s);
    if (a.t === 'play') playCard(s, a.i, a.col, now);
    else if (a.t === 'draw') drawTurn(s, now);
    else passTurn(s);
  }
  const botDelay = s => (s.drawn != null ? 700 : 1000);

  /* ---------------- zamanlayıcı ---------------- */
  function stepKey(s) { return s.phase === 'play' ? `${s.game}:${s.turn}:${s.moves}` : ''; }
  function armTimer(s, now) {
    const k = stepKey(s); if (k === s.stepKey) return; s.stepKey = k;
    const se = s.phase === 'play' && s.seats[s.turn];
    s.turnEnds = se && !se.bot ? now + TURN_MS : null;
  }
  /** Bekleyen en yakın zaman sınırı: hamle süresi ya da "Son kart!" süresi. */
  function deadline(s) {
    if (s.phase !== 'play') return null;
    const a = s.turnEnds || null, b = s.call && !s.call.done ? s.call.by : null;
    if (a && b) return Math.min(a, b);
    return a || b;
  }
  /** Süresi dolan ne varsa uygular. */
  function timeoutStep(s, now) {
    now = now || Date.now();
    const cl = s.call && !s.call.done ? s.call.by : null;
    if (cl && (!s.turnEnds || cl <= s.turnEnds)) { callPenalty(s); return; }
    s.to = { c: s.turn, n: ((s.to && s.to.n) || 0) + 1 };
    botStep(s, now);
  }

  /* ---------------- oyuncuya özel görünüm ---------------- */
  /** Herkese tek durum gönderilemez: eller ve deste gizlidir. */
  function view(s, pid) {
    const seat = COLORS.find(c => s.seats[c] && !s.seats[c].bot && s.seats[c].pid === pid) || null;
    const o = {};
    for (const k in s) if (k !== 'deck' && k !== 'discard' && k !== 'hands') o[k] = s[k];
    o.counts = {}; COLORS.forEach(c => { o.counts[c] = s.hands[c] ? s.hands[c].length : 0; });
    o.deckN = s.deck.length; o.discardN = s.discard.length;
    o.top = s.discard.length ? s.discard[s.discard.length - 1] : null;
    o.seat = seat; o.hand = seat && s.hands[seat] ? s.hands[seat] : [];
    o.can = seat && s.phase === 'play' && s.turn === seat
      ? (s.drawn != null ? (canPlay(s, seat, s.drawn) ? [s.drawn] : []) : legal(s, seat)) : [];
    return o;
  }
  const teamsOk = () => false;
  const perPlayer = true;      // her oyuncu yalnızca kendi elini görür

  const E = { perPlayer, COLORS, SEAT_ORDER, NAME, SUITS, TURN_MS, CALL_MS, HAND0, rnd, nk, buildDeck,
    newState, startGame, legal, canPlay, playCard, drawTurn, passTurn, callPenalty, applyAct,
    botChoice, botStep, botDelay, stepKey, armTimer, deadline, timeoutStep, view, teamsOk,
    active, nextActive, top, bestColor, cardVal };
  if (typeof module !== 'undefined' && module.exports) module.exports = E; else window.CardsEngine = E;
})();
