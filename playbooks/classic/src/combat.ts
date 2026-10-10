import type { MeleeDefinition } from '@seedlands/stdlib/mod-api';

const step = (damage: number, windupSeconds: number, hitSeconds: number, recoverySeconds: number) =>
  Object.freeze({ damage, windupSeconds, hitSeconds, recoverySeconds });

export const overworldMeleeDefinitions: readonly MeleeDefinition[] = [
  { id: 'unarmed', range: 3, steps: [step(4, 0, 0.01, 0.49)] },
  {
    id: 'wood-sword',
    range: 3,
    steps: [step(5, 0.18, 0.08, 0.24), step(7, 0.14, 0.08, 0.38)],
  },
  {
    id: 'stone-sword',
    range: 3,
    steps: [step(6, 0.18, 0.08, 0.24), step(8, 0.14, 0.08, 0.38)],
  },
  {
    id: 'iron-sword',
    range: 3,
    steps: [step(7, 0.18, 0.08, 0.24), step(9, 0.14, 0.08, 0.38)],
  },
  {
    id: 'gold-sword',
    range: 3,
    steps: [step(5, 0.16, 0.08, 0.2), step(7, 0.12, 0.08, 0.32)],
  },
  {
    id: 'diamond-sword',
    range: 3,
    steps: [step(8, 0.18, 0.08, 0.24), step(10, 0.14, 0.08, 0.38)],
  },
  { id: 'zombie-claw', range: 1.5, steps: [step(3, 0.3, 0.1, 0.7)] },
  { id: 'spider-bite', range: 1.6, steps: [step(2, 0.2, 0.1, 0.5)] },
  { id: 'creeper-bump', range: 1.4, steps: [step(1, 0.4, 0.1, 0.8)] },
  { id: 'slime-bump', range: 1.2, steps: [step(2, 0.25, 0.1, 0.65)] },
];
