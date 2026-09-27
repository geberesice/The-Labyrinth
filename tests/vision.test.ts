import { describe, expect, it } from 'vitest';
import { Fog } from '../src/fog';
import { canTalk, parseLevel } from '../src/level';

describe('fog of war: a circle of light', () => {
  const lvl = parseLevel('t', [
    '#############',
    '#S.#........#',
    '#..#........#',
    '#..#........#',
    '#...........#',
    '#############',
  ], [], { fogRadius: 4 });

  it('lights places behind a wall when they are inside the circle', () => {
    const fog = new Fog(lvl);
    fog.update(1, 1);
    expect(fog.visible[1][4]).toBeGreaterThan(0.5); // behind the wall at x=3, 3 tiles away
  });
  it('keeps everything outside the circle dark', () => {
    const fog = new Fog(lvl);
    fog.update(1, 1);
    expect(fog.visible[1][11]).toBe(0);
    expect(fog.visible[4][11]).toBe(0);
  });
  it('remembers explored places for the map, but they go dark on screen', () => {
    const fog = new Fog(lvl);
    fog.update(1, 1);
    fog.update(11, 4);
    expect(fog.explored[1][1]).toBe(true);
    expect(fog.visible[1][1]).toBe(0);
  });
  it('star power lights the whole maze', () => {
    const fog = new Fog(lvl);
    fog.update(1, 1, { clear: true });
    expect(fog.visible[4][11]).toBe(1);
  });
  it('uses the level radius (default 5)', () => {
    expect(new Fog(lvl).radius).toBe(4);
    expect(new Fog(parseLevel('t', ['###', '#S#', '###'], [])).radius).toBe(5);
  });
});

describe('gates block the view into places behind them', () => {
  // the room on the right is only reachable through the yellow gate
  const lvl = parseLevel('t', [
    '#########',
    '#S.Y....#',
    '###.#####',
    '#########',
  ], []);
  const gates = lvl.things.filter(t => t.kind === 'gate') as { x: number; y: number; color: 'yellow' }[];

  it('without the key the room behind the gate stays dark (the gate itself shows)', () => {
    const fog = new Fog(lvl);
    fog.update(1, 1, { gates });
    expect(fog.visible[1][3]).toBeGreaterThan(0); // the gate
    expect(fog.visible[1][4]).toBe(0);
    expect(fog.visible[1][5]).toBe(0);
  });
  it('with the key you can see through', () => {
    const fog = new Fog(lvl);
    fog.update(1, 1, { gates, keys: new Set(['yellow']) });
    expect(fog.visible[1][5]).toBeGreaterThan(0);
  });
});

describe('meerkats talk only when you are close and they can see you', () => {
  const lvl = parseLevel('t', [
    '#######',
    '#S.#n.#',
    '#.....#',
    '#######',
  ], ['Hi']);
  const npc = lvl.npcs[0]; // at (4, 1)

  it('2 squares away with a wall in between: silent', () => {
    expect(canTalk(lvl, 2, 1, npc)).toBe(false);
  });
  it('2 squares away in the open: talks', () => {
    expect(canTalk(lvl, 2, 2, npc)).toBe(true);
    expect(canTalk(lvl, 4, 2, npc)).toBe(true);
  });
  it('too far: silent', () => {
    expect(canTalk(lvl, 1, 2, npc)).toBe(false);
  });
});
