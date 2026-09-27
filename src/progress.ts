// Which campaign levels are finished, and the best result on each. Kept in this browser/app.
// If storage is blocked (private window...), every level is open so nobody gets stuck.

const KEY = 'meerkat-labyrinth/progress';

export interface Best { coins: number; gems: number; time: number }
export type Progress = Record<string, Best>;

/** Read-write storage, or null when the browser does not allow it. */
function store(): Storage | null {
  try {
    const s = globalThis.localStorage;
    const probe = '__meerkat_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function loadProgress(): Progress | null {
  const s = store();
  if (!s) return null;
  try {
    const p = JSON.parse(s.getItem(KEY) ?? '{}');
    return p && typeof p === 'object' ? (p as Progress) : {};
  } catch {
    return {};
  }
}

/** Level i is open when it is the first one or the one before it is finished (or storage is blocked). */
export function isUnlocked(ids: readonly string[], i: number, progress = loadProgress()): boolean {
  if (i <= 0 || progress === null) return true;
  return !!progress[ids[i - 1]];
}

/** Remember a finished level; keeps the best coins, gems and (lowest) time. */
export function recordWin(id: string, result: Best) {
  const s = store();
  if (!s) return;
  const p = loadProgress() ?? {};
  const old = p[id];
  p[id] = old
    ? { coins: Math.max(old.coins, result.coins), gems: Math.max(old.gems, result.gems), time: Math.min(old.time, result.time) }
    : result;
  try { s.setItem(KEY, JSON.stringify(p)); } catch { /* could not save */ }
}
