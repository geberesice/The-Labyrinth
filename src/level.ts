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
export function parseLevel(name: string, rows: string[], texts: string[]): Level {
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
  return { name, width, height, tiles, timed, things, npcs, start, jail };
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
};
export const LEVEL_1 = parseLevel(LEVEL_1_DATA.name, LEVEL_1_DATA.rows, LEVEL_1_DATA.texts);

export function isWall(level: Level, x: number, y: number): boolean {
  return x < 0 || y < 0 || x >= level.width || y >= level.height || level.tiles[y][x] === 'wall';
}
