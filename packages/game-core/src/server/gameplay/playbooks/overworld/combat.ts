import type { MeleeDefinition } from '@seedlands/game-core/mod-api';

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
    id: 'night-stalker-claw',
    range: 1.7,
    steps: [step(2, 0.3, 0.1, 0.6)],
  },
];
