import type { PhysicsInput } from '../../physics';
import type { InputCommandBuffer } from '../../runtime/session-protocol';
import type { AuthorityEntity, LogicIntent } from './authority-session-types';

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
): PhysicsInput {
  if (entity.id === playerId)
    return {
      wish: { x: playerInput.state.moveX, z: playerInput.state.moveZ },
      jumpPressed: playerInput.jumpRequested,
      verticalIntent: playerInput.state.verticalIntent,
    };
  const intent = logicIntents.get(entity.id);
  if (!intent || intent.expiresAtPhysicsTick < physicsTick) {
    logicIntents.delete(entity.id);
    return ZERO_AUTHORITY_PHYSICS_INPUT;
  }
  return { wish: intent.wish, jumpPressed: intent.jumpRequested, verticalIntent: intent.verticalIntent };
}
