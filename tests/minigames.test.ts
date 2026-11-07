import { describe, expect, it } from 'vitest';
import {
  distanceMap, floorAt, floorWaves, FLOOR_RULES, heat, makeMinigame, MINIGAMES, minigameInfo, popAt, whackHoles, WHACK_RULES,
} from '../src/game/minigames';
import { createGame, RULES, step, type Game } from '../src/game/state';
import { parseLevel } from '../src/level';
import { canReachExit, toLevel } from '../src/level-format';
import { applySnapshot, snapshot } from '../src/net/protocol';

const DT = 1 / 60;
const SEEDS = [1, 2, 3, 42, 1234, 99999, 2 ** 30];
const wait = (g: Game, seconds: number) => { for (let t = 0; t < seconds; t += DT) step(g, [null], DT); };
const count = (rows: string[], ch: string) => rows.join('').split('').filter(c => c === ch).length;

describe('minigame levels', () => {
  it('the same seed makes the same level, another seed another one', () => {
    for (const m of MINIGAMES) {
      expect(makeMinigame(m.id, 7)).toEqual(makeMinigame(m.id, 7));
      // whack a meerkat always has the same square; its meerkats pop up differently
      if (m.id === 'whack-a-meerkat') expect(createGame(toLevel(makeMinigame(m.id, 7))).pops).not.toEqual(createGame(toLevel(makeMinigame(m.id, 8))).pops);
      else expect(makeMinigame(m.id, 7).rows).not.toEqual(makeMinigame(m.id, 8).rows);
    }
  });

  it('every level has one start, straight rows and knows its minigame', () => {
    for (const m of MINIGAMES) for (const seed of SEEDS) {
      const d = makeMinigame(m.id, seed);
      expect(count(d.rows, 'S'), m.id).toBe(1);
      expect(new Set(d.rows.map(r => r.length)).size).toBe(1);
      expect(toLevel(d).minigame).toBe(m.id);
      expect(toLevel(d).npcs.length).toBe(d.texts.length);
    }
  });

  it('find the key: one key, a locked exit, and you need the key to get out', () => {
    for (const seed of SEEDS) {
      const d = makeMinigame('find-the-key', seed);
      expect(count(d.rows, 'y')).toBe(1);
      expect(count(d.rows, 'Y')).toBe(1);
      expect(count(d.rows, 'E')).toBe(1);
      expect(canReachExit(toLevel(d))).toBe(true);
      expect(canReachExit(toLevel({ ...d, rows: d.rows.map(r => r.replace('y', '.')) }))).toBe(false);
      // the key is far from the start
      const lvl = toLevel(d);
      const key = lvl.things.find(t => t.kind === 'key')!;
      const steps = distanceMap(lvl, lvl.start.x, lvl.start.y);
      expect(steps[key.y * lvl.width + key.x]).toBeGreaterThan(30);
    }
  });

  it('coin rush: lots of coins and no exit', () => {
    const d = makeMinigame('coin-rush', 5);
    expect(count(d.rows, 'c')).toBeGreaterThan(50);
    expect(count(d.rows, 'E')).toBe(0);
  });
});

describe('the floor is red', () => {
  const lvl = toLevel(makeMinigame('floor-is-red', 3));

  it('flashes come one after the other, starting after a little wait', () => {
    const waves = floorWaves(lvl, 3, RULES.stepTime, 60);
    expect(waves.length).toBeGreaterThan(10);
    expect(waves[0].warnAt).toBe(FLOOR_RULES.grace);
    for (let i = 0; i < waves.length; i++) {
      expect(waves[i].warnAt).toBeLessThan(waves[i].redAt);
      expect(waves[i].redAt).toBeLessThan(waves[i].endAt);
      if (i) expect(waves[i].warnAt).toBeGreaterThan(waves[i - 1].endAt);
    }
  });

  it('it is always fair: some floor turns red, and a safe tile is close enough to run to', () => {
    for (const seed of SEEDS) {
      for (const w of floorWaves(lvl, seed, RULES.stepTime, 60)) {
        const reach = Math.floor((w.redAt - w.warnAt) / RULES.stepTime) - 2;
        expect(w.red.some(Boolean)).toBe(true);
        for (let y = 0; y < lvl.height; y++) for (let x = 0; x < lvl.width; x++) {
          if (lvl.tiles[y][x] === 'wall' || !w.red[y * lvl.width + x]) continue;
          const steps = distanceMap(lvl, x, y);
          let nearest = Infinity;
          steps.forEach((s, i) => { if (s >= 0 && !w.red[i] && lvl.tiles[Math.floor(i / lvl.width)][i % lvl.width] === 'floor') nearest = Math.min(nearest, s); });
          expect(nearest).toBeLessThanOrEqual(reach);
        }
      }
    }
  });

  it('floorAt: flashing first, then red, then back to sand', () => {
    const waves = floorWaves(lvl, 3, RULES.stepTime, 60);
    const w = waves[0];
    const i = w.red.findIndex(Boolean), x = i % lvl.width, y = Math.floor(i / lvl.width);
    expect(floorAt(lvl, waves, w.warnAt - 0.1, x, y)).toBe(null);
    expect(floorAt(lvl, waves, w.warnAt + 0.1, x, y)).toBe('warn');
    expect(floorAt(lvl, waves, w.redAt + 0.1, x, y)).toBe('red');
    expect(floorAt(lvl, waves, w.endAt + 0.01, x, y)).toBe(null);
  });

  it('red floor costs a heart; after the last heart you are out and the game is lost', () => {
    const g = createGame(lvl);
    const all = new Uint8Array(lvl.width * lvl.height).fill(1);
    g.waves = [{ warnAt: 0, redAt: 0.5, endAt: 30, red: all }];
    wait(g, 0.6);
    expect(g.players[0].lives).toBe(FLOOR_RULES.lives - 1);
    wait(g, FLOOR_RULES.hurtSeconds * (FLOOR_RULES.lives - 1) + 0.2);
    expect(g.players[0].lives).toBe(0);
    expect(g.players[0].out).toBe(true);
    expect(g.lost).toBe(true);
  });

  it('last until the time is up and you win', () => {
    const g = createGame(lvl);
    g.waves = [];
    wait(g, minigameInfo('floor-is-red').timeLimit + 0.1);
    expect(g.won).toBe(true);
    expect(g.lost).toBe(false);
  });

  it('with friends, one meerkat out is not the end', () => {
    const g = createGame(lvl, 2);
    g.waves = [{ warnAt: 0, redAt: 0.5, endAt: 30, red: new Uint8Array(lvl.width * lvl.height).fill(1) }];
    g.players[1].lives = 1;
    g.players[1].out = false;
    g.players[0].hurtLeft = 100;
    wait(g, 0.6);
    expect(g.players[1].out).toBe(true);
    expect(g.lost).toBe(false);
  });
});

describe('whack a meerkat', () => {
  const lvl = toLevel(makeMinigame('whack-a-meerkat', 6));
  /** A game with just one meerkat, popping up in the hole right of the start. */
  function oneMeerkat(kind: 'normal' | 'gold' | 'spiky') {
    const g = createGame(lvl);
    const hole = whackHoles(lvl).find(h => h.y === lvl.start.y && h.x > lvl.start.x)!;
    g.pops = [{ ...hole, kind, skin: 1, upAt: 0, downAt: 30, whackedAt: null }];
    return { g, steps: hole.x - lvl.start.x };
  }
  const walkRight = (g: Game, tiles: number) => {
    for (let i = 0; i < tiles; i++) { step(g, ['right'], DT); for (let t = 0; g.players[0].stepT < 1 && t < 2; t += DT) step(g, [null], DT); }
  };

  it('12 holes on the floor, none on the start', () => {
    const holes = whackHoles(lvl);
    expect(holes).toHaveLength(12);
    for (const h of holes) expect(lvl.tiles[h.y][h.x]).toBe('floor');
    expect(holes.some(h => h.x === lvl.start.x && h.y === lvl.start.y)).toBe(false);
  });

  it('meerkats pop up all game long, one at a time per hole, faster later', () => {
    for (const seed of SEEDS) {
      const g = createGame(toLevel(makeMinigame('whack-a-meerkat', seed)));
      expect(g.pops.length).toBeGreaterThan(40);
      expect(g.pops[0].upAt).toBe(WHACK_RULES.grace);
      expect(g.pops.some(p => p.kind === 'spiky')).toBe(true);
      expect(g.pops.some(p => p.kind === 'gold')).toBe(true);
      for (const a of g.pops) for (const b of g.pops) {
        if (a !== b && a.x === b.x && a.y === b.y) expect(a.downAt <= b.upAt || b.downAt <= a.upAt).toBe(true);
      }
      const first = g.pops.slice(0, 5), last = g.pops.slice(-5);
      const len = (ps: typeof first) => ps.reduce((n, p) => n + p.downAt - p.upAt, 0) / ps.length;
      expect(len(last)).toBeLessThan(len(first));
    }
  });

  it('stepping onto a meerkat bonks it: +1 coin, and it can not be bonked twice', () => {
    const { g, steps } = oneMeerkat('normal');
    walkRight(g, steps);
    expect(g.coins).toBe(WHACK_RULES.normal);
    expect(g.pops[0].whackedAt).not.toBe(null);
    expect(popAt(g.pops, g.time, g.pops[0].x, g.pops[0].y)).toBeUndefined();
    walkRight(g, 1);
    step(g, ['left'], DT); wait(g, 0.3);
    expect(g.coins).toBe(WHACK_RULES.normal);
  });

  it('gold ones give 5 coins, the spiky one takes 3 (never below 0)', () => {
    const gold = oneMeerkat('gold');
    walkRight(gold.g, gold.steps);
    expect(gold.g.coins).toBe(WHACK_RULES.gold);
    const spiky = oneMeerkat('spiky');
    spiky.g.coins = 2;
    walkRight(spiky.g, spiky.steps);
    expect(spiky.g.coins).toBe(0);
  });

  it('an empty hole does nothing, and the game is won when the time is up', () => {
    const g = createGame(lvl);
    g.pops = [];
    walkRight(g, 3);
    expect(g.coins).toBe(0);
    wait(g, 60.1);
    expect(g.won).toBe(true);
  });

  it('friends see which meerkats were bonked', () => {
    const { g } = oneMeerkat('normal');
    g.pops[0].whackedAt = 1.5;
    const guest = createGame(lvl);
    guest.pops = g.pops.map(p => ({ ...p, whackedAt: null }));
    applySnapshot(guest, JSON.parse(JSON.stringify(snapshot(g, []))));
    expect(guest.pops[0].whackedAt).toBe(1.5);
  });
});

describe('time limits', () => {
  it('find the key: too slow and you lose', () => {
    const g = createGame(toLevel(makeMinigame('find-the-key', 4)));
    wait(g, minigameInfo('find-the-key').timeLimit + 0.1);
    expect(g.lost).toBe(true);
    expect(g.won).toBe(false);
  });

  it('coin rush: the time ends the game (a win), and so does collecting everything', () => {
    const g = createGame(toLevel(makeMinigame('coin-rush', 4)));
    wait(g, 60.1);
    expect(g.won).toBe(true);
    const tiny = createGame(parseLevel('t', ['#####', '#Sc.#', '#####'], [], { minigame: 'coin-rush' }));
    step(tiny, ['right'], DT);
    wait(tiny, 0.5);
    expect(tiny.won).toBe(true);
    expect(tiny.wonAt).toBeLessThan(1);
  });

  it('normal levels have no time limit', () => {
    const g = createGame(parseLevel('t', ['#####', '#S.E#', '#####'], []));
    wait(g, 200);
    expect(g.won || g.lost).toBe(false);
  });
});

describe('hot or cold', () => {
  it('closer is hotter', () => {
    expect(heat(1, 100)).toBe(0);
    expect(heat(10, 100)).toBe(1);
    expect(heat(30, 100)).toBe(2);
    expect(heat(50, 100)).toBe(3);
    expect(heat(90, 100)).toBe(4);
    expect(heat(-1, 100)).toBe(4);
  });
});

describe('friends get the minigame state', () => {
  it('lost, hearts and out travel in the snapshot', () => {
    const lvl = toLevel(makeMinigame('floor-is-red', 9));
    const host = createGame(lvl, 2);
    host.players[1].lives = 0; host.players[1].out = true;
    host.lost = true; host.lostAt = 12;
    const guest = createGame(lvl, 2);
    applySnapshot(guest, JSON.parse(JSON.stringify(snapshot(host, []))));
    expect(guest.lost).toBe(true);
    expect(guest.lostAt).toBe(12);
    expect(guest.players[1]).toMatchObject({ lives: 0, out: true });
    expect(guest.waves.length).toBe(host.waves.length);
  });
});
