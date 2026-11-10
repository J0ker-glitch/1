// Заслон — правила игры (без интерфейса).
// Поле 9x9. Игрок 0 (янтарный) стартует снизу (4,8) и идёт к y=0.
// Игрок 1 (бирюзовый) стартует сверху (4,0) и идёт к y=8.
// Стенка: {t:'h'|'v', x, y}, x,y в 0..7 — координата перекрестья.
//   'h' лежит под рядом y, закрывает клетки x и x+1;
//   'v' лежит справа от колонки x, закрывает ряды y и y+1.
(function (root) {
  const N = 9;
  const WALLS = 10;
  const GOAL = [0, N - 1];

  function newGame() {
    return {
      pawns: [{ x: 4, y: 8 }, { x: 4, y: 0 }],
      h: new Set(), v: new Set(),
      wallsLeft: [WALLS, WALLS],
      turn: 0, winner: -1,
      moves: 0, wallsPlaced: [0, 0],
    };
  }
  function clone(s) {
    return {
      pawns: [{ ...s.pawns[0] }, { ...s.pawns[1] }],
      h: new Set(s.h), v: new Set(s.v),
      wallsLeft: s.wallsLeft.slice(), turn: s.turn, winner: s.winner,
      moves: s.moves, wallsPlaced: s.wallsPlaced.slice(),
    };
  }
  const key = (x, y) => x * 10 + y;

  // можно ли пройти из (x,y) в соседнюю (nx,ny)
  function open(s, x, y, nx, ny) {
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) return false;
    if (nx === x) { // вертикальное движение, проверяем горизонтальные стенки
      const yy = Math.min(y, ny);
      return !s.h.has(key(x, yy)) && !s.h.has(key(x - 1, yy));
    }
    const xx = Math.min(x, nx);
    return !s.v.has(key(xx, y)) && !s.v.has(key(xx, y - 1));
  }

  const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

  // кратчайшее расстояние до цели (BFS), -1 если пути нет
  function dist(s, p) {
    const start = s.pawns[p], goal = GOAL[p];
    if (start.y === goal) return 0;
    const seen = new Uint8Array(100);
    let q = [start.x, start.y], d = 0;
    seen[key(start.x, start.y)] = 1;
    while (q.length) {
      d++;
      const nq = [];
      for (let i = 0; i < q.length; i += 2) {
        const x = q[i], y = q[i + 1];
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy;
          if (!open(s, x, y, nx, ny)) continue;
          const k = key(nx, ny);
          if (seen[k]) continue;
          if (ny === goal) return d;
          seen[k] = 1; nq.push(nx, ny);
        }
      }
      q = nq;
    }
    return -1;
  }

  // один из кратчайших путей (список клеток), для ИИ
  function path(s, p) {
    const start = s.pawns[p], goal = GOAL[p];
    const prev = new Int16Array(100).fill(-1);
    const sk = key(start.x, start.y);
    prev[sk] = sk;
    let q = [start.x, start.y];
    while (q.length) {
      const nq = [];
      for (let i = 0; i < q.length; i += 2) {
        const x = q[i], y = q[i + 1];
        if (y === goal) {
          const out = []; let k = key(x, y);
          while (k !== sk) { out.push({ x: Math.floor(k / 10), y: k % 10 }); k = prev[k]; }
          out.push({ x: start.x, y: start.y });
          return out.reverse();
        }
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy;
          if (!open(s, x, y, nx, ny)) continue;
          const k = key(nx, ny);
          if (prev[k] !== -1) continue;
          prev[k] = key(x, y); nq.push(nx, ny);
        }
      }
      q = nq;
    }
    return null;
  }

  function pawnMoves(s, p) {
    p = p === undefined ? s.turn : p;
    const me = s.pawns[p], op = s.pawns[1 - p], out = [];
    for (const [dx, dy] of DIRS) {
      const nx = me.x + dx, ny = me.y + dy;
      if (!open(s, me.x, me.y, nx, ny)) continue;
      if (nx === op.x && ny === op.y) {
        const jx = nx + dx, jy = ny + dy;
        if (open(s, nx, ny, jx, jy)) out.push({ x: jx, y: jy });
        else { // прыжок вбок по диагонали
          const side = dx === 0 ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];
          for (const [sx, sy] of side) {
            const tx = nx + sx, ty = ny + sy;
            if (open(s, nx, ny, tx, ty)) out.push({ x: tx, y: ty });
          }
        }
      } else out.push({ x: nx, y: ny });
    }
    return out;
  }

  // проверка стенки без проверки путей
  function wallFits(s, w) {
    if (w.x < 0 || w.y < 0 || w.x > N - 2 || w.y > N - 2) return false;
    const k = key(w.x, w.y);
    if (s.h.has(k) || s.v.has(k)) return false; // то же место или крест
    if (w.t === 'h') return !s.h.has(key(w.x - 1, w.y)) && !s.h.has(key(w.x + 1, w.y));
    return !s.v.has(key(w.x, w.y - 1)) && !s.v.has(key(w.x, w.y + 1));
  }
  // 'ok' | 'nowalls' | 'overlap' | 'blocks'
  function checkWall(s, w, p) {
    p = p === undefined ? s.turn : p;
    if (s.wallsLeft[p] <= 0) return 'nowalls';
    if (!wallFits(s, w)) return 'overlap';
    const set = w.t === 'h' ? s.h : s.v, k = key(w.x, w.y);
    set.add(k);
    const ok = dist(s, 0) >= 0 && dist(s, 1) >= 0;
    set.delete(k);
    return ok ? 'ok' : 'blocks';
  }

  // действие: {type:'move',x,y} | {type:'wall',t,x,y}. Меняет s. true если ход принят.
  function apply(s, a) {
    if (s.winner >= 0) return false;
    const p = s.turn;
    if (a.type === 'move') {
      if (!pawnMoves(s, p).some(m => m.x === a.x && m.y === a.y)) return false;
      s.pawns[p] = { x: a.x, y: a.y };
      if (a.y === GOAL[p]) s.winner = p;
    } else if (a.type === 'wall') {
      const w = { t: a.t, x: a.x, y: a.y };
      if (checkWall(s, w, p) !== 'ok') return false;
      (w.t === 'h' ? s.h : s.v).add(key(w.x, w.y));
      s.wallsLeft[p]--; s.wallsPlaced[p]++;
    } else return false;
    s.moves++;
    if (s.winner < 0) s.turn = 1 - p;
    return true;
  }

  function wallList(s) {
    const out = [];
    s.h.forEach(k => out.push({ t: 'h', x: Math.floor(k / 10), y: k % 10 }));
    s.v.forEach(k => out.push({ t: 'v', x: Math.floor(k / 10), y: k % 10 }));
    return out;
  }

  const api = { N, WALLS, GOAL, newGame, clone, open, dist, path, pawnMoves, wallFits, checkWall, apply, wallList, key };
  if (typeof module !== 'undefined') module.exports = api; else root.Game = api;
})(this);
