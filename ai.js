// Заслон — компьютерный соперник (negamax с альфа-бета отсечением).
(function (root) {
  const G = (typeof module !== 'undefined') ? require('./game.js') : root.Game;
  const WIN = 10000;

  function evaluate(s, me) {
    const op = 1 - me;
    const dm = G.dist(s, me), dop = G.dist(s, op);
    let sc = (dop - dm) * 12 + (s.wallsLeft[me] - s.wallsLeft[op]) * 3;
    // у соперника стенок нет и я ближе (с учётом очереди) — почти победа
    if (s.wallsLeft[op] === 0 && dm <= dop - (s.turn === me ? 0 : 1)) sc += 400;
    if (s.wallsLeft[me] === 0 && dop <= dm - (s.turn === op ? 0 : 1)) sc -= 400;
    return sc;
  }

  // стенки, которые режут кратчайший путь соперника или стоят рядом с ним
  function candidateWalls(s, me) {
    const op = 1 - me, seen = new Set(), out = [];
    const add = (t, x, y) => {
      if (x < 0 || y < 0 || x > 7 || y > 7) return;
      const k = t + (x * 10 + y);
      if (seen.has(k)) return; seen.add(k);
      const w = { t, x, y };
      if (G.wallFits(s, w)) out.push(w);
    };
    const p = G.path(s, op);
    if (p) {
      for (let i = 0; i + 1 < p.length && i < 7; i++) {
        const a = p[i], b = p[i + 1];
        if (a.x === b.x) { const yy = Math.min(a.y, b.y); add('h', a.x, yy); add('h', a.x - 1, yy); }
        else { const xx = Math.min(a.x, b.x); add('v', xx, a.y); add('v', xx, a.y - 1); }
      }
    }
    const o = s.pawns[op];
    for (let dx = -1; dx <= 0; dx++) for (let dy = -1; dy <= 0; dy++) { add('h', o.x + dx, o.y + dy); add('v', o.x + dx, o.y + dy); }
    return out;
  }

  function actions(s, me, withWalls) {
    const acts = G.pawnMoves(s, me).map(m => ({ type: 'move', x: m.x, y: m.y }));
    if (withWalls && s.wallsLeft[me] > 0) {
      for (const w of candidateWalls(s, me)) {
        if (G.checkWall(s, w, me) === 'ok') acts.push({ type: 'wall', t: w.t, x: w.x, y: w.y });
      }
    }
    return acts;
  }

  function negamax(s, depth, alpha, beta, me, ctx) {
    if (s.winner >= 0) return s.winner === me ? WIN + depth : -WIN - depth;
    if (depth === 0) return evaluate(s, me);
    if (++ctx.nodes > ctx.maxNodes) ctx.stop = true;
    let best = -Infinity;
    for (const a of actions(s, me, true)) {
      const c = G.clone(s); G.apply(c, a);
      const v = -negamax(c, depth - 1, -beta, -alpha, 1 - me, ctx);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta || ctx.stop) break;
    }
    return best;
  }

  const LEVELS = {
    easy: { depth: 1, noise: 22, wallChance: 0.35 },
    normal: { depth: 2, noise: 4, wallChance: 1 },
    hard: { depth: 3, noise: 0, wallChance: 1 },
  };

  function bestAction(s, level) {
    const L = LEVELS[level] || LEVELS.normal;
    const me = s.turn;
    // на лёгком компьютер не всегда думает про стенки
    const withWalls = Math.random() < L.wallChance;
    const acts = actions(s, me, withWalls);
    const ctx = { nodes: 0, maxNodes: 60000, stop: false };
    let best = null, bestV = -Infinity;
    for (const a of acts) {
      const c = G.clone(s); G.apply(c, a);
      let v = -negamax(c, L.depth - 1, -Infinity, Infinity, 1 - me, ctx);
      if (L.noise) v += (Math.random() * 2 - 1) * L.noise;
      if (v > bestV) { bestV = v; best = a; }
    }
    // запасной вариант: шаг по кратчайшему пути
    if (!best) {
      const p = G.path(s, me);
      best = p && p[1] ? { type: 'move', x: p[1].x, y: p[1].y } : acts[0];
    }
    return best;
  }

  const api = { bestAction, evaluate, LEVELS };
  if (typeof module !== 'undefined') module.exports = api; else root.AI = api;
})(this);
