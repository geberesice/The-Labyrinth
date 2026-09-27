// The 10 levels of the game, easiest first. Levels 2, 3 and 5-9 are made by tools/make-levels.mjs,
// level 10 (the paper maze) by tools/make-original.mjs.
import { LEVEL_1_DATA } from '../level';
import type { LevelData } from '../level-format';
import colourChain from './colour-chain.json';
import crateCanyon from './crate-canyon.json';
import darkTunnels from './dark-tunnels.json';
import night from './night-of-the-meerkats.json';
import original from './the-original.json';
import redDesert from './red-desert.json';
import sandyStart from './sandy-start.json';
import yellowKey from './the-yellow-key.json';
import tutorial from './tutorial.json';

export interface CampaignLevel {
  id: string;
  data: LevelData;
  blurb: string;
  /** 1 (easy) to 5 (hardest) */
  difficulty: number;
}

export const CAMPAIGN: CampaignLevel[] = [
  { id: 'tutorial', data: tutorial as LevelData, difficulty: 1, blurb: 'Learn the tricks: keys, gates, crates, red zones.' },
  { id: 'sandy-start', data: sandyStart as LevelData, difficulty: 1, blurb: 'A small maze. Just find the exit!' },
  { id: 'the-yellow-key', data: yellowKey as LevelData, difficulty: 2, blurb: 'One key, one gate.' },
  { id: 'meerkat-maze', data: LEVEL_1_DATA, difficulty: 2, blurb: 'Yellow key, then blue key, then the exit.' },
  { id: 'crate-canyon', data: crateCanyon as LevelData, difficulty: 3, blurb: 'Crates everywhere and gems in dead ends.' },
  { id: 'red-desert', data: redDesert as LevelData, difficulty: 3, blurb: 'Red zones on the way. Walk through, never stop!' },
  { id: 'dark-tunnels', data: darkTunnels as LevelData, difficulty: 4, blurb: 'Three keys and a smaller light.' },
  { id: 'colour-chain', data: colourChain as LevelData, difficulty: 4, blurb: 'Four keys, one after the other.' },
  { id: 'night-of-the-meerkats', data: night as LevelData, difficulty: 5, blurb: 'Five keys, many dead ends, very dark.' },
  { id: 'the-original', data: original as LevelData, difficulty: 5, blurb: 'The first maze ever, drawn on paper. The grand finale!' },
];

/** Kept for places that just want "the levels that come with the game". */
export const BUILTIN_LEVELS = CAMPAIGN;
