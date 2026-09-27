// What host and guests send each other. The host runs the real game; guests send their
// input and draw the snapshots they receive.
import type { KeyColor } from '../assets';
import type { Dir, Game, GameEvent, Mood, Player } from '../game/state';
import type { LevelData } from '../level-format';

export const PROTOCOL = 1;

export interface PlayerSnap {
  id: number; name: string; skin: number;
  cx: number; cy: number; fromX: number; fromY: number; stepT: number; dir: Dir;
  keys: KeyColor[]; zoneTime: number | null; jailLeft: number | null; starLeft: number;
  mood: Mood; moodLeft: number; pushing: boolean;
}

export interface ThingSnap { id: number; x: number; y: number; gone: boolean; fromX?: number; fromY?: number; slideT?: number }

export interface Snapshot {
  time: number; coins: number; gems: number; won: boolean; wonAt: number; barsOpen: boolean;
  players: PlayerSnap[];
  things: ThingSnap[];
  /** things that happened since the last snapshot (for sounds and effects) */
  events: GameEvent[];
}

export type GuestMsg =
  | { t: 'hello'; v: number; name: string }
  | { t: 'input'; dir: Dir | null }
  | { t: 'action' };

export type HostMsg =
  | { t: 'lobby'; players: { id: number; name: string; skin: number }[] }
  | { t: 'start'; level: LevelData; you: number }
  | { t: 'snap'; s: Snapshot }
  | { t: 'bye'; reason: string };

export function snapshot(g: Game, events: GameEvent[]): Snapshot {
  return {
    time: g.time, coins: g.coins, gems: g.gems, won: g.won, wonAt: g.wonAt, barsOpen: g.barsOpen,
    players: g.players.map(p => ({
      id: p.id, name: p.name, skin: p.skin, cx: p.cx, cy: p.cy, fromX: p.fromX, fromY: p.fromY,
      stepT: +p.stepT.toFixed(3), dir: p.dir, keys: [...p.keys], zoneTime: p.zoneTime, jailLeft: p.jailLeft,
      starLeft: p.starLeft, mood: p.mood, moodLeft: Number.isFinite(p.moodLeft) ? p.moodLeft : 9999, pushing: p.pushing,
    })),
    // only things that can change: picked-up items and crates
    things: g.things
      .filter(t => t.gone || t.kind === 'crate')
      .map(t => ({ id: t.id, x: t.x, y: t.y, gone: t.gone, fromX: t.fromX, fromY: t.fromY, slideT: t.slideT })),
    events,
  };
}

/** Copy a snapshot into the guest's local copy of the game. */
export function applySnapshot(g: Game, s: Snapshot) {
  g.time = s.time; g.coins = s.coins; g.gems = s.gems; g.won = s.won; g.wonAt = s.wonAt; g.barsOpen = s.barsOpen;
  const old = new Map(g.players.map(p => [p.id, p]));
  g.players = s.players.map(ps => {
    const p: Player = old.get(ps.id) ?? ({} as Player);
    // keep our smoother local step progress if we are already further along the same step
    const sameStep = p.cx === ps.cx && p.cy === ps.cy && p.fromX === ps.fromX && p.fromY === ps.fromY;
    const stepT = sameStep ? Math.max(p.stepT ?? 0, ps.stepT) : ps.stepT;
    return Object.assign(p, ps, { keys: new Set(ps.keys), stepT, moodLeft: ps.moodLeft >= 9999 ? Infinity : ps.moodLeft });
  });
  const byId = new Map(s.things.map(t => [t.id, t]));
  for (const t of g.things) {
    const ts = byId.get(t.id);
    if (ts) Object.assign(t, ts);
    else if (t.kind !== 'crate') t.gone = false;
  }
}
