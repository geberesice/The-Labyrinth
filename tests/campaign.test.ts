import { describe, expect, it } from 'vitest';
import { canReachExit, checkLevel, toLevel } from '../src/level-format';
import { CAMPAIGN } from '../src/levels';
import { isUnlocked, loadProgress } from '../src/progress';

const ids = CAMPAIGN.map(l => l.id);

describe('the 10 levels', () => {
  it('there are 10, starting with the Tutorial and ending with The Original', () => {
    expect(CAMPAIGN).toHaveLength(10);
    expect(CAMPAIGN[0].data.name).toBe('Tutorial');
    expect(CAMPAIGN[3].data.name).toBe('Meerkat Maze');
    expect(CAMPAIGN[9].data.name).toBe('The Original');
  });

  it('every level is fine and can be won', () => {
    for (const l of CAMPAIGN) {
      expect(checkLevel(l.data), l.data.name).toEqual([]);
      expect(toLevel(l.data).npcs.length, `${l.data.name}: one text per meerkat`).toBe(l.data.texts.length);
    }
  });

  it('every key in every level is needed (except treasure-room keys)', () => {
    // The Original's yellow key opens the treasure room from the paper drawing, not the way out.
    const treasure: Record<string, string> = { 'the-original': 'y' };
    for (const l of CAMPAIGN) {
      const keys = new Set(l.data.rows.join('').split('').filter(c => 'ybrgop'.includes(c)));
      for (const k of keys) {
        if (treasure[l.id] === k) continue;
        const without = { ...l.data, rows: l.data.rows.map(r => r.replaceAll(k, '.')) };
        expect(canReachExit(toLevel(without)), `${l.data.name} can be won without the ${k} key`).toBe(false);
      }
    }
  });

  it('after the tutorial, no crate has to be pushed to win (and crates never block each other)', () => {
    for (const l of CAMPAIGN.slice(1)) {
      const walled = { ...l.data, rows: l.data.rows.map(r => r.replaceAll('m', '#')) };
      expect(canReachExit(toLevel(walled)), `${l.data.name} needs a crate pushed`).toBe(true);
    }
  });

  it('gets harder: after the tutorial the mazes only get bigger, and the light only gets smaller (or stays)', () => {
    const rest = CAMPAIGN.slice(1);
    for (let i = 1; i < rest.length; i++) {
      const a = rest[i - 1].data, b = rest[i].data;
      expect(b.rows.length * b.rows[0].length, `${b.name} is smaller than ${a.name}`).toBeGreaterThanOrEqual(a.rows.length * a.rows[0].length);
      expect(rest[i].difficulty).toBeGreaterThanOrEqual(rest[i - 1].difficulty);
    }
    expect(CAMPAIGN[9].data.settings?.fogRadius).toBeLessThan(CAMPAIGN[1].data.settings!.fogRadius!);
  });
});

describe('unlocking', () => {
  it('level 1 is always open; the next opens when the one before is finished', () => {
    const progress = { tutorial: { coins: 3, gems: 0, time: 40 } };
    expect(isUnlocked(ids, 0, {})).toBe(true);
    expect(isUnlocked(ids, 1, {})).toBe(false);
    expect(isUnlocked(ids, 1, progress)).toBe(true);
    expect(isUnlocked(ids, 2, progress)).toBe(false);
  });
  it('when the browser cannot save, every level is open', () => {
    expect(loadProgress()).toBeNull(); // no localStorage in the test runner
    expect(isUnlocked(ids, 9)).toBe(true);
  });
});
