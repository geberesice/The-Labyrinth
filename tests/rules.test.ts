import { describe, expect, it } from 'vitest';
import { createGame, RULES, step, type Dir, type Game } from '../src/game/state';
import { LEVEL_1, parseLevel } from '../src/level';

const DT = 1 / 60;

/** Hold a direction until the player has taken `tiles` steps (or time runs out). */
function walk(g: Game, dir: Dir, tiles = 1) {
  const p = g.players[0];
  for (let i = 0; i < tiles; i++) {
    const sx = p.cx, sy = p.cy;
    let t = 0;
    step(g, [dir], DT);
    while (p.stepT < 1 && t < 2) { step(g, [null], DT); t += DT; }
    if (p.cx === sx && p.cy === sy) return; // blocked
  }
}
function wait(g: Game, seconds: number) {
  for (let t = 0; t < seconds; t += DT) step(g, [null], DT);
}
const at = (g: Game) => [g.players[0].cx, g.players[0].cy];

describe('pickups', () => {
  it('coins add 1, gems add 5 and disappear', () => {
    const g = createGame(parseLevel('t', ['#####', '#Sc$#', '#####'], []));
    walk(g, 'right');
    expect(g.coins).toBe(1);
    walk(g, 'right');
    expect(g.coins).toBe(1 + RULES.gem);
    expect(g.gems).toBe(1);
    expect(g.things.every(t => t.gone)).toBe(true);
  });
});

describe('keys and gates', () => {
  const lvl = parseLevel('t', ['#######', '#S.Y.y#', '#.#####', '#y....#', '#######'], []);
  it('a gate is solid without its key', () => {
    const g = createGame(lvl);
    walk(g, 'right', 5);
    expect(at(g)).toEqual([2, 1]);
  });
  it('the matching key lets you walk through, and you keep the key', () => {
    const g = createGame(lvl);
    walk(g, 'down', 2);
    expect(g.players[0].keys.has('yellow')).toBe(true);
    walk(g, 'up', 2);
    walk(g, 'right', 3);
    expect(at(g)).toEqual([4, 1]);
    walk(g, 'right');
    expect(g.players[0].keys.has('yellow')).toBe(true);
  });
  it('a key opens only gates of its own colour', () => {
    const g = createGame(parseLevel('t', ['######', '#SbY.#', '######'], []));
    walk(g, 'right', 3);
    expect(at(g)).toEqual([2, 1]);
  });
});

describe('crates', () => {
  it('can be pushed onto empty floor', () => {
    const g = createGame(parseLevel('t', ['######', '#Sm..#', '######'], []));
    walk(g, 'right', 2);
    expect(at(g)).toEqual([3, 1]);
    expect(g.things[0]).toMatchObject({ x: 4, y: 1 });
  });
  it('do not move into walls or onto items', () => {
    const g = createGame(parseLevel('t', ['######', '#S.mc#', '######'], []));
    walk(g, 'right', 3);
    expect(at(g)).toEqual([2, 1]);
    expect(g.things.find(t => t.kind === 'crate')).toMatchObject({ x: 3, y: 1 });
  });
});

describe('red zones and jail', () => {
  const lvl = parseLevel('t', [
    '#######',
    '#Stt..#',
    '#####J#',
    '#####L#',
    '#######',
  ], []);
  it('walking through a zone quickly is fine', () => {
    const g = createGame(lvl);
    walk(g, 'right', 3);
    expect(at(g)).toEqual([4, 1]);
    expect(g.players[0].jailLeft).toBeNull();
  });
  it('staying longer than 5 seconds sends you to jail', () => {
    const g = createGame(lvl);
    walk(g, 'right');
    wait(g, RULES.zoneSeconds + 0.1);
    expect(at(g)).toEqual([5, 3]);
    expect(g.players[0].jailLeft).not.toBeNull();
  });
  it('the jail door opens after 10 seconds and closes behind you', () => {
    const g = createGame(lvl);
    walk(g, 'right');
    wait(g, RULES.zoneSeconds + 0.1);
    walk(g, 'up', 2);
    expect(at(g)).toEqual([5, 3]); // locked
    wait(g, RULES.jailSeconds);
    expect(g.barsOpen).toBe(true);
    walk(g, 'up', 2);
    expect(at(g)).toEqual([5, 1]);
    walk(g, 'left');
    expect(g.barsOpen).toBe(false);
  });
});

describe('star', () => {
  it('doubles speed for 20 seconds', () => {
    const g = createGame(parseLevel('t', ['#######', '#S*...#', '#######'], []));
    walk(g, 'right');
    expect(g.players[0].starLeft).toBeGreaterThan(RULES.starSeconds - 0.5);
    step(g, ['right'], DT);
    let frames = 0;
    while (g.players[0].stepT < 1) { step(g, [null], DT); frames++; }
    expect(frames).toBeLessThan(RULES.stepTime / DT / 2 + 2);
  });
});

describe('level 1', () => {
  it('is winnable: exit needs the blue key, which needs the yellow key', () => {
    // breadth-first search over (position, keys) using the real rules for gates
    const lvl = LEVEL_1;
    const start = lvl.start;
    const keysAt = new Map(lvl.things.filter(t => t.kind === 'key').map(t => [`${t.x},${t.y}`, t.kind === 'key' ? t.color : '']));
    const gates = new Map(lvl.things.filter(t => t.kind === 'gate').map(t => [`${t.x},${t.y}`, t.kind === 'gate' ? t.color : '']));
    const exit = lvl.things.find(t => t.kind === 'exit')!;
    const blocked = new Set([...lvl.npcs.map(n => `${n.x},${n.y}`), ...lvl.things.filter(t => t.kind === 'bars').map(t => `${t.x},${t.y}`)]);
    const seen = new Set<string>();
    const queue: [number, number, string][] = [[start.x, start.y, '']];
    let won = '';
    while (queue.length) {
      const [x, y, keys] = queue.shift()!;
      const id = `${x},${y},${keys}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (x === exit.x && y === exit.y) { won = keys; break; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, c = `${nx},${ny}`;
        if (lvl.tiles[ny][nx] === 'wall' || blocked.has(c)) continue;
        const gate = gates.get(c);
        if (gate && !keys.includes(gate)) continue;
        const k = keysAt.get(c);
        queue.push([nx, ny, k && !keys.includes(k) ? [...keys.split(',').filter(Boolean), k].sort().join(',') : keys]);
      }
    }
    expect(won).toBe('blue,yellow');
  });
});
