// Заслон — интерфейс, режимы и онлайн.
(function () {
  'use strict';
  const C = 10, GAP = 2, S = C + GAP, TOTAL = 9 * C + 8 * GAP; // 106
  const NS = 'http://www.w3.org/2000/svg';
  const COLORS = ['var(--p1)', 'var(--p2)'];
  const LOCAL_NAMES = ['Янтарный', 'Бирюзовый'];
  const LEVEL_NAMES = { easy: 'лёгкий', normal: 'средний', hard: 'сложный' };
  const SAVE_KEY = 'zaslon-save-v1';
  const PREFIX = 'zaslon-v1-';
  const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  const $ = id => document.getElementById(id);
  const svg = $('board');

  // ---------- состояние ----------
  let st = Game.newGame();
  let mode = 'local';       // local | ai | online
  let me = 0;               // за кого играю (ai/online)
  let flip = false;         // перевернуть поле, чтобы моя фишка была снизу
  let level = 'normal';
  let aiFirst = false;
  let history = [];
  let startTime = Date.now();
  let tool = 'move';
  let ghost = null;         // {t,x,y}
  let orient = 'h';
  let aiToken = 0, aiThinking = false;
  let winShown = false;

  // ---------- экраны ----------
  function show(name) {
    document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== 's-' + name; });
    if (name === 'menu') refreshMenu();
    if (name === 'game') wake(true); else wake(false);
  }
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => show(b.dataset.go)));

  let toastTimer;
  function toast(text) {
    const t = $('toast'); t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }

  let confirmCb = null;
  function ask(text, yes, cb) {
    $('confirm-text').textContent = text; $('confirm-yes').textContent = yes || 'Да';
    confirmCb = cb; $('confirm').hidden = false;
  }
  $('confirm-no').onclick = () => { $('confirm').hidden = true; confirmCb = null; };
  $('confirm-yes').onclick = () => { $('confirm').hidden = true; const cb = confirmCb; confirmCb = null; if (cb) cb(); };

  let lock = null;
  async function wake(on) {
    try {
      if (on && !lock && navigator.wakeLock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); }
      if (!on && lock) { await lock.release(); lock = null; }
    } catch (e) { lock = null; }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('s-game').hidden) wake(true); });

  // ---------- сохранение ----------
  function ser(s) {
    return { pawns: s.pawns, h: [...s.h], v: [...s.v], wallsLeft: s.wallsLeft, turn: s.turn, winner: s.winner, moves: s.moves, wallsPlaced: s.wallsPlaced };
  }
  function deser(o) {
    return { pawns: [{ ...o.pawns[0] }, { ...o.pawns[1] }], h: new Set(o.h), v: new Set(o.v), wallsLeft: o.wallsLeft.slice(), turn: o.turn, winner: o.winner, moves: o.moves, wallsPlaced: o.wallsPlaced.slice() };
  }
  function save() {
    if (mode === 'online') return;
    try {
      if (st.winner >= 0) { localStorage.removeItem(SAVE_KEY); return; }
      localStorage.setItem(SAVE_KEY, JSON.stringify({ mode, me, flip, level, aiFirst, startTime, st: ser(st), history: history.map(ser) }));
    } catch (e) { /* нет хранилища — просто не сохраняем */ }
  }
  function loadSave() {
    try { const o = JSON.parse(localStorage.getItem(SAVE_KEY)); return o && o.st ? o : null; } catch (e) { return null; }
  }
  function refreshMenu() {
    const o = loadSave();
    $('b-continue').hidden = !o;
    if (o) $('continue-info').textContent = (o.mode === 'ai' ? 'против компьютера, ' + LEVEL_NAMES[o.level] : 'вдвоём на одном устройстве') + ' · ход ' + (o.st.moves + 1);
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    $('b-install').hidden = !!standalone;
  }

  // ---------- запуск партий ----------
  function begin(m, opts) {
    cancelAI();
    mode = m; st = Game.newGame(); history = []; startTime = Date.now();
    me = opts.me || 0; flip = me === 1; tool = 'move'; ghost = null; winShown = false;
    $('win').hidden = true;
    setTool('move');
    show('game'); render(); save();
    if (mode === 'ai' && st.turn !== me) scheduleAI();
  }
  $('b-local').onclick = () => begin('local', {});
  $('b-ai').onclick = () => show('ai');
  $('levels').addEventListener('click', e => {
    const b = e.target.closest('.choice'); if (!b) return;
    level = b.dataset.level;
    document.querySelectorAll('#levels .choice').forEach(c => c.classList.toggle('on', c === b));
  });
  $('first').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    aiFirst = b.dataset.first === 'ai';
    document.querySelectorAll('#first button').forEach(c => c.classList.toggle('on', c === b));
  });
  $('b-ai-start').onclick = () => begin('ai', { me: aiFirst ? 1 : 0 });
  $('b-rules').onclick = () => show('rules');
  $('b-install').onclick = () => show('install');
  $('b-continue').onclick = () => {
    const o = loadSave(); if (!o) return;
    cancelAI();
    mode = o.mode; me = o.me; flip = o.flip; level = o.level; aiFirst = o.aiFirst; startTime = o.startTime;
    st = deser(o.st); history = (o.history || []).map(deser); winShown = false;
    setTool('move'); show('game'); render();
    if (mode === 'ai' && st.turn !== me) scheduleAI();
  };

  // ---------- ходы ----------
  function canAct() {
    if (st.winner >= 0 || aiThinking) return false;
    if (mode === 'local') return true;
    if (mode === 'online' && !net.connected) return false;
    return st.turn === me;
  }

  function doAction(a, remote) {
    const before = Game.clone(st);
    if (!Game.apply(st, a)) return false;
    history.push(before);
    if (mode === 'online' && !remote) send({ type: 'act', a, state: ser(st) });
    ghost = null; setTool('move');
    if (navigator.vibrate) { try { navigator.vibrate(a.type === 'wall' ? 18 : 8); } catch (e) {} }
    render(); save();
    if (st.winner >= 0) setTimeout(showWin, 450);
    else if (mode === 'ai' && st.turn !== me) scheduleAI();
    return true;
  }

  function cancelAI() { aiToken++; aiThinking = false; }
  function scheduleAI() {
    const token = ++aiToken; aiThinking = true; render();
    const t0 = Date.now();
    setTimeout(() => {
      if (token !== aiToken) return;
      const a = AI.bestAction(Game.clone(st), level);
      const wait = Math.max(0, 500 - (Date.now() - t0));
      setTimeout(() => {
        if (token !== aiToken) return;
        aiThinking = false;
        doAction(a);
      }, wait);
    }, 60);
  }

  // ---------- инструменты ----------
  function setTool(t) {
    if (t === 'wall' && st.wallsLeft[st.turn] <= 0) { toast('Стенки закончились'); t = 'move'; }
    tool = t;
    document.querySelectorAll('#mode button').forEach(b => b.classList.toggle('on', b.dataset.mode === t));
    $('wallbar').hidden = t !== 'wall';
    if (t !== 'wall') ghost = null;
  }
  $('mode').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    setTool(b.dataset.mode); render();
  });
  $('b-rotate').onclick = () => {
    orient = orient === 'h' ? 'v' : 'h';
    if (ghost) ghost = { ...ghost, t: orient };
    else ghost = defaultGhost();
    render();
  };
  $('b-place').onclick = () => {
    if (!ghost || !canAct()) return;
    const r = Game.checkWall(st, ghost);
    if (r !== 'ok') { toast(wallReason(r)); return; }
    doAction({ type: 'wall', t: ghost.t, x: ghost.x, y: ghost.y });
  };
  function defaultGhost() {
    // рядом с фишкой соперника, по её пути
    const op = st.pawns[1 - st.turn];
    const y = st.turn === 0 ? Math.min(7, op.y) : Math.max(0, op.y - 1);
    return { t: orient, x: Math.min(7, Math.max(0, op.x - (orient === 'h' ? 0 : 1))), y: Math.min(7, Math.max(0, y)) };
  }
  function wallReason(r) {
    return r === 'overlap' ? 'Здесь стенка пересекается с другой'
      : r === 'blocks' ? 'Нельзя полностью перекрыть путь'
      : r === 'nowalls' ? 'Стенки закончились' : '';
  }

  // ---------- касания ----------
  function logicalPoint(e) {
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return flip ? { x: TOTAL - p.x, y: TOTAL - p.y } : { x: p.x, y: p.y };
  }
  function ghostAt(p, chooseOrient) {
    const clamp = v => Math.min(7, Math.max(0, v));
    const ix = clamp(Math.round((p.x - (C + GAP / 2)) / S));
    const iy = clamp(Math.round((p.y - (C + GAP / 2)) / S));
    if (chooseOrient) {
      const dx = p.x - (ix * S + C + GAP / 2), dy = p.y - (iy * S + C + GAP / 2);
      if (Math.abs(dx) > Math.abs(dy) + 1) orient = 'h';
      else if (Math.abs(dy) > Math.abs(dx) + 1) orient = 'v';
    }
    return { t: orient, x: ix, y: iy };
  }
  let dragging = false;
  svg.addEventListener('pointerdown', e => {
    if (!canAct()) {
      if (st.winner < 0 && mode !== 'local') toast(aiThinking ? 'Компьютер думает…' : (mode === 'online' && !net.connected ? 'Нет связи с другом' : 'Сейчас ход соперника'));
      return;
    }
    const p = logicalPoint(e);
    if (tool === 'move') {
      const x = Math.floor(p.x / S), y = Math.floor(p.y / S);
      if (x < 0 || y < 0 || x > 8 || y > 8) return;
      if (Game.pawnMoves(st).some(m => m.x === x && m.y === y)) doAction({ type: 'move', x, y });
      return;
    }
    e.preventDefault();
    dragging = true; try { svg.setPointerCapture(e.pointerId); } catch (_) {}
    ghost = ghostAt(p, true); render();
  });
  svg.addEventListener('pointermove', e => {
    if (!dragging || tool !== 'wall') return;
    const g = ghostAt(logicalPoint(e), false);
    if (!ghost || g.x !== ghost.x || g.y !== ghost.y) { ghost = g; render(); }
  });
  const endDrag = () => { dragging = false; };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  // ---------- отрисовка ----------
  function el(tag, attrs) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
  const vx = x => flip ? 8 - x : x;
  const vw = w => flip ? { t: w.t, x: 7 - w.x, y: 7 - w.y } : w;
  function wallRect(w, fill, extra) {
    w = vw(w);
    const a = w.t === 'h'
      ? { x: w.x * S, y: w.y * S + C + .15, width: 2 * C + GAP, height: GAP - .3 }
      : { x: w.x * S + C + .15, y: w.y * S, width: GAP - .3, height: 2 * C + GAP };
    return el('rect', Object.assign(a, { rx: .9, fill }, extra || {}));
  }

  let pawnEls = null;
  function render() {
    const layers = svg.querySelector('#layers') || svg.appendChild(el('g', { id: 'layers' }));
    layers.textContent = '';
    const mine = canAct();
    const moves = mine && tool === 'move' ? Game.pawnMoves(st) : [];
    const pc = COLORS[st.turn];

    // полосы цели: у края, куда идёт игрок
    const topOwner = flip ? 1 : 0; // кто идёт к верхнему краю на экране
    layers.appendChild(el('rect', { x: 0, y: -2.6, width: TOTAL, height: 1.1, rx: .55, fill: COLORS[topOwner], opacity: .75 }));
    layers.appendChild(el('rect', { x: 0, y: TOTAL + 1.5, width: TOTAL, height: 1.1, rx: .55, fill: COLORS[1 - topOwner], opacity: .75 }));

    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
      const hi = moves.some(m => m.x === x && m.y === y);
      layers.appendChild(el('rect', { class: 'cell', x: vx(x) * S, y: vx(y) * S, width: C, height: C, rx: 1.6, fill: hi ? 'var(--cell-hi)' : 'var(--cell)', style: hi ? 'cursor:pointer' : '' }));
      if (hi) layers.appendChild(el('circle', { cx: vx(x) * S + C / 2, cy: vx(y) * S + C / 2, r: 1.5, fill: pc, opacity: .85, 'pointer-events': 'none' }));
    }
    Game.wallList(st).forEach(w => layers.appendChild(wallRect(w, 'var(--wall)')));
    let reason = '';
    if (tool === 'wall' && ghost && mine) {
      const r = Game.checkWall(st, ghost);
      reason = r === 'ok' ? '' : wallReason(r);
      layers.appendChild(wallRect(ghost, r === 'ok' ? 'var(--wall)' : 'var(--bad)', { opacity: .55, stroke: r === 'ok' ? 'var(--wall)' : 'var(--bad)', 'stroke-width': .4 }));
      $('b-place').disabled = r !== 'ok';
    } else $('b-place').disabled = true;

    // фишки — постоянные элементы, чтобы ход анимировался
    if (!pawnEls) {
      pawnEls = [0, 1].map(i => el('circle', { class: 'pawn', r: 3.7, fill: COLORS[i], 'pointer-events': 'none' }));
    }
    pawnEls.forEach((c, i) => {
      const p = st.pawns[i];
      c.setAttribute('cx', vx(p.x) * S + C / 2); c.setAttribute('cy', vx(p.y) * S + C / 2);
      c.setAttribute('stroke', i === st.turn && st.winner < 0 ? 'var(--fg)' : 'none');
      c.setAttribute('stroke-width', .7);
      if (!c.parentNode) svg.appendChild(c);
    });

    renderPanels();
    renderHint(reason);
    const myTurnWalls = st.wallsLeft[st.turn] > 0;
    document.querySelector('#mode [data-mode="wall"]').disabled = !mine || !myTurnWalls;
    document.querySelector('#mode [data-mode="move"]').disabled = !mine;
    $('b-undo').hidden = mode === 'online';
    $('b-restart').hidden = mode === 'online';
    $('b-undo').disabled = !history.length;
  }

  function nameOf(p) {
    if (mode === 'local') return LOCAL_NAMES[p];
    if (p === me) return 'Ты';
    return mode === 'ai' ? 'Компьютер · ' + LEVEL_NAMES[level] : 'Друг';
  }
  function renderPanels() {
    const bottom = flip ? 1 : 0, top = 1 - bottom;
    [[$('p-top'), top], [$('p-bot'), bottom]].forEach(([elx, p]) => {
      elx.style.setProperty('--pc', COLORS[p]);
      elx.querySelector('.name').textContent = nameOf(p);
      elx.classList.toggle('turn', st.turn === p && st.winner < 0);
      const box = elx.querySelector('.walls'); box.textContent = '';
      for (let i = 0; i < Game.WALLS; i++) { const s = document.createElement('i'); if (i >= st.wallsLeft[p]) s.className = 'used'; box.appendChild(s); }
      box.setAttribute('aria-label', 'Стенок осталось: ' + st.wallsLeft[p]);
    });
    $('p-top').classList.toggle('flip', mode === 'local');
  }
  function renderHint(reason) {
    let t;
    if (st.winner >= 0) t = 'Партия окончена';
    else if (mode === 'online' && !net.connected) t = 'Связь с другом потеряна';
    else if (aiThinking) t = 'Компьютер думает…';
    else if (!canAct()) t = 'Ходит друг…';
    else if (tool === 'wall') t = reason || (ghost ? 'Нажми «Поставить», чтобы закончить ход' : 'Коснись щели между клетками');
    else {
      const left = st.wallsLeft[st.turn];
      t = (mode === 'local' ? 'Ходит ' + LOCAL_NAMES[st.turn].toLowerCase() : 'Твой ход') + ' · до цели ' + Game.dist(st, st.turn) + ' · стенок ' + left;
    }
    $('hint').textContent = t;
  }

  // ---------- победа ----------
  function showWin() {
    if (st.winner < 0 || winShown) return;
    winShown = true;
    const w = st.winner;
    let title, sub;
    if (mode === 'local') { title = LOCAL_NAMES[w] + ' победил!'; sub = 'Фишка дошла до края первой'; }
    else if (w === me) { title = 'Победа!'; sub = 'Твоя фишка дошла первой'; }
    else { title = 'Поражение'; sub = (mode === 'ai' ? 'Компьютер' : 'Друг') + ' дошёл первым'; }
    $('win-title').textContent = title; $('win-sub').textContent = sub;
    $('win-dot').style.setProperty('--pc', COLORS[w]);
    $('st-moves').textContent = st.moves;
    $('st-walls').textContent = st.wallsPlaced[0] + st.wallsPlaced[1];
    const sec = Math.round((Date.now() - startTime) / 1000);
    $('st-time').textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    $('b-rematch').disabled = false; $('b-rematch').textContent = 'Реванш';
    if (mode === 'online') { net.wantRematch = false; if (net.peerRematch) $('win-sub').textContent = 'Друг хочет реванш'; }
    $('win').hidden = false;
  }
  $('b-win-board').onclick = () => { $('win').hidden = true; };
  $('b-win-menu').onclick = () => { $('win').hidden = true; leaveGame(); };
  $('b-rematch').onclick = () => {
    if (mode === 'online') {
      if (!net.connected) { toast('Друг уже вышел'); return; }
      net.wantRematch = true; send({ type: 'rematch' });
      $('b-rematch').disabled = true; $('b-rematch').textContent = 'Ждём друга…';
      tryRematch();
      return;
    }
    begin(mode, { me });
  };

  // ---------- кнопки игры ----------
  $('b-menu').onclick = () => {
    if (mode === 'online' && net.connected && st.winner < 0) ask('Выйти из онлайн-партии? Друг увидит, что ты вышел.', 'Выйти', leaveGame);
    else leaveGame();
  };
  function leaveGame() {
    cancelAI(); save();
    if (mode === 'online') { send({ type: 'bye' }); netCleanup(); }
    show('menu');
  }
  $('b-restart').onclick = () => ask('Начать партию заново?', 'Заново', () => begin(mode, { me }));
  $('b-undo').onclick = () => {
    if (!history.length || mode === 'online') return;
    cancelAI();
    let prev = history.pop();
    if (mode === 'ai') { while (prev.turn !== me && history.length) prev = history.pop(); }
    st = prev; winShown = false; $('win').hidden = true; ghost = null; setTool('move');
    render(); save();
    if (mode === 'ai' && st.turn !== me) scheduleAI();
  };

  // ---------- онлайн (PeerJS, прямое соединение между устройствами) ----------
  const net = { peer: null, conn: null, role: null, code: null, connected: false, hostColor: 0, wantRematch: false, peerRematch: false, timer: null };

  function send(msg) { try { if (net.conn && net.conn.open) net.conn.send(msg); } catch (e) {} }
  function netCleanup() {
    clearTimeout(net.timer);
    try { if (net.conn) net.conn.close(); } catch (e) {}
    try { if (net.peer) net.peer.destroy(); } catch (e) {}
    Object.assign(net, { peer: null, conn: null, role: null, code: null, connected: false, wantRematch: false, peerRematch: false });
  }
  function status(id, text, cls) {
    const s = $(id); s.hidden = !text; s.textContent = text || ''; s.className = 'status' + (cls ? ' ' + cls : '');
  }
  function resetOnlineUI() {
    $('room-code').hidden = true; $('b-share').hidden = true; $('b-host').hidden = false; $('b-host').disabled = false;
    $('b-join').disabled = false; status('host-status'); status('join-status');
  }
  $('b-online').onclick = () => { netCleanup(); resetOnlineUI(); show('online'); };
  $('b-online-back').onclick = () => { netCleanup(); show('menu'); };

  function newCode() { let c = ''; for (let i = 0; i < 4; i++) c += CODE_ABC[Math.floor(Math.random() * CODE_ABC.length)]; return c; }
  function netError(e) {
    const t = e && e.type;
    if (t === 'peer-unavailable') return 'Комната не найдена. Проверь код, и пусть друг не закрывает приложение.';
    if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return 'Нет связи с сервером. Проверь интернет.';
    if (t === 'browser-incompatible') return 'Этот браузер не поддерживает онлайн-игру.';
    return 'Не удалось подключиться. Попробуй ещё раз.';
  }

  function host(attempt) {
    attempt = attempt || 0;
    netCleanup(); resetOnlineUI();
    if (typeof Peer === 'undefined') { status('host-status', 'Онлайн-модуль не загрузился. Проверь интернет.', 'err'); return; }
    net.role = 'host'; net.code = newCode();
    $('b-host').disabled = true; status('host-status', 'Создаём комнату…', 'wait');
    const peer = net.peer = new Peer(PREFIX + net.code, { debug: 0 });
    peer.on('open', () => {
      $('room-code').textContent = net.code; $('room-code').hidden = false;
      $('b-host').hidden = true; $('b-share').hidden = false;
      status('host-status', 'Ждём, когда друг войдёт…', 'wait');
    });
    peer.on('connection', c => {
      if (net.conn && net.conn.open) { c.on('open', () => { c.send({ type: 'busy' }); setTimeout(() => c.close(), 300); }); return; }
      attach(c);
    });
    peer.on('disconnected', () => { if (!net.connected && net.peer === peer) { try { peer.reconnect(); } catch (e) {} } });
    peer.on('error', e => {
      if (net.peer !== peer) return;
      if (e.type === 'unavailable-id' && attempt < 4) { host(attempt + 1); return; }
      if (!net.connected) { $('b-host').disabled = false; $('b-host').hidden = false; status('host-status', netError(e), 'err'); }
    });
  }
  function join(code) {
    code = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 4) { status('join-status', 'Код состоит из 4 символов', 'err'); return; }
    netCleanup(); resetOnlineUI();
    if (typeof Peer === 'undefined') { status('join-status', 'Онлайн-модуль не загрузился. Проверь интернет.', 'err'); return; }
    net.role = 'guest'; net.code = code;
    $('b-join').disabled = true; status('join-status', 'Подключаемся…', 'wait');
    const peer = net.peer = new Peer({ debug: 0 });
    peer.on('open', () => { attach(peer.connect(PREFIX + code, { reliable: true })); });
    peer.on('error', e => {
      if (net.peer !== peer || net.connected) return;
      $('b-join').disabled = false; status('join-status', netError(e), 'err');
    });
    net.timer = setTimeout(() => {
      if (net.peer === peer && !net.connected) { $('b-join').disabled = false; status('join-status', 'Друг не отвечает. Проверь код и интернет.', 'err'); try { peer.destroy(); } catch (e) {} }
    }, 15000);
  }
  function attach(c) {
    net.conn = c;
    c.on('open', () => {
      clearTimeout(net.timer);
      net.connected = true;
      if (net.role === 'host') { net.hostColor = 0; send({ type: 'start', hostColor: 0 }); startOnline(0); }
    });
    c.on('data', onData);
    c.on('close', onClosed);
    c.on('error', onClosed);
  }
  function startOnline(color) {
    net.wantRematch = false; net.peerRematch = false;
    begin('online', { me: color });
    toast(color === 0 ? 'Ты янтарный и ходишь первым' : 'Ты бирюзовый, первым ходит друг');
  }
  function onData(m) {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'start' && net.role === 'guest') startOnline(1 - m.hostColor);
    else if (m.type === 'act') {
      if (mode !== 'online') return;
      if (!doAction(m.a, true) && m.state) { st = deser(m.state); render(); if (st.winner >= 0) setTimeout(showWin, 300); }
    } else if (m.type === 'rematch') {
      net.peerRematch = true;
      if (!$('win').hidden && !net.wantRematch) $('win-sub').textContent = 'Друг хочет реванш';
      else if ($('win').hidden) toast('Друг хочет реванш');
      tryRematch();
    } else if (m.type === 'busy') {
      status('join-status', 'В этой комнате уже играют', 'err'); $('b-join').disabled = false;
    } else if (m.type === 'bye') onClosed();
  }
  function tryRematch() {
    if (!(net.wantRematch && net.peerRematch) || net.role !== 'host') return;
    net.hostColor = 1 - net.hostColor; // меняемся, кто ходит первым
    send({ type: 'start', hostColor: net.hostColor });
    startOnline(net.hostColor);
  }
  function onClosed() {
    if (!net.connected) return;
    net.connected = false;
    if (mode === 'online' && !$('s-game').hidden) {
      toast('Друг вышел из игры'); render();
      if (!$('win').hidden) { $('b-rematch').disabled = true; $('win-sub').textContent = 'Друг вышел из игры'; }
    }
  }

  $('b-host').onclick = () => host(0);
  $('b-join').onclick = () => join($('join-code').value);
  $('join-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); });
  $('join-code').addEventListener('keydown', e => { if (e.key === 'Enter') join(e.target.value); });
  $('b-share').onclick = async () => {
    const url = location.origin + location.pathname + '#room-' + net.code;
    const text = 'Сыграем в Заслон? Код комнаты: ' + net.code;
    try {
      if (navigator.share) { await navigator.share({ title: 'Заслон', text, url }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text + '\n' + url); status('host-status', 'Ссылка скопирована. Ждём друга…', 'wait'); }
    catch (e) { status('host-status', 'Скажи другу код ' + net.code + '. Ждём…', 'wait'); }
  };

  // ---------- установка ----------
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('b-install-now').hidden = false; });
  $('b-install-now').onclick = async () => { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch (e) {} installEvt = null; $('b-install-now').hidden = true; };
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  // ---------- старт ----------
  show('menu');
  const m = location.hash.match(/^#room-([A-Za-z0-9]{4})$/);
  if (m) {
    try { window.history.replaceState(null, '', location.pathname); } catch (e) {}
    resetOnlineUI(); show('online');
    $('join-code').value = m[1].toUpperCase();
    join(m[1]);
  }
})();
