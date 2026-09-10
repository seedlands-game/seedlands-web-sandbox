import type { ServerCommand } from '@seedlands/game-core/server/commands/command-contract';

export const MELEE_SHOWCASE_SEED = 'wood-sword-action-stage-v1';
export const MELEE_SHOWCASE_DUMMY_IDS = Object.freeze([
  'showcase-dummy-left',
  'showcase-dummy-center',
  'showcase-dummy-right',
] as const);
export const MELEE_SHOWCASE_HOSTILE_ID = 'showcase-night-stalker';
export const MELEE_SHOWCASE_ENTITY_IDS = Object.freeze([
  ...MELEE_SHOWCASE_DUMMY_IDS,
  MELEE_SHOWCASE_HOSTILE_ID,
] as const);
export const MELEE_SHOWCASE_PLAYER_CAMERA = Object.freeze([0.5, 58.6, 0.5] as const);

const INSTANCE_NONCE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type MeleeShowcaseIds = Readonly<{ dummies: readonly string[]; hostile: string }>;

export function createMeleeShowcaseIds(nonce: string): MeleeShowcaseIds {
  if (!INSTANCE_NONCE.test(nonce)) throw new TypeError('Showcase instance nonce must be a canonical UUID v4.');
  return Object.freeze({
    dummies: Object.freeze(MELEE_SHOWCASE_DUMMY_IDS.map((id) => `${id}--${nonce}`)),
    hostile: `${MELEE_SHOWCASE_HOSTILE_ID}--${nonce}`,
  });
}

const belongsToShowcase = (id: string) =>
  MELEE_SHOWCASE_ENTITY_IDS.some(
    (role) => id === role || (id.startsWith(`${role}--`) && INSTANCE_NONCE.test(id.slice(role.length + 2))),
  );

export function meleeShowcaseCommands(
  existingIds: ReadonlySet<string>,
  ids: MeleeShowcaseIds,
): readonly ServerCommand[] {
  const cleanup = [...existingIds].filter(belongsToShowcase).map((entityId): ServerCommand => ({
    type: 'despawn-entity',
    entityId,
  }));
  return [
    ...cleanup,
    { type: 'fill', from: [-6, 57, -8], to: [6, 63, 3], voxel: 0 },
    { type: 'fill', from: [-6, 56, -8], to: [6, 56, 3], voxel: 3 },
    { type: 'fill', from: [-5, 57, -6], to: [5, 60, -6], voxel: 4 },
    { type: 'fill', from: [0, 57, -6], to: [0, 60, -6], voxel: 9 },
    { type: 'fill', from: [-5, 57, -6], to: [-5, 60, -6], voxel: 9 },
    { type: 'fill', from: [5, 57, -6], to: [5, 60, -6], voxel: 9 },
    { type: 'time-set', hours: 22 },
    { type: 'teleport', position: [0.5, 57, 0.5] },
    { type: 'heal', amount: 20 },
    { type: 'spawn-creature', id: ids.dummies[0], position: [-0.9, 57, -1.9] },
    { type: 'spawn-creature', id: ids.dummies[1], position: [0.5, 57, -1.9] },
    { type: 'spawn-creature', id: ids.dummies[2], position: [1.9, 57, -1.9] },
    {
      type: 'spawn-actor',
      id: ids.hostile,
      archetype: 'night-stalker',
      position: [1.7, 57, -0.45],
    },
  ];
}
