import type { EntityLifetimeReference } from '../gameplay/entity-store';
import type { PhysicsInput, BodyState } from '../../physics';
import { WORLD_ITEM_INTERACTION } from '../../physics/body-registry';
import type { InputCommandBuffer } from '../../runtime/session-protocol';
import type { AuthorityEntity, LogicIntent, AuthorityServerPort } from './authority-session-types';

export const ZERO_AUTHORITY_PHYSICS_INPUT: PhysicsInput = {
  wish: { x: 0, z: 0 },
  jumpPressed: false,
  verticalIntent: 0,
};

export function selectAuthorityPhysicsInput(
  entity: AuthorityEntity,
  playerId: string,
  playerInput: ReturnType<InputCommandBuffer['consumeForTick']>,
  logicIntents: Map<string, LogicIntent>,
  physicsTick: number,
  resolveReference?: (reference: EntityLifetimeReference) => boolean,
): PhysicsInput {
  if (entity.id === playerId)
    return {
      wish: { x: playerInput.state.moveX, z: playerInput.state.moveZ },
      jumpPressed: playerInput.jumpRequested,
      verticalIntent: playerInput.state.verticalIntent,
    };
  const intent = logicIntents.get(entity.id);
  if (
    !intent ||
    intent.expiresAtPhysicsTick < physicsTick ||
    (resolveReference &&
      (!intent.entityReference ||
        intent.entityReference.entityId !== entity.id ||
        !resolveReference(intent.entityReference)))
  ) {
    logicIntents.delete(entity.id);
    return ZERO_AUTHORITY_PHYSICS_INPUT;
  }
  return { wish: intent.wish, jumpPressed: intent.jumpRequested, verticalIntent: intent.verticalIntent };
}

export function isAuthorityPlayerBindingCurrent(
  reference: EntityLifetimeReference | null,
  server: Pick<AuthorityServerPort, 'resolveEntityReference'>,
): boolean {
  return !server.resolveEntityReference || (reference !== null && server.resolveEntityReference(reference));
}

export function acceptBoundPhysicsIntents(
  stored: Map<string, LogicIntent>,
  intents: readonly LogicIntent[],
  physicsTick: number,
  resolveReference?: (reference: EntityLifetimeReference) => boolean,
): boolean {
  let valid = true;
  for (const intent of intents) {
    if (
      resolveReference &&
      (!intent.entityReference ||
        intent.entityReference.entityId !== intent.entityId ||
        !resolveReference(intent.entityReference))
    ) {
      valid = false;
      continue;
    }
    if (intent.expiresAtPhysicsTick >= physicsTick)
      stored.set(intent.entityId, {
        ...intent,
        wish: { ...intent.wish },
        ...(intent.entityReference ? { entityReference: { ...intent.entityReference } } : {}),
      });
  }
  return valid;
}

export function worldItemAttraction(state: BodyState, target: BodyState['position']): BodyState['velocity'] | null {
  const delta = {
    x: target.x - state.position.x,
    y: target.y - state.position.y,
    z: target.z - state.position.z,
  };
  const distance = Math.hypot(delta.x, delta.y, delta.z);
  if (distance <= Number.EPSILON) return null;
  return {
    x: (delta.x / distance) * WORLD_ITEM_INTERACTION.attractionSpeed,
    y: (delta.y / distance) * WORLD_ITEM_INTERACTION.attractionSpeed,
    z: (delta.z / distance) * WORLD_ITEM_INTERACTION.attractionSpeed,
  };
}
