import { voxelRayIsClear } from './voxel-ray';
import type { EntityStore } from './entity-store';
import { getItemDefinition } from './item-registry';
import type { AutonomyRuntime } from '../simulation/autonomy-runtime';
import {
  ACTOR_ATTACK_DISTANCE,
  ACTOR_CONSUME_DISTANCE,
  executeAuthorityAttack,
  executeAuthorityConsume,
  retainAuthorityAction,
  startAuthorityMovement,
  type ActorAuthorityAction,
  type ActorAuthorityActionResult,
} from '../simulation/actor-authority-rules';

type Position = [number, number, number];

export type ActorAuthorityGameplayContext = Readonly<{
  entities: EntityStore;
  simulation: AutonomyRuntime;
  getVoxel: (position: Position) => number;
  isPlayerAlive: (id: string) => boolean;
  damagePlayer: (actorId: string, targetId: string, amount: number) => boolean;
  touch: () => void;
}>;

const inRange = (left: readonly number[], right: readonly number[], radius: number) =>
  left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0) <= radius * radius;
const reject = (reason: string): ActorAuthorityActionResult => ({ accepted: false, changed: false, reason });

function attack(
  context: ActorAuthorityGameplayContext,
  actorId: string,
  targetId: string,
  existingActionId?: string,
): ActorAuthorityActionResult {
  const actor = context.entities.get(actorId);
  const target = context.entities.get(targetId);
  if (!actor || target?.type !== 'player' || !context.isPlayerAlive(targetId)) return reject('invalid-target');
  if (!inRange(actor.position, target.position, ACTOR_ATTACK_DISTANCE)) return reject('out-of-range');
  const from: Position = [actor.position[0], actor.position[1] + 0.9, actor.position[2]];
  const to: Position = [target.position[0], target.position[1] + 0.9, target.position[2]];
  if (!voxelRayIsClear(from, to, (x, y, z) => context.getVoxel([x, y, z]))) return reject('blocked');
  return executeAuthorityAttack(
    context.simulation.authorityRulesContext(),
    actorId,
    targetId,
    () => context.damagePlayer(actorId, targetId, 2),
    () => context.simulation.startAction(actorId, { type: 'attack', targetEntityId: targetId }),
    existingActionId,
  );
}

function consume(
  context: ActorAuthorityGameplayContext,
  actorId: string,
  targetId: string,
  existingActionId?: string,
): ActorAuthorityActionResult {
  const actor = context.entities.get(actorId);
  const target = context.entities.get(targetId);
  const item = target?.stack ? getItemDefinition(target.stack.itemId) : null;
  if (!actor || target?.type !== 'world-item' || !target.stack || item?.itemType !== 'food')
    return reject('invalid-food');
  if (!inRange(actor.position, target.position, ACTOR_CONSUME_DISTANCE)) return reject('out-of-range');
  if (!voxelRayIsClear(actor.position, target.position, (x, y, z) => context.getVoxel([x, y, z])))
    return reject('blocked');
  const result = executeAuthorityConsume(
    context.simulation.authorityRulesContext(),
    actorId,
    targetId,
    () => context.entities.consumeWorldItemUnit(targetId) !== null,
    () => context.simulation.startAction(actorId, { type: 'eat', targetEntityId: targetId }),
    existingActionId,
  );
  if (result.changed) context.touch();
  return result;
}

export function applyActorAuthorityAction(
  context: ActorAuthorityGameplayContext,
  actorId: string,
  action: ActorAuthorityAction,
): ActorAuthorityActionResult {
  const actor = context.simulation.getActor(actorId);
  const entity = context.entities.get(actorId);
  if (!actor || !entity || !actor.active) return reject('actor-inactive');
  if (action.type === 'move-to') {
    const result = startAuthorityMovement(context.simulation.authorityRulesContext(), actorId, action.target, () =>
      context.simulation.startAction(actorId, { type: 'move-to', targetPosition: action.target }),
    );
    if (result.changed) context.touch();
    return result;
  }
  if (action.type === 'start-existing-action') {
    const current = context.simulation.actions.forActor(actorId);
    if (!current || current.id !== action.actionId) return reject('action-mismatch');
    if (current.type === 'attack' && current.targetEntityId)
      return attack(context, actorId, current.targetEntityId, current.id);
    if (current.type === 'eat' && current.targetEntityId)
      return consume(context, actorId, current.targetEntityId, current.id);
    return retainAuthorityAction(context.simulation.authorityRulesContext(), actorId, action.actionId);
  }
  return action.type === 'attack'
    ? attack(context, actorId, action.targetId)
    : consume(context, actorId, action.targetId);
}
