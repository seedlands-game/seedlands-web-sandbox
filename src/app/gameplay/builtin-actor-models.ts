import * as pc from 'playcanvas';
import {
  actorModelDefinitions,
  playerArmModelDefinition,
  type ActorModelDefinition,
  type ActorModelKind,
} from '../../client/presentation/actor-model-definitions';
import type { GameplayModelAssets } from './gameplay-model-assets';

export type BuiltinActorModelKind = ActorModelKind;

function addDefinition(
  assets: GameplayModelAssets,
  parent: pc.Entity,
  definition: ActorModelDefinition,
  modelId: string,
  castShadows = true,
): void {
  definition.parts.forEach((part) => {
    assets.addBox(
      parent,
      part.id,
      part.material,
      { x: part.position[0], y: part.position[1], z: part.position[2] },
      { x: part.scale[0], y: part.scale[1], z: part.scale[2] },
      { castShadows, modelId },
    );
  });
}

function addSettlerDefinition(
  assets: GameplayModelAssets,
  parent: pc.Entity,
  definition: ActorModelDefinition,
  modelId: string,
): void {
  const arms = definition.parts.filter((part) => /^arm-(left|right)-(sleeve|hand)$/.test(part.id));
  addDefinition(assets, parent, { parts: definition.parts.filter((part) => !arms.includes(part)) }, modelId);
  for (const side of ['left', 'right'] as const) {
    const prefix = `arm-${side}`;
    const sleeve = arms.find((part) => part.id === `${prefix}-sleeve`);
    const hand = arms.find((part) => part.id === `${prefix}-hand`);
    if (!sleeve || !hand) throw new Error(`缺少居民${side === 'left' ? '左' : '右'}臂构件`);
    const pivot = new pc.Entity(`${prefix}-pivot`);
    const shoulder = {
      x: (sleeve.position[0] + hand.position[0]) / 2,
      y: (sleeve.position[1] + hand.position[1]) / 2,
      z: (sleeve.position[2] + hand.position[2]) / 2,
    };
    pivot.setLocalPosition(shoulder.x, shoulder.y, shoulder.z);
    parent.addChild(pivot);
    for (const part of [sleeve, hand])
      assets.addBox(
        pivot,
        part.id,
        part.material,
        { x: part.position[0] - shoulder.x, y: part.position[1] - shoulder.y, z: part.position[2] - shoulder.z },
        { x: part.scale[0], y: part.scale[1], z: part.scale[2] },
        { modelId },
      );
  }
}

/** Adds the canonical block-proportioned player arm used by the viewmodel and asset previews. */
export function addPlayerArm(assets: GameplayModelAssets, parent: pc.Entity, castShadows = false): void {
  addDefinition(assets, parent, playerArmModelDefinition, 'seedlands:model/player-arm', castShadows);
}

/** Adds a built-in actor using the same declarative geometry consumed by the asset catalog. */
export function addBuiltinActorModel(
  assets: GameplayModelAssets,
  parent: pc.Entity,
  kind: BuiltinActorModelKind,
): void {
  const modelId = `seedlands:model/actor/${kind}`;
  if (kind === 'settler') return addSettlerDefinition(assets, parent, actorModelDefinitions.settler, modelId);
  addDefinition(assets, parent, actorModelDefinitions[kind], modelId);
}
