import type { ModelMaterialId } from './model-material-definitions';

export type ActorModelKind = 'player';
export type ModelVector = readonly [number, number, number];
export type ActorModelPart = Readonly<{
  id: string;
  material: ModelMaterialId;
  position: ModelVector;
  scale: ModelVector;
}>;
export type ActorModelDefinition = Readonly<{ parts: readonly ActorModelPart[] }>;

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
  player: playerModelDefinition,
};
