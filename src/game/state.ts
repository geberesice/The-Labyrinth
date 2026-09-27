// Game rules. Pure logic, no drawing, so it can be unit tested and later run by the multiplayer host.
import type { KeyColor } from '../assets';
import { isWall, type Level, type Thing } from '../level';

export type Dir = 'up' | 'down' | 'left' | 'right';
export const DIRS: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

export const RULES = {
  stepTime: 0.16, // seconds to walk one tile
  coin: 1,
  gem: 5, // a gem is worth 5 coins
  starSeconds: 20, // star: double speed and no fog
  zoneSeconds: 5, // how long you may stay in a red zone
  jailSeconds: 10, // solo: the jail door opens by itself after this
  rescueSeconds: 60, // with friends: wait to be bailed out, but never longer than this
};

export type Mood = 'none' | 'celebrate' | 'sad' | 'pickup';

export interface Player {
  id: number;
  name: string;
  /** which meerkat sprite (scarf colour) */
  skin: number;
  /** tile the player is on, or walking to */
  cx: number; cy: number;
  /** tile the current step started from */
  fromX: number; fromY: number;
  /** 0..1 progress of the current step (1 = standing still) */
  stepT: number;
  dir: Dir;
  keys: Set<KeyColor>;
  /** seconds spent in the current red zone, or null when outside */
  zoneTime: number | null;
  /** seconds until the jail door opens, or null when free */
  jailLeft: number | null;
  starLeft: number;
  mood: Mood;
  moodLeft: number;
  /** true while pushing a crate this step */
  pushing: boolean;
}

export type LiveThing = Thing & {
  id: number;
  gone: boolean;
  /** crates slide: where it came from and 0..1 progress */
  fromX?: number; fromY?: number; slideT?: number;
};

export type GameEvent =
  | { type: 'coin' | 'gem' | 'key' | 'star'; x: number; y: number; player: number; color?: KeyColor; amount?: number }
  | { type: 'push'; x: number; y: number; player: number }
  | { type: 'jailed' | 'released' | 'zone-enter' | 'zone-leave'; player: number; x: number; y: number }
  | { type: 'bailed'; player: number; x: number; y: number; freed: number[] }
  | { type: 'gate'; x: number; y: number; player: number; color: KeyColor }
  | { type: 'win'; player: number; x: number; y: number };

export interface Game {
  level: Level;
  things: LiveThing[];
  players: Player[];
  coins: number;
  gems: number;
  time: number;
  won: boolean;
  wonAt: number;
  barsOpen: boolean;
  /** cells inside the jail (behind the bars) */
  jailCells: Set<string>;
  events: GameEvent[];
}

const key = (x: number, y: number) => `${x},${y}`;

export function createGame(level: Level, playerCount = 1): Game {
  const g: Game = {
    level,
    things: level.things.map((t, id) => ({ ...t, id, gone: false })),
    players: [], coins: 0, gems: 0, time: 0, won: false, wonAt: 0, barsOpen: false,
    jailCells: findJailCells(level), events: [],
  };
  for (let i = 0; i < playerCount; i++) addPlayer(g);
  return g;
}

/** Add a meerkat at the start (used when a friend joins). Returns the new player. */
export function addPlayer(g: Game, name?: string): Player {
  const id = g.players.reduce((m, p) => Math.max(m, p.id + 1), 0);
  const { x, y } = g.level.start;
  const p: Player = {
    id, name: name ?? `Meerkat ${id + 1}`, skin: id % 5, cx: x, cy: y, fromX: x, fromY: y, stepT: 1, dir: 'down',
    keys: new Set(), zoneTime: null, jailLeft: null, starLeft: 0, mood: 'none', moodLeft: 0, pushing: false,
  };
  g.players.push(p);
  return p;
}

export function removePlayer(g: Game, id: number) {
  g.players = g.players.filter(p => p.id !== id);
}

/** Flood fill from the jail spot without crossing walls or bars. */
function findJailCells(level: Level): Set<string> {
  const cells = new Set<string>();
  if (!level.jail) return cells;
  const bars = new Set(level.things.filter(t => t.kind === 'bars').map(t => key(t.x, t.y)));
  const todo = [level.jail];
  while (todo.length && cells.size < 64) {
    const { x, y } = todo.pop()!;
    if (cells.has(key(x, y)) || isWall(level, x, y) || bars.has(key(x, y))) continue;
    cells.add(key(x, y));
    for (const [dx, dy] of Object.values(DIRS)) todo.push({ x: x + dx, y: y + dy });
  }
  return cells;
}

/** Smooth position for drawing. */
export function playerPos(p: Player): { x: number; y: number } {
  return { x: p.fromX + (p.cx - p.fromX) * p.stepT, y: p.fromY + (p.cy - p.fromY) * p.stepT };
}

export function thingsAt(g: Game, x: number, y: number): LiveThing[] {
  return g.things.filter(t => !t.gone && t.x === x && t.y === y);
}

/** Meerkat NPCs block the way. Players walk through each other (no getting stuck in corridors). */
function npcAt(g: Game, x: number, y: number): boolean {
  return g.level.npcs.some(n => n.x === x && n.y === y);
}

function playerAt(g: Game, x: number, y: number, except?: Player): boolean {
  return g.players.some(p => p !== except && (p.cx === x && p.cy === y || (p.stepT < 1 && p.fromX === x && p.fromY === y)));
}

/** Can player `p` step onto (x, y)? (crates are handled separately) */
function canEnter(g: Game, p: Player, x: number, y: number): boolean {
  if (isWall(g.level, x, y) || npcAt(g, x, y)) return false;
  for (const t of thingsAt(g, x, y)) {
    if (t.kind === 'gate' && !p.keys.has(t.color)) return false;
    if (t.kind === 'bars' && !g.barsOpen) return false;
    if (t.kind === 'crate') return false;
  }
  return true;
}

/** A crate can slide into an empty floor tile (no items, gates, exit, meerkats). */
function crateCanEnter(g: Game, x: number, y: number): boolean {
  if (isWall(g.level, x, y) || npcAt(g, x, y) || playerAt(g, x, y)) return false;
  if (g.jailCells.has(key(x, y))) return false;
  return thingsAt(g, x, y).length === 0;
}

/**
 * Advance the game by dt seconds. `inputs[id]` is the direction player `id` is holding (or null);
 * `actions` holds the ids of players who pressed the action button (Space) this frame.
 */
export function step(g: Game, inputs: (Dir | null | undefined)[], dt: number, actions: ReadonlySet<number> = new Set()): GameEvent[] {
  g.events = [];
  g.time += dt;

  // bail out friends: stand next to the jail bars and press the action button
  for (const id of actions) {
    const p = g.players.find(q => q.id === id);
    if (p && !g.won && p.jailLeft === null) tryBail(g, p);
  }

  for (const t of g.things) {
    if (t.slideT !== undefined && t.slideT < 1) t.slideT = Math.min(1, t.slideT + dt / RULES.stepTime);
  }

  for (const p of g.players) {
    p.starLeft = Math.max(0, p.starLeft - dt);
    if (p.moodLeft > 0) { p.moodLeft -= dt; if (p.moodLeft <= 0) p.mood = g.won ? p.mood : 'none'; }
    if (g.won) continue;

    // jail countdown (solo: the door opens by itself)
    if (p.jailLeft !== null) {
      p.jailLeft -= dt;
      if (p.jailLeft <= 0) release(g, p);
    }

    const speed = p.starLeft > 0 ? 2 : 1;
    if (p.stepT < 1) {
      p.stepT = Math.min(1, p.stepT + (dt * speed) / RULES.stepTime);
      if (p.stepT >= 1) arrive(g, p);
    }
    if (p.stepT >= 1 && p.mood !== 'sad') {
      const want = inputs[p.id] ?? null;
      if (want) tryMove(g, p, want);
      else p.pushing = false;
    }

    // red zone timer runs while you stand or walk in it
    const pos = playerPos(p);
    const inZone = g.level.timed[Math.round(pos.y)]?.[Math.round(pos.x)] ?? false;
    if (inZone) {
      if (p.zoneTime === null) { p.zoneTime = 0; g.events.push({ type: 'zone-enter', player: p.id, x: p.cx, y: p.cy }); }
      p.zoneTime += dt;
      if (p.zoneTime >= RULES.zoneSeconds) sendToJail(g, p);
    } else if (p.zoneTime !== null) {
      p.zoneTime = null;
      g.events.push({ type: 'zone-leave', player: p.id, x: p.cx, y: p.cy });
    }
  }

  // bars close again once nobody is inside the jail or in the doorway
  if (g.barsOpen) {
    const bars = g.things.filter(t => t.kind === 'bars');
    const inside = g.players.some(p => p.jailLeft !== null ||
      g.jailCells.has(key(p.cx, p.cy)) || g.jailCells.has(key(p.fromX, p.fromY)) ||
      bars.some(b => (b.x === p.cx && b.y === p.cy) || (b.x === p.fromX && b.y === p.fromY)));
    if (!inside) g.barsOpen = false;
  }
  return g.events;
}

function tryMove(g: Game, p: Player, dir: Dir) {
  p.dir = dir;
  const [dx, dy] = DIRS[dir];
  const nx = p.cx + dx, ny = p.cy + dy;
  const crate = thingsAt(g, nx, ny).find(t => t.kind === 'crate');
  if (crate) {
    const bx = nx + dx, by = ny + dy;
    if (playerAt(g, nx, ny, p) || !crateCanEnter(g, bx, by)) { p.pushing = true; return; }
    crate.fromX = crate.x; crate.fromY = crate.y; crate.slideT = 0;
    crate.x = bx; crate.y = by;
    p.pushing = true;
    g.events.push({ type: 'push', x: bx, y: by, player: p.id });
  } else {
    p.pushing = false;
    if (!canEnter(g, p, nx, ny)) return;
    const gate = thingsAt(g, nx, ny).find(t => t.kind === 'gate');
    if (gate && gate.kind === 'gate') g.events.push({ type: 'gate', x: nx, y: ny, player: p.id, color: gate.color });
  }
  p.fromX = p.cx; p.fromY = p.cy;
  p.cx = nx; p.cy = ny;
  p.stepT = 0;
}

/** Called when a step finishes: pick things up, reach the exit. */
function arrive(g: Game, p: Player) {
  for (const t of thingsAt(g, p.cx, p.cy)) {
    const ev = { x: t.x, y: t.y, player: p.id };
    switch (t.kind) {
      case 'coin':
        t.gone = true; g.coins += RULES.coin;
        g.events.push({ type: 'coin', amount: RULES.coin, ...ev });
        break;
      case 'gem':
        t.gone = true; g.gems += 1; g.coins += RULES.gem;
        g.events.push({ type: 'gem', amount: RULES.gem, ...ev });
        break;
      case 'key':
        t.gone = true; p.keys.add(t.color);
        p.mood = 'pickup'; p.moodLeft = 0.5;
        g.events.push({ type: 'key', color: t.color, ...ev });
        break;
      case 'star':
        t.gone = true; p.starLeft = RULES.starSeconds;
        p.mood = 'pickup'; p.moodLeft = 0.5;
        g.events.push({ type: 'star', ...ev });
        break;
      case 'exit':
        g.won = true; g.wonAt = g.time;
        p.mood = 'celebrate'; p.moodLeft = Infinity;
        g.events.push({ type: 'win', ...ev });
        break;
    }
  }
}

/** Is the player standing next to (or on) the jail bars? */
export function nearBars(g: Game, p: Player): boolean {
  return g.things.some(t => t.kind === 'bars' && Math.abs(t.x - p.cx) + Math.abs(t.y - p.cy) <= 1);
}

function tryBail(g: Game, p: Player) {
  const jailed = g.players.filter(q => q.jailLeft !== null);
  if (!jailed.length || !nearBars(g, p) || g.jailCells.has(key(p.cx, p.cy))) return;
  for (const q of jailed) q.jailLeft = null;
  g.barsOpen = true;
  p.mood = 'pickup'; p.moodLeft = 0.6;
  g.events.push({ type: 'bailed', player: p.id, x: p.cx, y: p.cy, freed: jailed.map(q => q.id) });
}

function sendToJail(g: Game, p: Player) {
  p.zoneTime = null;
  const spot = g.level.jail ?? g.level.start;
  p.fromX = p.cx = spot.x;
  p.fromY = p.cy = spot.y;
  p.stepT = 1;
  p.dir = 'down';
  p.pushing = false;
  if (g.level.jail) {
    // alone: the door opens by itself; with friends: wait for a rescue (with a safety limit)
    p.jailLeft = g.players.length > 1 ? RULES.rescueSeconds : RULES.jailSeconds;
    g.barsOpen = false;
  }
  p.mood = 'sad'; p.moodLeft = 1.5;
  g.events.push({ type: 'jailed', player: p.id, x: spot.x, y: spot.y });
}

function release(g: Game, p: Player) {
  p.jailLeft = null;
  g.barsOpen = true;
  g.events.push({ type: 'released', player: p.id, x: p.cx, y: p.cy });
}
