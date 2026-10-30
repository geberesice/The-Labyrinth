// Minigames: short games with their own rules, in a maze that is made fresh every time.
//   Find the Key      the exit is locked: find the key in the dark (hot / cold tells you how close you are)
//   The Floor Is Red  parts of the floor flash, then turn red. Don't be standing there! Last 60 seconds.
//   Coin Rush         grab as many coins as you can in 60 seconds.
// Pure logic, no DOM: the levels are made from a seed, so host and friends build the same one.
import type { LevelData } from '../level-format';
import { isWall, type Level } from '../level';

export type MinigameId = 'find-the-key' | 'floor-is-red' | 'coin-rush';

export interface MinigameInfo {
  id: MinigameId;
  name: string;
  blurb: string;
  /** big words on the screen when the game starts */
  goal: string;
  /** seconds; the game ends when the time is up */
  timeLimit: number;
  /** when the time is up you win (you lasted) or lose (too slow) */
  timeUp: 'win' | 'lose';
  /** what a better result means: a lower time or more coins */
  best: 'time' | 'coins';
}

export const MINIGAMES: MinigameInfo[] = [
  {
    id: 'find-the-key', name: 'Find the Key', goal: 'FIND THE KEY!', timeLimit: 180, timeUp: 'lose', best: 'time',
    blurb: 'The exit is locked. The key is hidden somewhere in the dark. Hot or cold?',
  },
  {
    id: 'floor-is-red', name: 'The Floor Is Red', goal: 'THE FLOOR IS RED!', timeLimit: 60, timeUp: 'win', best: 'coins',
    blurb: 'When the floor flashes, run! Red floor costs a heart. Last 60 seconds.',
  },
  {
    id: 'coin-rush', name: 'Coin Rush', goal: 'GRAB THE COINS!', timeLimit: 60, timeUp: 'win', best: 'coins',
    blurb: 'As many coins as you can in 60 seconds. Go go go!',
  },
];

export function minigameInfo(id: MinigameId): MinigameInfo {
  return MINIGAMES.find(m => m.id === id)!;
}

export function isMinigame(v: unknown): v is MinigameId {
  return MINIGAMES.some(m => m.id === v);
}

export const FLOOR_RULES = {
  lives: 3,
  hurtSeconds: 2, // after the red floor got you, it can't get you again for a moment
  grace: 3, // seconds before the first flash
};

/** A new random seed for a new maze. */
export function newSeed(): number {
  return 1 + Math.floor(Math.random() * 2 ** 31);
}

/** Make the level for a minigame. The same seed always makes the same level. */
export function makeMinigame(id: MinigameId, seed: number): LevelData {
  switch (id) {
    case 'find-the-key': return findTheKey(seed);
    case 'floor-is-red': return floorIsRed(seed);
    case 'coin-rush': return coinRush(seed);
  }
}

// ---------------- making the levels ----------------

function random(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) >>> 0; return (s >>> 8) / 16777216; };
}

type Grid = string[][];

/** A maze of cw x ch cells (walls between them), plus some loops so it is not too mean. */
function maze(cw: number, ch: number, loops: number, rnd: () => number): Grid {
  const W = cw * 2 + 1, H = ch * 2 + 1;
  const g: Grid = Array.from({ length: H }, () => Array(W).fill('#'));
  const seen = new Set(['0,0']);
  const stack = [[0, 0]];
  g[1][1] = '.';
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [cx + dx, cy + dy])
      .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < cw && ny < ch && !seen.has(`${nx},${ny}`));
    if (!nb.length) { stack.pop(); continue; }
    const [nx, ny] = nb[Math.floor(rnd() * nb.length)];
    seen.add(`${nx},${ny}`);
    g[cy + ny + 1][cx + nx + 1] = '.';
    g[ny * 2 + 1][nx * 2 + 1] = '.';
    stack.push([nx, ny]);
  }
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    if (cx + 1 < cw && rnd() < loops) g[cy * 2 + 1][cx * 2 + 2] = '.';
    if (cy + 1 < ch && rnd() < loops) g[cy * 2 + 2][cx * 2 + 1] = '.';
  }
  return g;
}

/** Steps from (x, y) to every tile, or -1 where you can't get to. */
function distances(W: number, H: number, open: (x: number, y: number) => boolean, x: number, y: number): Int32Array {
  const d = new Int32Array(W * H).fill(-1);
  if (!open(x, y)) return d;
  d[y * W + x] = 0;
  const queue = [y * W + x];
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi], cx = i % W, cy = (i - cx) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || !open(nx, ny) || d[ny * W + nx] >= 0) continue;
      d[ny * W + nx] = d[i] + 1;
      queue.push(ny * W + nx);
    }
  }
  return d;
}

/** Steps from (x, y) to every tile of a level (gates count as open), -1 = can't get there. */
export function distanceMap(level: Level, x: number, y: number): Int32Array {
  return distances(level.width, level.height, (tx, ty) => !isWall(level, tx, ty), x, y);
}

const floorCells = (g: Grid) => g.flatMap((r, y) => r.flatMap((c, x) => (c === '.' ? [[x, y] as [number, number]] : [])));
const isDeadEnd = (g: Grid, x: number, y: number) =>
  g[y][x] === '.' && [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => g[y + dy]?.[x + dx] !== '#').length === 1;

function pick<T>(list: T[], rnd: () => number): T | undefined {
  return list.length ? list.splice(Math.floor(rnd() * list.length), 1)[0] : undefined;
}

/**
 * Find the Key: you start on the left, right next to the exit, but a yellow gate is in the way.
 * The key lies in one of the dead ends far away.
 */
function findTheKey(seed: number): LevelData {
  const rnd = random(seed);
  const CW = 12, CH = 8;
  const g = maze(CW, CH, 0.06, rnd);
  const W = g[0].length, H = g.length;
  const sx = 1, sy = Math.floor(CH / 2) * 2 + 1;
  g[sy][sx] = 'S';
  const d = distances(W, H, (x, y) => g[y][x] !== '#', sx, sy);
  const far = Math.max(...d);
  const ends = floorCells(g).filter(([x, y]) => isDeadEnd(g, x, y));
  // the key: a dead end far away (but not always the farthest one)
  const key = pick(ends.filter(([x, y]) => d[y * W + x] >= far * 0.7), rnd)
    ?? ends.sort(([ax, ay], [bx, by]) => d[by * W + bx] - d[ay * W + ax])[0];
  g[key[1]][key[0]] = 'y';
  // a meerkat who lost the key waits in the dead end nearest the start
  const texts: string[] = [];
  const near = ends.filter(([x, y]) => g[y][x] === '.' && d[y * W + x] >= 2).sort(([ax, ay], [bx, by]) => d[ay * W + ax] - d[by * W + bx])[0];
  if (near) { g[near[1]][near[0]] = 'n'; texts.push('I lost the key! Hot means you are close. Cold means far away.'); }
  const gem = pick(ends.filter(([x, y]) => g[y][x] === '.'), rnd);
  if (gem) g[gem[1]][gem[0]] = '$';
  const free = floorCells(g);
  for (let i = 0; i < 10; i++) { const c = pick(free, rnd); if (c) g[c[1]][c[0]] = 'c'; }
  // the exit sits in a little room left of the start, behind the yellow gate
  g[sy][0] = 'Y';
  const rows = g.map((r, y) => (y === sy ? '#E' : '##') + r.join(''));
  return { version: 1, name: 'Find the Key', rows, texts, settings: { fogRadius: 4.5, minigame: 'find-the-key', seed } };
}

/** The Floor Is Red: an open sandy square with four pillars. */
function floorIsRed(seed: number): LevelData {
  const rnd = random(seed);
  const W = 15, H = 11;
  const g: Grid = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) =>
    x === 0 || y === 0 || x === W - 1 || y === H - 1 || ((x === 4 || x === 10) && (y === 3 || y === 7)) ? '#' : '.'));
  g[5][7] = 'S';
  const free = floorCells(g);
  for (let i = 0; i < 12; i++) { const c = pick(free, rnd); if (c) g[c[1]][c[0]] = 'c'; }
  return { version: 1, name: 'The Floor Is Red', rows: g.map(r => r.join('')), texts: [], settings: { fogRadius: 30, minigame: 'floor-is-red', seed } };
}

/** Coin Rush: a maze with lots of loops and coins everywhere. */
function coinRush(seed: number): LevelData {
  const rnd = random(seed);
  const CW = 11, CH = 8;
  const g = maze(CW, CH, 0.3, rnd);
  g[Math.floor(CH / 2) * 2 + 1][Math.floor(CW / 2) * 2 + 1] = 'S'; // start in the middle
  const ends = floorCells(g).filter(([x, y]) => isDeadEnd(g, x, y));
  for (let i = 0; i < 4; i++) { const c = pick(ends, rnd); if (c) g[c[1]][c[0]] = '$'; }
  const star = pick(ends, rnd);
  if (star) g[star[1]][star[0]] = '*';
  const free = floorCells(g);
  const coins = Math.floor(free.length * 0.5);
  for (let i = 0; i < coins; i++) { const c = pick(free, rnd); if (c) g[c[1]][c[0]] = 'c'; }
  return { version: 1, name: 'Coin Rush', rows: g.map(r => r.join('')), texts: [], settings: { fogRadius: 5.5, minigame: 'coin-rush', seed } };
}

// ---------------- the floor is red ----------------

/** One flash of the floor: `red` tiles flash from warnAt, are red from redAt and cool down at endAt. */
export interface FloorWave { warnAt: number; redAt: number; endAt: number; red: Uint8Array }

/**
 * Every flash of a Floor Is Red game, worked out at the start from the seed (so friends get the
 * same ones). They come faster and cover more floor as time goes on. Every tile always has a safe
 * tile close enough to run to while the floor flashes (`stepTime` = seconds per step).
 */
export function floorWaves(level: Level, seed: number, stepTime: number, duration: number): FloorWave[] {
  const rnd = random(seed * 7 + 3);
  const W = level.width, H = level.height;
  const cx = (W - 1) / 2, cy = (H - 1) / 2;
  const waves: FloorWave[] = [];
  let t = FLOOR_RULES.grace, last = -1;
  while (t < duration) {
    const k = Math.min(1, t / duration); // 0 at the start, 1 at the end
    const warn = 1.6 - 0.6 * k, red = 1.4 + 0.6 * k, gap = 0.8 - 0.4 * k;
    const o = Math.floor(rnd() * 3), ox = Math.floor(rnd() * 3), oy = Math.floor(rnd() * 3), side = Math.floor(rnd() * 4);
    const ring = 1 + Math.floor(rnd() * 3), coverage = 0.45 + 0.25 * k;
    const patterns: ((x: number, y: number) => boolean)[] = [
      (_, y) => (y + o) % 2 === 0, // stripes
      (x) => (x + o) % 2 === 0,
      (_, y) => (y + o) % 3 !== 0, // wide stripes
      (x) => (x + o) % 3 !== 0,
      (x, y) => (x + y + o) % 2 === 0, // checkerboard
      (x, y) => (Math.floor((x + ox) / 2) + Math.floor((y + oy) / 2)) % 2 === 0, // big checkerboard
      (x, y) => Math.max(Math.abs(x - cx) - 2, Math.abs(y - cy)) >= ring + 1, // the edges
      (x, y) => Math.max(Math.abs(x - cx) - 2, Math.abs(y - cy)) < ring + 1, // the middle
      () => rnd() < coverage, // anywhere
      ...(warn >= 1.3 ? [(x: number, y: number) => [x < cx, x > cx, y < cy, y > cy][side]] : []), // half of it
      ...(k > 0.5 ? [(x: number, y: number) => !((x + ox) % 3 === 0 && (y + oy) % 3 === 0)] : []), // only small islands are safe
    ];
    let p = Math.floor(rnd() * patterns.length);
    if (p === last) p = (p + 1) % patterns.length;
    last = p;
    const red_ = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!isWall(level, x, y) && patterns[p](x, y)) red_[y * W + x] = 1;
    // fair: wherever you stand, a safe tile is close enough to reach before the floor turns red
    const reach = Math.max(1, Math.floor(warn / stepTime) - 2);
    const safeDist = distancesFrom(level, i => !red_[i]);
    for (let i = 0; i < red_.length; i++) if (red_[i] && (safeDist[i] < 0 || safeDist[i] > reach)) red_[i] = 0;
    waves.push({ warnAt: t, redAt: t + warn, endAt: t + warn + red, red: red_ });
    t += warn + red + gap;
  }
  return waves;
}

/** Steps from the nearest tile where `from(i)` is true (-1 = none can be reached). */
function distancesFrom(level: Level, from: (i: number) => boolean): Int32Array {
  const W = level.width;
  const d = new Int32Array(W * level.height).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < d.length; i++) if (!isWall(level, i % W, Math.floor(i / W)) && from(i)) { d[i] = 0; queue.push(i); }
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi], x = i % W, y = (i - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, j = ny * W + nx;
      if (isWall(level, nx, ny) || d[j] >= 0) continue;
      d[j] = d[i] + 1;
      queue.push(j);
    }
  }
  return d;
}

/** The flash going on at `time`, if any. */
export function waveAt(waves: readonly FloorWave[], time: number): FloorWave | undefined {
  return waves.find(w => time >= w.warnAt && time < w.endAt);
}

/** Is tile (x, y) flashing ('warn') or red at `time`? */
export function floorAt(level: Level, waves: readonly FloorWave[], time: number, x: number, y: number): 'warn' | 'red' | null {
  const w = waveAt(waves, time);
  if (!w || x < 0 || y < 0 || x >= level.width || y >= level.height || !w.red[y * level.width + x]) return null;
  return time >= w.redAt ? 'red' : 'warn';
}

// ---------------- find the key: hot or cold ----------------

export const HEAT = [
  { label: 'ON FIRE!', color: '#ff3a1a' },
  { label: 'HOT', color: '#ff7a2a' },
  { label: 'WARM', color: '#ffc04a' },
  { label: 'COLD', color: '#7cc6ff' },
  { label: 'FREEZING', color: '#c8e8ff' },
];

/** How hot you are: 0 (on fire, right there) to 4 (freezing), from your steps to the thing and the farthest anything can be. */
export function heat(steps: number, farthest: number): number {
  if (steps < 0) return 4;
  if (steps <= 2) return 0;
  const r = steps / Math.max(1, farthest);
  return r < 0.15 ? 1 : r < 0.35 ? 2 : r < 0.6 ? 3 : 4;
}
