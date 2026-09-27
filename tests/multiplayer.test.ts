import { describe, expect, it } from 'vitest';
import { addPlayer, createGame, RULES, step, type Dir, type Game } from '../src/game/state';
import { parseLevel } from '../src/level';

const DT = 1 / 60;

/** Player `id` takes one step in `dir` (others stand still). */
function walk(g: Game, id: number, dir: Dir, tiles = 1) {
  const p = g.players.find(q => q.id === id)!;
  for (let i = 0; i < tiles; i++) {
    const inputs: (Dir | null)[] = []; inputs[id] = dir;
    step(g, inputs, DT);
    for (let t = 0; p.stepT < 1 && t < 2; t += DT) step(g, [], DT);
  }
}
const wait = (g: Game, s: number, actions?: Set<number>) => { for (let t = 0; t < s; t += DT) step(g, [], DT, actions); };
const at = (g: Game, id: number) => { const p = g.players.find(q => q.id === id)!; return [p.cx, p.cy]; };

describe('playing together', () => {
  it('friends join at the start with their own id and meerkat', () => {
    const g = createGame(parseLevel('t', ['#####', '#S.E#', '#####'], []));
    const b = addPlayer(g, 'Deniz');
    expect(b).toMatchObject({ id: 1, name: 'Deniz', skin: 1, cx: 1, cy: 1 });
  });

  it('meerkats walk through each other', () => {
    const g = createGame(parseLevel('t', ['######', '#S...#', '######'], []), 2);
    walk(g, 0, 'right');
    walk(g, 1, 'right', 2);
    expect(at(g, 1)).toEqual([3, 1]);
  });

  it('a key belongs to whoever picked it up; it is gone for the others', () => {
    const g = createGame(parseLevel('t', ['#######', '#SyY..#', '#######'], []), 2);
    walk(g, 0, 'right', 3);
    expect(at(g, 0)).toEqual([4, 1]);
    walk(g, 1, 'right', 3);
    expect(at(g, 1)).toEqual([2, 1]); // stopped at the gate: no key
    expect(g.players[1].keys.size).toBe(0);
  });

  it('coins go into the team total', () => {
    const g = createGame(parseLevel('t', ['#####', '#Sc.#', '#.c.#', '#####'], []), 2);
    walk(g, 0, 'right');
    walk(g, 1, 'down'); walk(g, 1, 'right');
    expect(g.coins).toBe(2);
  });
});

describe('jail with friends', () => {
  // player 0 gets caught in the zone; player 1 walks to the bars and bails them out
  const lvl = parseLevel('t', [
    '########',
    '#St....#',
    '#####J##',
    '#####L##',
    '########',
  ], []);
  const catchPlayer0 = () => {
    const g = createGame(lvl, 2);
    walk(g, 0, 'right');
    wait(g, RULES.zoneSeconds + 0.1);
    expect(at(g, 0)).toEqual([5, 3]);
    return g;
  };

  it('the door does not open by itself after 10 seconds', () => {
    const g = catchPlayer0();
    wait(g, RULES.jailSeconds + 1);
    expect(g.barsOpen).toBe(false);
    expect(g.players[0].jailLeft).not.toBeNull();
  });

  it('a friend next to the bars can bail you out', () => {
    const g = catchPlayer0();
    walk(g, 1, 'down'); // blocked by wall, stays at start
    walk(g, 1, 'right', 4); // walk past the zone quickly to (5,1), next to the bars at (5,2)
    expect(at(g, 1)).toEqual([5, 1]);
    const events = step(g, [], DT, new Set([1]));
    expect(events.some(e => e.type === 'bailed')).toBe(true);
    expect(g.players[0].jailLeft).toBeNull();
    expect(g.barsOpen).toBe(true);
    wait(g, 1.5); // done being sad
    walk(g, 0, 'up', 2);
    expect(at(g, 0)).toEqual([5, 1]);
  });

  it('pressing the action button far from the bars does nothing', () => {
    const g = catchPlayer0();
    step(g, [], DT, new Set([1]));
    expect(g.players[0].jailLeft).not.toBeNull();
  });

  it('the safety limit frees you after 60 seconds', () => {
    const g = catchPlayer0();
    wait(g, RULES.rescueSeconds + 0.5);
    expect(g.players[0].jailLeft).toBeNull();
    expect(g.barsOpen).toBe(true);
  });
});
