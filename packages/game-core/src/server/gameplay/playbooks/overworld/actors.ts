import type { ActorProfileInput, StarterEcologyConfigurationInput } from '@seedlands/game-core/mod-api';

export const overworldActorProfiles: readonly ActorProfileInput[] = [
  {
    archetype: 'grazer',
    entityType: 'creature',
    maxHealth: 12,
    navigation: { speed: 1.6, perceptionRange: 10 },
    deathDrop: { itemId: 'berry', count: 2 },
  },
  {
    archetype: 'night-stalker',
    entityType: 'creature',
    maxHealth: 16,
    navigation: { speed: 2.2, perceptionRange: 12 },
    meleeDefinitionId: 'night-stalker-claw',
    deathDrop: { itemId: 'stone-block', count: 1 },
  },
  {
    archetype: 'settler',
    entityType: 'npc',
    maxHealth: 20,
    navigation: { speed: 1.4, perceptionRange: 10 },
  },
];

export const overworldDefaultPlayerMeleeDefinitionId = 'unarmed';

export const overworldStarterEcology: StarterEcologyConfigurationInput = {
  version: 1,
  actors: [
    { slot: 'forager', idPrefix: 'starter-grazer', archetype: 'grazer', hunger: 65 },
    { slot: 'predator', idPrefix: 'starter-stalker', archetype: 'night-stalker' },
    { slot: 'resident', idPrefix: 'starter-settler', archetype: 'settler', hunger: 20 },
  ],
  initialItem: { itemId: 'berry', count: 1 },
};
