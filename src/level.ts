import type { KeyColor } from './assets';

export type Tile = 'wall' | 'floor';

export type Thing =
  | { kind: 'coin'; x: number; y: number }
  | { kind: 'gem'; x: number; y: number }
  | { kind: 'key'; x: number; y: number; color: KeyColor }
  | { kind: 'gate'; x: number; y: number; color: KeyColor }
  | { kind: 'crate'; x: number; y: number }
  | { kind: 'star'; x: number; y: number }
  | { kind: 'bars'; x: number; y: number }
  | { kind: 'exit'; x: number; y: number };

export type NpcVariant = 'normal' | 'jailed' | 'spiky';

export interface Npc { x: number; y: number; text: string; variant: NpcVariant; skin: number }

export interface Level {
  name: string;
  width: number;
  height: number;
  tiles: Tile[][];
  timed: boolean[][];
  things: Thing[];
  npcs: Npc[];
  start: { x: number; y: number };
  /** where you end up when a red zone catches you */
  jail: { x: number; y: number } | null;
  /** how far the meerkat can see (tiles); smaller = darker level */
  fogRadius?: number;
}

const KEY_CHARS: Record<string, KeyColor> = { y: 'yellow', b: 'blue', r: 'red', g: 'green', o: 'orange', p: 'pink' };

/**
 * Parse a character map.
 *   #  wall          .  floor          S  start         E  exit
 *   c  coin          $  gem            *  star          t  timed (red) zone
 *   m  movable crate J  jail bars      n  meerkat (text from `texts`, in reading order)
 *   j  jailed meerkat  @  meerkat in a spiky ball   L  jail cell (where you get locked up)
 *   y b r g o p  key (yellow, blue, red, green, orange, pink)
 *   Y B R G O P  gate of that colour
 */
export function parseLevel(name: string, rows: string[], texts: string[], settings: { fogRadius?: number } = {}): Level {
  const height = rows.length, width = rows[0].length;
  rows.forEach((r, i) => { if (r.length !== width) throw new Error(`Row ${i} of ${name} has ${r.length} chars, expected ${width}`); });
  const tiles: Tile[][] = [], timed: boolean[][] = [], things: Thing[] = [], npcs: Npc[] = [];
  let start = { x: 1, y: 1 }, jail: Level['jail'] = null, textIndex = 0, skin = 1;
  rows.forEach((row, y) => {
    tiles.push([]); timed.push([]);
    [...row].forEach((ch, x) => {
      tiles[y].push(ch === '#' ? 'wall' : 'floor');
      timed[y].push(ch === 't');
      const npc = (variant: NpcVariant) => {
        npcs.push({ x, y, variant, text: texts[textIndex++] ?? '...', skin: 1 + ((skin++ - 1) % 4) });
      };
      switch (ch) {
        case 'S': start = { x, y }; break;
        case 'L': jail = { x, y }; break;
        case 'E': things.push({ kind: 'exit', x, y }); break;
        case 'c': things.push({ kind: 'coin', x, y }); break;
        case '$': things.push({ kind: 'gem', x, y }); break;
        case '*': things.push({ kind: 'star', x, y }); break;
        case 'm': things.push({ kind: 'crate', x, y }); break;
        case 'J': things.push({ kind: 'bars', x, y }); break;
        case 'n': npc('normal'); break;
        case 'j': npc('jailed'); break;
        case '@': npc('spiky'); break;
        default:
          if (KEY_CHARS[ch]) things.push({ kind: 'key', x, y, color: KEY_CHARS[ch] });
          else if (KEY_CHARS[ch.toLowerCase()]) things.push({ kind: 'gate', x, y, color: KEY_CHARS[ch.toLowerCase()] });
      }
    });
  });
  return { name, width, height, tiles, timed, things, npcs, start, jail, fogRadius: settings.fogRadius };
}

/** First level. Keys unlock in order: yellow key -> yellow gate -> blue key -> blue gate -> exit. */
export const LEVEL_1_DATA = {
  version: 1 as const,
  name: 'Meerkat Maze',
  rows: [
  '#########################',
  '#S..c#.....c...#...c.n#E#',
  '#.##.#.#####.#.#.######B#',
  '#.#c...#...#.#...#...#..#',
  '#.#.####.#.#.#####.#.##.#',
  '#...#jL#.#.$...@.#.#....#',
  '###.##J#.#########.####.#',
  '#c.......#..c..*.#...#..#',
  '#.######.#.#####.#.#.#.##',
  '#.#....#.Y.....#...#.#..#',
  '#.#.##.#####.#.#####.##.#',
  '#...#y.#ttt..#.m....#..c#',
  '###.####t#####.##b#.#.#.#',
  '#n....c#t...c.....#.....#',
  '#########################',
  ],
  texts: [
  // meerkats in reading order (top row first, left to right)
  'Yes! Right is always right.',
  'Help! I stayed in the red zone too long!',
  'Well, that is like the home of the sun!',
  'Well... wrong.',
  ],
  settings: { fogRadius: 5 },
};
export const LEVEL_1 = parseLevel(LEVEL_1_DATA.name, LEVEL_1_DATA.rows, LEVEL_1_DATA.texts, LEVEL_1_DATA.settings);

export function isWall(level: Level, x: number, y: number): boolean {
  return x < 0 || y < 0 || x >= level.width || y >= level.height || level.tiles[y][x] === 'wall';
}

/** Bresenham walk: true if no wall stands between the two tiles (the end tiles themselves may be walls). */
export function lineOfSight(level: Level, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  while (!(x === x1 && y === y1)) {
    if ((x !== x0 || y !== y0) && isWall(level, x, y)) return false;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return true;
}

/** How close (in tiles) you must be for a meerkat to talk to you. */
export const TALK_DISTANCE = 2.3;

/** A meerkat talks when you are within 2 squares and it can see you (no wall in between). */
export function canTalk(level: Level, px: number, py: number, npc: { x: number; y: number }): boolean {
  if (Math.hypot(npc.x - px, npc.y - py) > TALK_DISTANCE) return false;
  const x = Math.round(px), y = Math.round(py);
  // either direction: a line that only grazes the corner of a wall still counts as seeing each other
  return lineOfSight(level, x, y, npc.x, npc.y) || lineOfSight(level, npc.x, npc.y, x, y);
}
