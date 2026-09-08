import type { ModelMaterialId } from './model-material-definitions';

export type ActorModelKind = 'grazer' | 'stalker' | 'settler' | 'player';
export type ModelVector = readonly [number, number, number];
export type ActorModelPart = Readonly<{
  id: string;
  material: ModelMaterialId;
  position: ModelVector;
  scale: ModelVector;
}>;
export type ActorModelDefinition = Readonly<{ parts: readonly ActorModelPart[] }>;

const grazer: ActorModelDefinition = {
  parts: [
    { id: 'grazer-body', material: 'fur', position: [0, 0.76, 0.08], scale: [0.78, 0.54, 1.28] },
    { id: 'grazer-chest-patch', material: 'cream', position: [0, 0.77, 0.55], scale: [0.56, 0.42, 0.06] },
    { id: 'grazer-neck', material: 'fur', position: [0, 1.12, 0.43], scale: [0.34, 0.52, 0.32] },
    { id: 'grazer-head', material: 'fur', position: [0, 1.42, 0.7], scale: [0.48, 0.4, 0.52] },
    { id: 'grazer-muzzle', material: 'cream', position: [0, 1.32, 1], scale: [0.38, 0.24, 0.25] },
    { id: 'grazer-ear-left', material: 'fur', position: [-0.23, 1.74, 0.69], scale: [0.13, 0.26, 0.13] },
    { id: 'grazer-ear-right', material: 'fur', position: [0.23, 1.74, 0.69], scale: [0.13, 0.26, 0.13] },
    { id: 'eye-left', material: 'eye', position: [-0.22, 1.5, 0.97], scale: [0.08, 0.08, 0.045] },
    { id: 'eye-right', material: 'eye', position: [0.22, 1.5, 0.97], scale: [0.08, 0.08, 0.045] },
    { id: 'front-left-leg', material: 'boot', position: [-0.3, 0.29, -0.4], scale: [0.2, 0.64, 0.22] },
    { id: 'front-right-leg', material: 'boot', position: [0.3, 0.29, -0.4], scale: [0.2, 0.64, 0.22] },
    { id: 'back-left-leg', material: 'boot', position: [-0.3, 0.29, 0.4], scale: [0.2, 0.64, 0.22] },
    { id: 'back-right-leg', material: 'boot', position: [0.3, 0.29, 0.4], scale: [0.2, 0.64, 0.22] },
  ],
};

const stalker: ActorModelDefinition = {
  parts: [
    { id: 'stalker-body-rear', material: 'charcoal', position: [0, 0.7, 0.3], scale: [0.78, 0.58, 0.72] },
    { id: 'stalker-body-front', material: 'charcoal', position: [0, 0.85, -0.24], scale: [0.9, 0.68, 0.75] },
    { id: 'stalker-head', material: 'charcoal', position: [0, 1.31, 0.65], scale: [0.64, 0.48, 0.55] },
    { id: 'stalker-jaw', material: 'teal', position: [0, 1.12, 0.9], scale: [0.47, 0.14, 0.22] },
    { id: 'eye-left', material: 'glow-eye', position: [-0.2, 1.38, 0.94], scale: [0.08, 0.08, 0.045] },
    { id: 'eye-right', material: 'glow-eye', position: [0.2, 1.38, 0.94], scale: [0.08, 0.08, 0.045] },
    { id: 'spine-left', material: 'teal', position: [-0.24, 1.24, 0.05], scale: [0.12, 0.42, 0.2] },
    { id: 'spine-mid', material: 'teal', position: [0, 1.24, 0.05], scale: [0.12, 0.42, 0.2] },
    { id: 'spine-right', material: 'teal', position: [0.24, 1.24, 0.05], scale: [0.12, 0.42, 0.2] },
    { id: 'front-left-leg', material: 'teal', position: [-0.3, 0.29, -0.4], scale: [0.18, 0.576, 0.198] },
    { id: 'front-right-leg', material: 'teal', position: [0.3, 0.29, -0.4], scale: [0.18, 0.576, 0.198] },
    { id: 'back-left-leg', material: 'teal', position: [-0.3, 0.29, 0.4], scale: [0.18, 0.576, 0.198] },
    { id: 'back-right-leg', material: 'teal', position: [0.3, 0.29, 0.4], scale: [0.18, 0.576, 0.198] },
  ],
};

const playerArmSegments = [
  {
    id: 'sleeve',
    material: 'cloth',
    position: [0, 0.1875, 0] as ModelVector,
    scale: [0.25, 0.375, 0.25] as ModelVector,
  },
  { id: 'hand', material: 'skin', position: [0, -0.1875, 0] as ModelVector, scale: [0.25, 0.375, 0.25] as ModelVector },
] as const satisfies readonly ActorModelPart[];

function armParts(prefix: string, x: number, y: number, z: number): ActorModelPart[] {
  return playerArmSegments.map((part) => ({
    id: `${prefix}-${part.id}`,
    material: part.material,
    position: [x + part.position[0], y + part.position[1], z + part.position[2]],
    scale: part.scale,
  }));
}

const settler: ActorModelDefinition = {
  parts: [
    { id: 'settler-tunic', material: 'cloth', position: [0, 1.125, 0], scale: [0.5, 0.75, 0.25] },
    { id: 'settler-belt', material: 'brass', position: [0, 0.875, 0.01], scale: [0.52, 0.08, 0.27] },
    { id: 'settler-head', material: 'skin', position: [0, 1.75, 0], scale: [0.5, 0.5, 0.5] },
    { id: 'settler-hair', material: 'charcoal', position: [0, 2.01, -0.02], scale: [0.52, 0.12, 0.52] },
    { id: 'settler-brow-left', material: 'charcoal', position: [-0.13, 1.84, 0.26], scale: [0.1, 0.03, 0.025] },
    { id: 'settler-brow-right', material: 'charcoal', position: [0.13, 1.84, 0.26], scale: [0.1, 0.03, 0.025] },
    { id: 'settler-nose', material: 'skin', position: [0, 1.73, 0.27], scale: [0.07, 0.1, 0.05] },
    { id: 'settler-beard', material: 'umber', position: [0, 1.56, 0.27], scale: [0.3, 0.16, 0.04] },
    { id: 'eye-left', material: 'eye', position: [-0.13, 1.75, 0.26], scale: [0.065, 0.065, 0.025] },
    { id: 'eye-right', material: 'eye', position: [0.13, 1.75, 0.26], scale: [0.065, 0.065, 0.025] },
    { id: 'settler-pack', material: 'umber', position: [0, 1.12, -0.2], scale: [0.42, 0.55, 0.13] },
    ...armParts('arm-left', -0.375, 1.125, 0),
    ...armParts('arm-right', 0.375, 1.125, 0),
    { id: 'leg-left', material: 'boot', position: [-0.125, 0.375, 0], scale: [0.25, 0.75, 0.25] },
    { id: 'leg-right', material: 'boot', position: [0.125, 0.375, 0], scale: [0.25, 0.75, 0.25] },
  ],
};

export const playerArmModelDefinition: ActorModelDefinition = { parts: playerArmSegments };
export const playerModelDefinition: ActorModelDefinition = {
  parts: [
    { id: 'player-head', material: 'skin', position: [0, 1.75, 0], scale: [0.5, 0.5, 0.5] },
    { id: 'player-hair', material: 'charcoal', position: [0, 2.01, -0.02], scale: [0.52, 0.12, 0.52] },
    { id: 'player-eye-left', material: 'eye', position: [-0.13, 1.75, 0.26], scale: [0.065, 0.065, 0.025] },
    { id: 'player-eye-right', material: 'eye', position: [0.13, 1.75, 0.26], scale: [0.065, 0.065, 0.025] },
    { id: 'player-torso', material: 'cloth', position: [0, 1.125, 0], scale: [0.5, 0.75, 0.25] },
    ...armParts('player-arm-left', -0.375, 1.125, 0),
    ...armParts('player-arm-right', 0.375, 1.125, 0),
    { id: 'player-leg-left', material: 'boot', position: [-0.125, 0.375, 0], scale: [0.25, 0.75, 0.25] },
    { id: 'player-leg-right', material: 'boot', position: [0.125, 0.375, 0], scale: [0.25, 0.75, 0.25] },
  ],
};

export const actorModelDefinitions: Readonly<Record<ActorModelKind, ActorModelDefinition>> = {
  grazer,
  stalker,
  settler,
  player: playerModelDefinition,
};
