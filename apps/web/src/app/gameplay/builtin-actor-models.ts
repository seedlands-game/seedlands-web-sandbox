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
  addDefinition(assets, parent, actorModelDefinitions[kind], modelId);
}
