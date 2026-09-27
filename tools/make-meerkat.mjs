// Generates the meerkat sprite sheets (original pixel art, CC0 like the rest of the game).
// Run: npm run sprites  ->  src/assets/meerkat/meerkat-*.png
//
// Sheet layout: frames are 16x24, one animation per row:
//   0 idle-down (2)   1 walk-down (4)   2 walk-up (4)
//   3 walk-left (4)   4 walk-right (4)  5 sentry (4)
//   6 celebrate (4)   7 sad (2)
import fs from 'node:fs';
import { PNG } from 'pngjs';

const FW = 16, FH = 24;

const BASE = {
  o: '#2b1a12', // outline
  b: '#c8955a', // fur
  d: '#9c6b3c', // fur shade
  c: '#f2d7a6', // belly / muzzle
  e: '#3b2416', // eye patch
  w: '#ffffff', // eye shine
  n: '#1e1210', // nose
  p: '#d9826b', // ear inner
  t: '#5a3a22', // tail tip
  q: '#7cc6ff', // tear
};

// ---------- base poses (16 wide) ----------
const FRONT_HEAD = [
  '................',
  '................',
  '......oooo......',
  '....oobbbboo....',
  '...obbbbbbbbo...',
  '..oobbbbbbbboo..',
  '.opoeebbbbeeopo.',
  '.oooewebbeweooo.',
  '...oeebbbbeeo...',
  '....obccccbo....',
  '.....occcco.....',
  '......onno......',
];
const FRONT_BODY = [
  '.....obccbo.....',
  '....obbccbbo....',
  '...obbccccbbo...',
  '..obdooccoodbo..',
  '..obdddccdddbo..',
  '...obbccccbbo...',
  '...obbccccbbo...',
  '...obbbccbbbo...',
];
const BACK_HEAD = [
  '................',
  '................',
  '......oooo......',
  '....oobbbboo....',
  '...obbbbbbbbo...',
  '..oobbbbbbbboo..',
  '.opobbbbbbbbopo.',
  '.oo.bbbbbbbbooo.',
  '...obbbbbbbbo...',
  '...obdbbbbdbo...',
  '....obddddbo....',
  '.....obbbbo.....',
];
const BACK_BODY = [
  '.....obbbbo.....',
  '....obbbbbbo....',
  '...obbbbbbbbo...',
  '..obbbdbbdbbbo..',
  '..odbbbddbbbdo..',
  '...obbbddbbbo...',
  '...obbbddbbbo...',
  '...obbbttbbbo...',
];
const SIDE_HEAD = [ // facing left
  '................',
  '................',
  '.......oooo.....',
  '......obbbbo....',
  '.....obbbbbbo...',
  '....obbbbbbpo...',
  '...oeebbbbboo...',
  '..obewbbbbbbo...',
  '.obbeebbbbbo....',
  'onccbbbbbbbo....',
  '.occccbbbbo.....',
  '..oooccbbo......',
];
const SIDE_BODY = [
  '......occbo.....',
  '.....occbbbo....',
  '.....occbbbo....',
  '....oodcbbbo....',
  '....occcbbbdo...',
  '.....occbbbdo...',
  '.....occbbbdo...',
  '.....occbbbbo...',
];

// legs, 4 rows each (rows 20..23)
const LEGS_FRONT = {
  stand: ['...obbboobbbo...', '...obbo..obbo...', '..oddo....oddo..', '..oooo....oooo..'],
  stepL: ['...obbboobbbo...', '..oddo...obbo...', '..oooo...oddo...', '.........oooo...'],
  stepR: ['...obbboobbbo...', '...obbo...oddo..', '...oddo...oooo..', '...oooo.........'],
};
const LEGS_BACK = {
  stand: ['...obbbttbbbo...', '...obbotooobo...', '..oddo.to.oddo..', '..oooo..o.oooo..'],
  stepL: ['...obbbttbbbo...', '..oddo.tobbo....', '..oooo.toddo....', '.......toooo....'],
  stepR: ['...obbbttbbbo...', '....obbot.oddo..', '....oddot.oooo..', '....oooo.o......'],
};
const LEGS_SIDE = {
  stand: ['.....obbbbbo....', '.....obbobbo.ot.', '....oddooddootto', '....oooooooo.oo.'],
  step1: ['.....obbbbbo....', '....obbo.obbo.t.', '...oddo...oddott', '...oooo...oooo..'],
  step2: ['.....obbbbbo....', '......obbbo..ot.', '.....oddddo.otto', '.....oooooo..oo.'],
};

function compose(head, body, legs, { bob = 0, headShift = 0 } = {}) {
  const rows = Array.from({ length: FH }, () => '.'.repeat(FW).split(''));
  const put = (src, y0, dx = 0) => src.forEach((line, i) => {
    const y = y0 + i; if (y < 0 || y >= FH) return;
    [...line].forEach((ch, x) => { const X = x + dx; if (ch !== '.' && X >= 0 && X < FW) rows[y][X] = ch; });
  });
  put(legs, 20);
  // the first two body rows are the scarf: s = scarf, z = scarf shade (coloured per meerkat)
  put(body.map((r, i) => (i === 0 ? r.replace(/[bcd]/g, 's') : i === 1 ? r.replace(/[bcd]/g, 'z') : r)), 12 + bob);
  put(head, 0 + bob, headShift);
  return rows.map(r => r.join(''));
}

const mirror = f => f.map(r => [...r].reverse().join(''));

// sentry: stretch up tall, look around (move eye patches)
function lookFront(dir) {
  // dir -1 = look left, 1 = look right: slide the eye shine inside its dark patch
  return FRONT_HEAD.map(r => {
    const a = [...r];
    const shines = [];
    a.forEach((ch, x) => { if (ch === 'w') shines.push(x); });
    shines.forEach(x => { if (a[x + dir] === 'e') { a[x] = 'e'; a[x + dir] = 'w'; } });
    return a.join('');
  });
}

const frames = [
  // 0 idle
  [compose(FRONT_HEAD, FRONT_BODY, LEGS_FRONT.stand), compose(FRONT_HEAD, FRONT_BODY, LEGS_FRONT.stand, { bob: 1 })],
  // 1 walk down
  [
    compose(FRONT_HEAD, FRONT_BODY, LEGS_FRONT.stepL, { bob: 0 }),
    compose(FRONT_HEAD, FRONT_BODY, LEGS_FRONT.stand, { bob: 1 }),
    compose(FRONT_HEAD, FRONT_BODY, LEGS_FRONT.stepR, { bob: 0 }),
    compose(FRONT_HEAD, FRONT_BODY, LEGS_FRONT.stand, { bob: 1 }),
  ],
  // 2 walk up
  [
    compose(BACK_HEAD, BACK_BODY, LEGS_BACK.stepL, { bob: 0 }),
    compose(BACK_HEAD, BACK_BODY, LEGS_BACK.stand, { bob: 1 }),
    compose(BACK_HEAD, BACK_BODY, LEGS_BACK.stepR, { bob: 0 }),
    compose(BACK_HEAD, BACK_BODY, LEGS_BACK.stand, { bob: 1 }),
  ],
  // 3 walk left
  [
    compose(SIDE_HEAD, SIDE_BODY, LEGS_SIDE.step1, { bob: 0 }),
    compose(SIDE_HEAD, SIDE_BODY, LEGS_SIDE.stand, { bob: 1 }),
    compose(SIDE_HEAD, SIDE_BODY, LEGS_SIDE.step2, { bob: 0 }),
    compose(SIDE_HEAD, SIDE_BODY, LEGS_SIDE.stand, { bob: 1 }),
  ],
];
frames.push(frames[3].map(mirror)); // 4 walk right
// 5 sentry: on tiptoes (body raised 1px), look left / centre / right / centre
// on tiptoes: whole meerkat 1px taller (feet stretched)
const tall = h => { const f = compose(h, FRONT_BODY, LEGS_FRONT.stand); return [...f.slice(1, 22), f[21], f[22], f[23]]; };
frames.push([tall(lookFront(-1)), tall(FRONT_HEAD), tall(lookFront(1)), tall(FRONT_HEAD)]);

// helpers to paint single pixels onto a finished frame
const paint = (f, pts) => { const rows = f.map(r => [...r]); for (const [x, y, ch] of pts) if (rows[y]?.[x] !== undefined) rows[y][x] = ch; return rows.map(r => r.join('')); };
const shiftUp = (f, n) => [...f.slice(n), ...Array(n).fill('.'.repeat(FW))];

// 6 celebrate: arms thrown up (paws next to the ears), then a little hop
const BODY_NO_PAWS = FRONT_BODY.map((r, i) => (i === 3 ? '..obbbccccbbbo..' : i === 4 ? '...obbccccbbo...' : r));
const armsUp = f => paint(f, [
  // arms stretched out and up: shoulder (3,14) to paw (0,10), mirrored on the right
  [2, 13, 'o'], [2, 12, 'b'], [1, 12, 'o'], [3, 12, 'o'], [1, 11, 'b'], [0, 11, 'o'], [2, 11, 'o'], [0, 10, 'o'], [1, 10, 'd'], [1, 9, 'o'],
  [13, 13, 'o'], [13, 12, 'b'], [14, 12, 'o'], [12, 12, 'o'], [14, 11, 'b'], [15, 11, 'o'], [13, 11, 'o'], [15, 10, 'o'], [14, 10, 'd'], [14, 9, 'o'],
]);
const happyHead = FRONT_HEAD.map((r, i) => (i === 10 ? '.....occcco.....' : i === 11 ? '......oppo......' : r)); // open mouth
const cheer = armsUp(compose(happyHead, BODY_NO_PAWS, LEGS_FRONT.stand));
const hop = armsUp(compose(happyHead, BODY_NO_PAWS, ['...obbboobbbo...', '...oddo..oddo...', '...oooo..oooo...', '................']));
frames.push([cheer, shiftUp(hop, 2), shiftUp(hop, 3), shiftUp(hop, 1)]);

// 7 sad: head droops, eyes shut, a tear rolls down
const sadHead = FRONT_HEAD.map(r => r.replace(/w/g, 'e'));
const sad = compose(sadHead, FRONT_BODY, LEGS_FRONT.stand, { bob: 1 });
frames.push([paint(sad, [[4, 10, 'q']]), paint(sad, [[4, 11, 'q'], [11, 10, 'q']])]);

// ---------- variants ----------
// Each meerkat wears a scarf (row 12-13 of the frame, i.e. top of the body) in its own colour.
const VARIANTS = {
  player: '#e8433a',
  npc1: '#3a8fe8',
  npc2: '#57b847',
  npc3: '#b457e8',
  npc4: '#f0b429',
};

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function render(scarf) {
  const cols = Math.max(...frames.map(r => r.length));
  const png = new PNG({ width: cols * FW, height: frames.length * FH });
  const colors = { ...Object.fromEntries(Object.entries(BASE).map(([k, v]) => [k, hex(v)])), s: hex(scarf), z: hex(scarf).map(v => Math.round(v * 0.75)) };
  frames.forEach((row, ry) => row.forEach((f, cx) => {
    f.forEach((line, y) => [...line].forEach((ch, x) => {
      if (ch === '.') return;
      const col = colors[ch];
      const k = ((ry * FH + y) * png.width + cx * FW + x) * 4;
      png.data[k] = col[0]; png.data[k + 1] = col[1]; png.data[k + 2] = col[2]; png.data[k + 3] = 255;
    }));
  }));
  return png;
}

fs.mkdirSync('src/assets/meerkat', { recursive: true });
for (const [name, scarf] of Object.entries(VARIANTS)) {
  fs.writeFileSync(`src/assets/meerkat/meerkat-${name}.png`, PNG.sync.write(render(scarf)));
}
console.log('meerkat sheets written:', Object.keys(VARIANTS).join(', '));
