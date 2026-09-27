// Saving, loading and checking levels. Pure logic, no DOM.
import { KEY_HUES, type KeyColor } from './assets';
import { parseLevel, type Level } from './level';

/** A level as it is saved: the character map (see parseLevel) plus what each meerkat says. */
export interface LevelData {
  version: 1;
  name: string;
  rows: string[];
  /** meerkat speech, in reading order (top row first, left to right) */
  texts: string[];
}

export const NPC_CHARS = new Set(['n', 'j', '@']);

export function toLevel(d: LevelData): Level {
  return parseLevel(d.name, d.rows, d.texts);
}

/** A blank level: floor surrounded by a wall, start in the top-left and exit in the bottom-right. */
export function blankLevel(width = 15, height = 11, name = 'My Maze'): LevelData {
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let r = '';
    for (let x = 0; x < width; x++) r += x === 0 || y === 0 || x === width - 1 || y === height - 1 ? '#' : '.';
    rows.push(r);
  }
  const put = (x: number, y: number, ch: string) => { rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1); };
  put(1, 1, 'S');
  put(width - 2, height - 2, 'E');
  return { version: 1, name, rows, texts: [] };
}

// ---------- level codes: a level as one line of text, for sharing ----------

const CODE_PREFIX = 'MEERKAT1:';

export function toCode(d: LevelData): string {
  const json = JSON.stringify({ n: d.name, r: d.rows, t: d.texts });
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return CODE_PREFIX + btoa(bin);
}

export function fromCode(code: string): LevelData {
  const trimmed = code.trim().replace(/\s+/g, '');
  if (!trimmed.startsWith(CODE_PREFIX)) throw new Error('That is not a level code. Level codes start with ' + CODE_PREFIX);
  let obj: { n?: unknown; r?: unknown; t?: unknown };
  try {
    const bin = atob(trimmed.slice(CODE_PREFIX.length));
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    obj = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('This level code is broken. Try copying it again.');
  }
  return checked(obj.n, obj.r, obj.t ?? [], 'Shared Maze');
}

/** A level file (.meerkat) is the level as readable JSON. */
export function toFileText(d: LevelData): string {
  return JSON.stringify({ game: 'the-labyrinth', version: 1, name: d.name, rows: d.rows, texts: d.texts }, null, 2) + '\n';
}

/** Read a level file; level codes pasted into a file work too. */
export function fromFileText(text: string): LevelData {
  if (text.trim().startsWith(CODE_PREFIX)) return fromCode(text);
  let obj: { name?: unknown; rows?: unknown; texts?: unknown };
  try { obj = JSON.parse(text); } catch { throw new Error('This file is not a meerkat level.'); }
  return checked(obj.name, obj.rows, obj.texts ?? [], 'My Maze');
}

function checked(name: unknown, rows: unknown, texts: unknown, fallbackName: string): LevelData {
  if (!Array.isArray(rows) || rows.length < 3 || !rows.every(r => typeof r === 'string') ||
      !Array.isArray(texts) || !texts.every(t => typeof t === 'string')) {
    throw new Error('This level is broken. Try copying it again.');
  }
  const width = (rows[0] as string).length;
  if (width < 3 || width > 80 || rows.length > 80 || rows.some(r => (r as string).length !== width)) {
    throw new Error('This level has a strange size.');
  }
  return { version: 1, name: typeof name === 'string' ? name.slice(0, 40) : fallbackName, rows: rows as string[], texts: texts as string[] };
}

// ---------- checking ----------

export interface Problem { level: 'error' | 'warning'; message: string }

/**
 * Check a level before playing. Errors stop play (no start / no exit);
 * warnings are allowed but worth fixing (exit cannot be reached, gate without key...).
 */
export function checkLevel(d: LevelData): Problem[] {
  const problems: Problem[] = [];
  const count = (ch: string) => d.rows.reduce((n, r) => n + [...r].filter(c => c === ch).length, 0);
  const starts = count('S'), exits = count('E');
  if (starts === 0) problems.push({ level: 'error', message: 'Put a START somewhere (the meerkat begins there).' });
  if (starts > 1) problems.push({ level: 'error', message: 'There can only be one START.' });
  if (exits === 0) problems.push({ level: 'error', message: 'Put an EXIT somewhere.' });
  if (problems.length) return problems;

  const level = toLevel(d);
  const gateColors = new Set(level.things.filter(t => t.kind === 'gate').map(t => (t as { color: KeyColor }).color));
  const keyColors = new Set(level.things.filter(t => t.kind === 'key').map(t => (t as { color: KeyColor }).color));
  for (const c of gateColors) {
    if (!keyColors.has(c)) problems.push({ level: 'warning', message: `There is a ${c} gate but no ${c} key.` });
  }
  const hasZone = level.timed.some(r => r.some(Boolean));
  if (hasZone && !level.jail) problems.push({ level: 'warning', message: 'There is a red zone but no JAIL spot. Caught meerkats will go back to the start.' });
  if (level.jail && !level.things.some(t => t.kind === 'bars')) problems.push({ level: 'warning', message: 'The jail has no BARS door.' });
  if (!canReachExit(level)) problems.push({ level: 'warning', message: 'The exit cannot be reached! Check walls, gates and keys.' });
  return problems;
}

/** Breadth-first search over (position, keys held). Crates count as floor (you can push them). */
export function canReachExit(level: Level): boolean {
  const colors = Object.keys(KEY_HUES) as KeyColor[];
  const bit = (c: KeyColor) => 1 << colors.indexOf(c);
  const at = new Map<string, { gate?: number; key?: number; exit?: boolean; blocked?: boolean }>();
  const cell = (x: number, y: number) => {
    const k = `${x},${y}`;
    if (!at.has(k)) at.set(k, {});
    return at.get(k)!;
  };
  for (const t of level.things) {
    if (t.kind === 'gate') cell(t.x, t.y).gate = bit(t.color);
    else if (t.kind === 'key') cell(t.x, t.y).key = bit(t.color);
    else if (t.kind === 'exit') cell(t.x, t.y).exit = true;
    else if (t.kind === 'bars') cell(t.x, t.y).blocked = true;
  }
  for (const n of level.npcs) cell(n.x, n.y).blocked = true;

  const seen = new Set<string>();
  const queue: [number, number, number][] = [[level.start.x, level.start.y, 0]];
  while (queue.length) {
    const [x, y, keys] = queue.shift()!;
    const id = `${x},${y},${keys}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const here = at.get(`${x},${y}`);
    if (here?.exit) return true;
    const held = keys | (here?.key ?? 0);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= level.width || ny >= level.height || level.tiles[ny][nx] === 'wall') continue;
      const c = at.get(`${nx},${ny}`);
      if (c?.blocked) continue;
      if (c?.gate && !(held & c.gate)) continue;
      queue.push([nx, ny, held]);
    }
  }
  return false;
}
