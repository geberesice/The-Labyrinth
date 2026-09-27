// Builds "The Original": the paper maze, turned into a level.
// The areas sit where they are on the drawing; the passages between them are generated
// (seeded, so it is the same maze every time) and then checked to be winnable.
//
// Run: node tools/make-original.mjs   ->  src/levels/the-original.json
import fs from 'node:fs';

const CW = 24, CH = 18; // maze cells; the tile grid is (2*CW+1) x (2*CH+1)
const W = CW * 2 + 1, H = CH * 2 + 1;
let seed = Number(process.argv[2] ?? 20260927);
const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) / 16777216; };

// ---------- areas (in cell coordinates), placed like on the drawing ----------
// cells not in a listed zone belong to the nearest zone by the lists order below
const ZONES = {
  start: { x0: 0, y0: 11, x1: 7, y1: 17 },   // bottom left: S and the jail
  upleft: { x0: 0, y0: 0, x1: 7, y1: 10 },   // top left: green key, blue gem, yellow key
  top: { x0: 8, y0: 0, x1: 19, y1: 4 },      // top middle: "M, no here" meerkat, orange key
  hall: { x0: 8, y0: 5, x1: 18, y1: 10 },    // the big hall in the middle
  bottom: { x0: 8, y0: 11, x1: 16, y1: 17 }, // bottom middle: the star
  sun: { x0: 17, y0: 11, x1: 23, y1: 17 },   // bottom right: spiky sun meerkat, red key
  exit: { x0: 19, y0: 0, x1: 23, y1: 10 },   // right: treasure room and the exit
};
const zoneOf = (cx, cy) => Object.entries(ZONES).find(([, z]) => cx >= z.x0 && cx <= z.x1 && cy >= z.y0 && cy <= z.y1)?.[0];

// ---------- grid ----------
const g = Array.from({ length: H }, () => Array(W).fill('#'));
const T = (cx, cy) => [cx * 2 + 1, cy * 2 + 1]; // cell -> tile
const set = (x, y, ch) => { g[y][x] = ch; };

// 1) perfect maze inside every zone (recursive backtracker), then some extra openings (loops)
const seen = new Set();
for (const [name, z] of Object.entries(ZONES)) {
  if (name === 'hall') continue; // the hall is one big room
  // start from a cell that really belongs to this zone (zones listed earlier win overlaps)
  let first = null;
  for (let cy = z.y0; cy <= z.y1 && !first; cy++) for (let cx = z.x0; cx <= z.x1 && !first; cx++) if (zoneOf(cx, cy) === name) first = [cx, cy];
  const stack = [first];
  seen.add(`${first[0]},${first[1]}`);
  set(...T(first[0], first[1]), '.');
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dy]) => [cx + dx, cy + dy])
      .filter(([nx, ny]) => zoneOf(nx, ny) === name && !seen.has(`${nx},${ny}`));
    if (!nb.length) { stack.pop(); continue; }
    const [nx, ny] = nb[Math.floor(rnd() * nb.length)];
    seen.add(`${nx},${ny}`);
    const [ax, ay] = T(cx, cy), [bx, by] = T(nx, ny);
    set((ax + bx) / 2, (ay + by) / 2, '.');
    set(bx, by, '.');
    stack.push([nx, ny]);
  }
  // loops: knock out ~12% of the inner walls so there is more than one way around
  for (let cy = z.y0; cy <= z.y1; cy++) for (let cx = z.x0; cx <= z.x1; cx++) {
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      if (zoneOf(cx, cy) !== name || zoneOf(cx + dx, cy + dy) !== name || rnd() > 0.12) continue;
      const [ax, ay] = T(cx, cy);
      set(ax + dx, ay + dy, '.');
    }
  }
}

// 2) the hall: a wide open room, with a little stage for "Yes! Right is always right."
{
  const [x0, y0] = T(ZONES.hall.x0, ZONES.hall.y0), [x1, y1] = T(ZONES.hall.x1, ZONES.hall.y1);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, '.');
}

// 3) doors between zones: open passages, or gates that need a key
const door = (a, b, ch, where) => {
  // `where` = cell in zone a next to zone b; open the wall between them
  const [cx, cy] = where;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => zoneOf(cx + dx, cy + dy) === b);
  if (zoneOf(cx, cy) !== a || !dirs.length) throw new Error(`bad door ${a}->${b} at ${where}`);
  const [dx, dy] = dirs[0];
  const [tx, ty] = T(cx, cy);
  set(tx + dx, ty + dy, ch);
};
door('start', 'upleft', 'C', [2, 11]);   // the cyan gate (long teal bar on the left): cyan -> blue here
door('upleft', 'top', 'G', [7, 1]);      // green gate out of the top left
door('start', 'bottom', 'G', [7, 15]);   // green gate by the star (the red/green bar on the drawing)
door('top', 'hall', '.', [12, 4]);       // down into the hall
door('top', 'hall', '.', [16, 4]);
door('hall', 'bottom', '.', [11, 10]);   // the hall opens to the bottom middle
door('bottom', 'sun', 'O', [16, 14]);    // orange gate (the orange bar at the bottom)
door('hall', 'exit', 'Y', [18, 7]);      // the treasure room door from the hall is yellow
door('sun', 'exit', 'R', [22, 11]);      // red gate: the only way to the exit

// 4) the exit side: treasure room (cells 19..20 x 6..8, all coins) and the exit corridor
{
  const [x0, y0] = T(19, 6), [x1, y1] = T(20, 8);
  for (let y = y0 - 1; y <= y1 + 1; y++) for (let x = x0 - 1; x <= x1 + 1; x++) set(x, y, '#');
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, 'c');
  set(x0 - 1, y0 + 2, 'Y'); // the yellow door faces the hall
}

// ---------- things, where he drew them ----------
const put = (cx, cy, ch, dx = 0, dy = 0) => { const [x, y] = T(cx, cy); set(x + dx, y + dy, ch); };
put(0, 17, 'S');                       // S, bottom left
// jail: a closed room with bars, next to the "JAIL" writing
{
  const [x, y] = T(1, 13);
  for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 3; xx++) set(xx, yy, '#');
  set(x, y, 'j'); set(x + 1, y, '.'); set(x + 2, y, 'L');
  set(x + 2, y + 1, 'J');
  set(x + 2, y + 2, '.');
}
put(4, 15, 'c'); put(1, 16, 'c');
put(5, 15, 'c', 1, 0);                   // (movable walls around here on the drawing)
put(6, 14, 'k');                        // cyan key... drawn as 'q' in cyan near the star side
put(0, 5, 'g');                          // green key on the left edge
put(3, 4, '$');                          // blue gem (top left)
put(5, 8, 'y');                          // yellow key
put(2, 2, 'c'); put(5, 1, 'c'); put(1, 8, 'c'); put(6, 6, 'c');
put(14, 1, 'n');                         // "M, no here." meerkat at the top
put(12, 1, 'o');                         // orange key next to him
put(18, 1, '$');                         // blue gem (top right)
put(9, 2, 'c'); put(16, 3, 'c'); put(11, 0, 'c');
// the hall: Left / Um / Right, and the answer
put(10, 7, 'n');                         // "Well... wrong." (the LEFT sign)
put(13, 6, 'n');                         // "Um..." standing between the signs
put(16, 8, 'n');                         // "Yes! Right is always right."
put(9, 9, 'c'); put(17, 5, 'c'); put(12, 9, 'c');
// bottom middle: the star, coins, a crate
put(9, 16, '*');
put(10, 13, 'c'); put(13, 15, 'c'); put(15, 12, 'c'); put(12, 17, 'c');
// bottom right: the sun meerkat, the red key, a gem, coins
put(21, 14, '@');
put(23, 16, 'r');
put(20, 16, '$');
put(18, 12, 'c'); put(22, 12, 'c'); put(19, 17, 'c');
// exit side
put(23, 1, 'E');
put(21, 3, 'c'); put(22, 9, 'c');
// red zones: the dotted red lines along the top and bottom edges of the hall
{
  const [x0, y0] = T(ZONES.hall.x0, ZONES.hall.y0), [x1, y1] = T(ZONES.hall.x1, ZONES.hall.y1);
  for (let x = x0 + 2; x <= x1 - 2; x++) {
    if (g[y0][x] === '.') set(x, y0, 't');
    if (g[y1][x] === '.') set(x, y1, 't');
  }
}

// the cyan key uses the green key's colour letter? no: our colours are y b r g o p.
// The drawing's cyan key and gate become BLUE here (closest colour we have).
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (g[y][x] === 'k') g[y][x] = 'b';
  if (g[y][x] === 'C') g[y][x] = 'B';
}

// crates in side passages (only where every floor tile stays reachable without pushing)
const rows = () => g.map(r => r.join(''));

// ---------- check: winnable, and keys are needed in order ----------
const KEYS = { y: 1, b: 2, r: 4, g: 8, o: 16, p: 32 };
function reach(grid, startKeys) {
  const sx = grid.findIndex(r => r.includes('S')), sy = sx;
  const start = (() => { for (let y = 0; y < H; y++) { const x = grid[y].indexOf('S'); if (x >= 0) return [x, y]; } })();
  const q = [[...start, startKeys]], seenK = new Set();
  let exit = false; let keys = startKeys;
  while (q.length) {
    const [x, y, k] = q.shift();
    const id = `${x},${y},${k}`;
    if (seenK.has(id)) continue;
    seenK.add(id);
    const ch = grid[y][x];
    if (ch === 'E') exit = true;
    const held = k | (KEYS[ch] ?? 0);
    keys |= held;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, c = grid[ny]?.[nx];
      if (!c || c === '#' || c === 'J' || c === 'n' || c === 'j' || c === '@') continue;
      const gate = KEYS[c.toLowerCase()];
      if (c !== c.toLowerCase() && gate && !(held & gate) && c !== 'S' && c !== 'E' && c !== 'L' && c !== 'J') continue;
      q.push([nx, ny, held]);
    }
    void sx; void sy;
  }
  return { exit, keys };
}
const r = rows();
const full = reach(r, 0);
if (!full.exit) throw new Error('The Original cannot be won! Try another seed.');

// place crates where they block nothing important
let crates = 0;
for (let tries = 0; tries < 400 && crates < 4; tries++) {
  const x = 1 + Math.floor(rnd() * (W - 2)), y = 1 + Math.floor(rnd() * (H - 2));
  if (g[y][x] !== '.') continue;
  const horiz = g[y][x - 1] === '.' && g[y][x + 1] === '.' && g[y - 1][x] === '#' && g[y + 1][x] === '#';
  const vert = g[y - 1][x] === '.' && g[y + 1][x] === '.' && g[y][x - 1] === '#' && g[y][x + 1] === '#';
  if (!horiz && !vert) continue;
  g[y][x] = '#'; // pretend the crate is a wall: nothing may depend on pushing it
  const ok = reach(rows(), 0).exit && reach(rows(), 0).keys === full.keys;
  g[y][x] = ok ? 'm' : '.';
  if (ok) crates++;
}

const level = {
  version: 1,
  name: 'The Original',
  rows: rows(),
  texts: [
    // meerkats in reading order (top row first, left to right)
    'Mmm, no here.',                             // top
    'Um... left or right?',                      // hall, middle
    'Well... wrong.',                            // hall, left
    'Yes! Right is always right.',               // hall, right
    'Help! I stayed in the red zone too long!',  // jail
    'Well, that is like the home of the sun!',   // the spiky sun
  ],
};
fs.mkdirSync('src/levels', { recursive: true });
fs.writeFileSync('src/levels/the-original.json', JSON.stringify(level, null, 2) + '\n');
console.log(level.rows.join('\n'));
console.log(`${W}x${H}, crates ${crates}, exit reachable ${full.exit}`);
