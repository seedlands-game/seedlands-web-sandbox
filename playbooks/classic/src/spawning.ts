import type { SpawnCandidate } from '@seedlands/stdlib/server/gameplay/spawn-policy';

export const overworldSpawnCandidates: readonly SpawnCandidate[] = Object.freeze([
  { archetype: 'chicken', disposition: 'passive', weight: 10, biomes: ['plains', 'forest'] },
  { archetype: 'cow', disposition: 'passive', weight: 8, biomes: ['plains', 'forest'] },
  { archetype: 'pig', disposition: 'passive', weight: 10, biomes: ['plains', 'forest', 'wet'] },
  { archetype: 'sheep', disposition: 'passive', weight: 12, biomes: ['plains', 'forest', 'cold'] },
  { archetype: 'squid', disposition: 'passive', weight: 6, biomes: ['wet'] },
  { archetype: 'wolf', disposition: 'neutral', weight: 4, biomes: ['forest', 'cold'] },
  { archetype: 'zombie', disposition: 'hostile', weight: 10 },
  { archetype: 'skeleton', disposition: 'hostile', weight: 10 },
  { archetype: 'spider', disposition: 'hostile', weight: 10 },
  { archetype: 'creeper', disposition: 'hostile', weight: 8 },
  { archetype: 'slime', disposition: 'hostile', weight: 3, biomes: ['wet'] },
]);
