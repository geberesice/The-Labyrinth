import { describe, expect, it } from 'vitest';
import { blankLevel, canReachExit, checkLevel, fromCode, fromFileText, toCode, toFileText, toLevel, type LevelData } from '../src/level-format';
import { LEVEL_1 } from '../src/level';

const lvl = (rows: string[], texts: string[] = []): LevelData => ({ version: 1, name: 'T', rows, texts });

describe('level codes', () => {
  it('round-trip a level, including speech with emoji and accents', () => {
    const d = lvl(['#####', '#SnE#', '#####'], ['Merhaba! Çok güzel 🦦']);
    expect(fromCode(toCode(d))).toEqual(d);
  });
  it('reject things that are not level codes', () => {
    expect(() => fromCode('hello')).toThrow(/not a level code/);
    expect(() => fromCode('MEERKAT1:%%%')).toThrow(/broken/);
  });
  it('files round-trip, and a pasted code in a file works too', () => {
    const d = blankLevel();
    expect(fromFileText(toFileText(d))).toEqual(d);
    expect(fromFileText(toCode(d))).toEqual(d);
    expect(() => fromFileText('hello')).toThrow(/not a meerkat level/);
  });
  it('ignore spaces and line breaks pasted into the code', () => {
    const code = toCode(blankLevel());
    expect(fromCode(code.slice(0, 20) + '\n  ' + code.slice(20))).toEqual(blankLevel());
  });
});

describe('checking levels', () => {
  it('a blank level is fine', () => {
    expect(checkLevel(blankLevel())).toEqual([]);
  });
  it('needs exactly one start and an exit', () => {
    expect(checkLevel(lvl(['#####', '#...#', '#####'])).map(p => p.level)).toEqual(['error', 'error']);
    expect(checkLevel(lvl(['#####', '#SSE#', '#####']))[0].message).toMatch(/only be one START/);
  });
  it('warns about a gate without a key and an unreachable exit', () => {
    const msgs = checkLevel(lvl(['######', '#S.RE#', '######'])).map(p => p.message);
    expect(msgs.some(m => /red gate but no red key/.test(m))).toBe(true);
    expect(msgs.some(m => /cannot be reached/.test(m))).toBe(true);
  });
  it('finds a way through gates when the key comes first', () => {
    expect(canReachExit(toLevel(lvl(['#######', '#SrRE.#', '#######'])))).toBe(true);
    expect(canReachExit(toLevel(lvl(['#######', '#SRrE.#', '#######'])))).toBe(false);
  });
  it('level 1 passes', () => {
    expect(canReachExit(LEVEL_1)).toBe(true);
  });
});
