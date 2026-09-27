// "My Levels", kept in this browser. Storage can be missing (private windows, blocked
// site data), so every access is wrapped and the game still works without it.
import type { LevelData } from './level-format';

const KEY = 'meerkat-labyrinth/levels';

export interface SavedLevel { id: string; savedAt: number; data: LevelData }

export function listLevels(): SavedLevel[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as SavedLevel[]) : [];
    return Array.isArray(list) ? list.sort((a, b) => b.savedAt - a.savedAt) : [];
  } catch {
    return [];
  }
}

/** Save (or overwrite by id). Returns the id, or null if the browser would not let us save. */
export function saveLevel(data: LevelData, id?: string): string | null {
  const list = listLevels();
  const newId = id ?? `lvl-${Date.now().toString(36)}`;
  const entry: SavedLevel = { id: newId, savedAt: Date.now(), data };
  const i = list.findIndex(l => l.id === newId);
  if (i >= 0) list[i] = entry; else list.push(entry);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return newId;
  } catch {
    return null;
  }
}

export function deleteLevel(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(listLevels().filter(l => l.id !== id)));
  } catch { /* nothing we can do */ }
}
