// The levels that come with the game, in the order they are offered.
import { LEVEL_1_DATA } from '../level';
import type { LevelData } from '../level-format';
import original from './the-original.json';
import tutorial from './tutorial.json';

export interface BuiltinLevel { id: string; data: LevelData; blurb: string }

export const BUILTIN_LEVELS: BuiltinLevel[] = [
  { id: 'tutorial', data: tutorial as LevelData, blurb: 'Learn the tricks: keys, gates, crates, red zones.' },
  { id: 'meerkat-maze', data: LEVEL_1_DATA, blurb: 'Find the yellow key, then the blue key, then the exit.' },
  { id: 'the-original', data: original as LevelData, blurb: 'The first maze ever, drawn on paper. It is big!' },
];
