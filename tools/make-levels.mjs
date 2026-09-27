// Builds the campaign levels 2, 3 and 5-9 (1 Tutorial, 4 Meerkat Maze and 10 The Original are
// made by hand / by make-original.mjs).
//
// Every level is a chain of areas ("zones"): the gate into the next zone needs a key that lies in
// the zone before it, as far from the entrance as possible. Harder levels have more keys, fewer
// loops (more dead ends), a smaller light circle and red zones right on the way.
// Each level is checked: winnable, every key needed, nothing important behind a crate. If a seed
// makes a bad level, the next seed is tried.
//
// Run: node tools/make-levels.mjs   ->  src/levels/<id>.json
import fs from 'node:fs';

const KEY = { yellow: 'y', blue: 'b', red: 'r', green: 'g', orange: 'o', pink: 'p' };

const LEVELS = [
  {
    id: 'sandy-start', name: 'Sandy Start', seed: 11, cw: 7, ch: 5, fogRadius: 6,
    zones: [[0, 0, 6, 4]], keys: [], loops: 0.18, coins: 8, gems: 0, crates: 0, strips: 0, star: false, jail: false,
    texts: ['Welcome to the desert! The exit is somewhere around here.', 'I like coins. Do you like coins?'],
  },
  {
    id: 'the-yellow-key', name: 'The Yellow Key', seed: 21, cw: 9, ch: 6, fogRadius: 5.5,
    zones: [[0, 0, 4, 5], [5, 0, 8, 5]], keys: ['yellow'], loops: 0.14, coins: 10, gems: 1, crates: 0, strips: 0, star: false, jail: false,
    texts: ['A gate! Somewhere there is a key of the same colour.', 'Keys never break. Keep them!'],
  },
  {
    id: 'crate-canyon', name: 'Crate Canyon', seed: 31, cw: 12, ch: 9, fogRadius: 5,
    zones: [[0, 0, 3, 8], [4, 0, 7, 8], [8, 0, 11, 8]], keys: ['yellow', 'blue'], loops: 0.12, coins: 14, gems: 3, crates: 6, strips: 1, star: false, jail: true,
    texts: ['Crates can be pushed. Try it!', 'Gems hide in dead ends.', 'Is this canyon made of sand or of crates?'],
  },
  {
    id: 'red-desert', name: 'Red Desert', seed: 41, cw: 14, ch: 10, fogRadius: 5,
    zones: [[0, 0, 4, 9], [5, 0, 9, 9], [10, 0, 13, 9]], keys: ['orange', 'red'], loops: 0.1, coins: 16, gems: 3, crates: 3, strips: 5, star: true, jail: true,
    texts: ['Red zones: walk through, never stop!', 'Five seconds is not very long...', 'I once stood still in a red zone. Once.'],
  },
  {
    id: 'dark-tunnels', name: 'Dark Tunnels', seed: 51, cw: 15, ch: 11, fogRadius: 4,
    zones: [[0, 0, 6, 5], [7, 0, 14, 5], [7, 6, 14, 10], [0, 6, 6, 10]], keys: ['yellow', 'green', 'blue'], loops: 0.08, coins: 18, gems: 4, crates: 3, strips: 3, star: true, jail: true,
    texts: ['It is dark in here. Use the map (M)!', 'Who turned off the sun?', 'A star makes everything bright for a while.'],
  },
  {
    id: 'colour-chain', name: 'Colour Chain', seed: 61, cw: 17, ch: 12, fogRadius: 4.5,
    zones: [[0, 0, 5, 5], [6, 0, 11, 5], [12, 0, 16, 5], [12, 6, 16, 11], [0, 6, 11, 11]], keys: ['red', 'orange', 'yellow', 'green'], loops: 0.05, coins: 20, gems: 4, crates: 4, strips: 4, star: true, jail: true,
    texts: ['Red, orange, yellow, green... like a rainbow!', 'Each key opens the next gate.', 'I lost my pink key. Oh wait, there is no pink key here.'],
  },
  {
    id: 'night-of-the-meerkats', name: 'Night of the Meerkats', seed: 71, cw: 20, ch: 15, fogRadius: 3.5,
    zones: [[0, 0, 6, 7], [7, 0, 13, 7], [14, 0, 19, 7], [14, 8, 19, 14], [7, 8, 13, 14], [0, 8, 6, 14]], keys: ['blue', 'pink', 'green', 'orange', 'red'], loops: 0.03, coins: 24, gems: 5, crates: 5, strips: 5, star: true, jail: true,
    texts: ['Shhh... the meerkats are sleeping.', 'So many dead ends! Use the map.', 'Five keys. FIVE!', 'Almost there... or not?'],
  },
];

function build(spec, seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return (s >>> 8) / 16777216; };
  const { cw: CW, ch: CH } = spec;
  const W = CW * 2 + 1, H = CH * 2 + 1;
  const g = Array.from({ length: H }, () => Array(W).fill('#'));
  const T = (cx, cy) => [cx * 2 + 1, cy * 2 + 1];
  const set = (x, y, ch) => { g[y][x] = ch; };
  const zoneOf = (cx, cy) => spec.zones.findIndex(([x0, y0, x1, y1]) => cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1);

  // 1) a maze inside every zone, plus some loops
  spec.zones.forEach(([x0, y0, x1, y1], zi) => {
    const seen = new Set([`${x0},${y0}`]);
    const stack = [[x0, y0]];
    set(...T(x0, y0), '.');
    while (stack.length) {
      const [cx, cy] = stack[stack.length - 1];
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [cx + dx, cy + dy])
        .filter(([nx, ny]) => zoneOf(nx, ny) === zi && !seen.has(`${nx},${ny}`));
      if (!nb.length) { stack.pop(); continue; }
      const [nx, ny] = nb[Math.floor(rnd() * nb.length)];
      seen.add(`${nx},${ny}`);
      const [ax, ay] = T(cx, cy), [bx, by] = T(nx, ny);
      set((ax + bx) / 2, (ay + by) / 2, '.'); set(bx, by, '.');
      stack.push([nx, ny]);
    }
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) for (const [dx, dy] of [[1, 0], [0, 1]]) {
      if (zoneOf(cx + dx, cy + dy) !== zi || rnd() > spec.loops) continue;
      const [ax, ay] = T(cx, cy); set(ax + dx, ay + dy, '.');
    }
  });

  // 2) gates between consecutive zones, at a random spot on their shared border
  const entries = [T(spec.zones[0][0], spec.zones[0][1])]; // where you enter each zone
  for (let zi = 0; zi + 1 < spec.zones.length; zi++) {
    const spots = [];
    for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) {
      if (zoneOf(cx, cy) !== zi) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (zoneOf(cx + dx, cy + dy) === zi + 1) spots.push([cx, cy, dx, dy]);
    }
    const [cx, cy, dx, dy] = spots[Math.floor(rnd() * spots.length)];
    const [tx, ty] = T(cx, cy);
    set(tx + dx, ty + dy, KEY[spec.keys[zi]].toUpperCase());
    entries.push([tx + 2 * dx, ty + 2 * dy]);
  }

  // distances inside one zone from its entrance (walking on floor, not through gates)
  const within = (zi, from) => {
    const dist = new Map([[`${from[0]},${from[1]}`, 0]]);
    const q = [from];
    while (q.length) {
      const [x, y] = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
        if (dist.has(k) || g[ny][nx] !== '.') continue;
        if (nx % 2 === 1 && ny % 2 === 1 && zoneOf((nx - 1) / 2, (ny - 1) / 2) !== zi) continue;
        dist.set(k, dist.get(`${x},${y}`) + 1); q.push([nx, ny]);
      }
    }
    return dist;
  };
  const cellsOf = zi => {
    const out = [];
    for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) if (zoneOf(cx, cy) === zi) out.push(T(cx, cy));
    return out;
  };
  const deadEnd = ([x, y]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => g[y + dy][x + dx] !== '#').length === 1;
  const free = ([x, y]) => g[y][x] === '.';

  // 3) start, keys (far from each zone's entrance), exit (far in the last zone)
  const [sx, sy] = entries[0];
  set(sx, sy, 'S');
  spec.keys.forEach((color, zi) => {
    const d = within(zi, entries[zi]);
    const far = [...d.entries()].filter(([k]) => { const [x, y] = k.split(',').map(Number); return x % 2 && y % 2 && free([x, y]); })
      .sort((a, b) => b[1] - a[1]);
    const [x, y] = far[0][0].split(',').map(Number);
    set(x, y, KEY[color]);
  });
  {
    const last = spec.zones.length - 1;
    const d = within(last, entries[last]);
    const far = [...d.entries()].filter(([k]) => { const [x, y] = k.split(',').map(Number); return x % 2 && y % 2 && free([x, y]); }).sort((a, b) => b[1] - a[1]);
    const [x, y] = far[0][0].split(',').map(Number);
    set(x, y, 'E');
  }

  // 4) jail: a dead end near the start becomes the cell, its opening becomes bars
  if (spec.jail) {
    const d = within(0, entries[0]);
    const cands = cellsOf(0).filter(c => free(c) && deadEnd(c) && d.has(`${c[0]},${c[1]}`)).sort((a, b) => d.get(`${a[0]},${a[1]}`) - d.get(`${b[0]},${b[1]}`));
    const cell = cands.find(c => d.get(`${c[0]},${c[1]}`) >= 3);
    if (cell) {
      const [x, y] = cell;
      const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => g[y + dy][x + dx] !== '#');
      set(x, y, 'L'); set(x + dx, y + dy, 'J');
    }
  }

  // 5) meerkats in dead ends, gems in other dead ends, star, coins
  const allCells = spec.zones.flatMap((_, zi) => cellsOf(zi));
  const shuffled = arr => arr.map(v => [rnd(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  const ends = shuffled(allCells.filter(c => free(c) && deadEnd(c)));
  for (let i = 0; i < spec.texts.length && ends.length; i++) { const [x, y] = ends.shift(); set(x, y, 'n'); }
  for (let i = 0; i < spec.gems && ends.length; i++) { const [x, y] = ends.shift(); set(x, y, '$'); }
  if (spec.star && ends.length) { const [x, y] = ends.shift(); set(x, y, '*'); }
  const open = shuffled(allCells.filter(free));
  for (let i = 0; i < spec.coins && open.length; i++) { const [x, y] = open.shift(); set(x, y, 'c'); }

  const rows = () => g.map(r => r.join(''));
  return { g, W, H, rows, rnd, entries };
}

// ---------- checks ----------
const KEYBIT = { y: 1, b: 2, r: 4, g: 8, o: 16, p: 32 };
function solve(rows, removed = '') {
  const H = rows.length;
  let start;
  for (let y = 0; y < H; y++) { const x = rows[y].indexOf('S'); if (x >= 0) start = [x, y]; }
  const seen = new Set([`${start[0]},${start[1]},0`]), q = [[...start, 0]], prev = new Map();
  while (q.length) {
    const [x, y, k] = q.shift();
    const ch = rows[y][x];
    if (ch === 'E') {
      const path = []; let id = `${x},${y},${k}`;
      while (id) { const [px, py] = id.split(',').map(Number); path.push([px, py]); id = prev.get(id); }
      return path.reverse();
    }
    const held = k | (removed.includes(ch) ? 0 : (KEYBIT[ch] ?? 0));
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, c = rows[ny]?.[nx];
      if (!c || '#Jnj@'.includes(c)) continue;
      const gate = KEYBIT[c.toLowerCase()];
      if (c !== c.toLowerCase() && gate && !'SELJ'.includes(c) && !(held & gate)) continue;
      const id = `${nx},${ny},${held}`;
      if (seen.has(id)) continue;
      seen.add(id); prev.set(id, `${x},${y},${k}`); q.push([nx, ny, held]);
    }
  }
  return null;
}

function finish(spec, b) {
  const { g, rows, rnd } = b;
  const path = solve(rows());
  if (!path) return null;
  for (const color of spec.keys) if (solve(rows(), KEY[color])) return null; // every key must be needed

  // red strips: 2-3 tiles on straight parts of the way to the exit (walk through, don't stop)
  let strips = 0;
  const onPath = new Set(path.map(([x, y]) => `${x},${y}`));
  const cand = path.slice(4, -4).filter(() => rnd() < 0.5);
  for (const [x, y] of cand) {
    if (strips >= spec.strips) break;
    const horiz = g[y][x - 1] !== '#' && g[y][x + 1] !== '#' && g[y - 1][x] === '#' && g[y + 1][x] === '#';
    const vert = g[y - 1][x] !== '#' && g[y + 1][x] !== '#' && g[y][x - 1] === '#' && g[y][x + 1] === '#';
    if (!horiz && !vert) continue;
    const [dx, dy] = horiz ? [1, 0] : [0, 1];
    const tiles = [[x - dx, y - dy], [x, y], [x + dx, y + dy]];
    if (!tiles.every(([tx, ty]) => g[ty][tx] === '.' && onPath.has(`${tx},${ty}`))) continue;
    if (tiles.some(([tx, ty]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ax, ay]) => g[ty + ay][tx + ax] === 't'))) continue;
    for (const [tx, ty] of tiles) g[ty][tx] = 't';
    strips++;
  }

  // crates only where nothing depends on pushing them
  let crates = 0;
  for (let tries = 0; tries < 800 && crates < spec.crates; tries++) {
    const x = 1 + Math.floor(rnd() * (b.W - 2)), y = 1 + Math.floor(rnd() * (b.H - 2));
    if (g[y][x] !== '.') continue;
    const horiz = g[y][x - 1] === '.' && g[y][x + 1] === '.' && g[y - 1][x] === '#' && g[y + 1][x] === '#';
    const vert = g[y - 1][x] === '.' && g[y + 1][x] === '.' && g[y][x - 1] === '#' && g[y][x + 1] === '#';
    if (!horiz && !vert) continue;
    g[y][x] = '#';
    const walled = rows().map(r => r.replaceAll('m', '#')); // earlier crates count as walls too
    const ok = !!solve(walled) && allReachable(walled);
    g[y][x] = ok ? 'm' : '.';
    if (ok) crates++;
  }
  return { rows: rows(), strips, crates, steps: path.length };
}

/** Every item (coins, gems, keys, star, exit, jail door) must stay reachable with all keys. */
function allReachable(rows) {
  const H = rows.length, W = rows[0].length;
  let start;
  for (let y = 0; y < H; y++) { const x = rows[y].indexOf('S'); if (x >= 0) start = [x, y]; }
  const seen = new Set([start.join(',')]), q = [start];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, c = rows[ny][nx];
      if ('#nj@'.includes(c) || seen.has(`${nx},${ny}`)) continue;
      seen.add(`${nx},${ny}`); q.push([nx, ny]);
    }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if ('c$ybrgopE*J'.includes(rows[y][x]) && !seen.has(`${x},${y}`)) return false;
  }
  return true;
}

fs.mkdirSync('src/levels', { recursive: true });
for (const spec of LEVELS) {
  let made = null, seed = spec.seed;
  for (let tries = 0; tries < 200 && !made; tries++, seed++) made = finish(spec, build(spec, seed));
  if (!made) throw new Error(`Could not make ${spec.name}`);
  const npcs = made.rows.join('').split('').filter(c => c === 'n').length;
  const level = {
    version: 1,
    name: spec.name,
    rows: made.rows,
    texts: spec.texts.slice(0, npcs),
    settings: { fogRadius: spec.fogRadius },
  };
  fs.writeFileSync(`src/levels/${spec.id}.json`, JSON.stringify(level, null, 2) + '\n');
  console.log(`${spec.name.padEnd(24)} ${made.rows[0].length}x${made.rows.length}  seed ${seed - 1}  keys ${spec.keys.length}  path ${made.steps}  red strips ${made.strips}  crates ${made.crates}  meerkats ${npcs}`);
}
