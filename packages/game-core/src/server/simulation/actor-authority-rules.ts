import type { ActorAction } from './action-runtime';
import type { ActionRuntime } from './action-runtime';
import type { EntityStore } from '../gameplay/entity-store';
import type { ActorState } from './actor-state';
import type { NavigationPosition } from './ground-navigator';

export type ActorAuthorityAction =
  | Readonly<{ type: 'attack'; targetId: string }>
  | Readonly<{ type: 'move-to'; target: [number, number, number] }>
  | Readonly<{ type: 'consume-world-item'; targetId: string }>
  | Readonly<{ type: 'start-existing-action'; actionId: string }>;

export type ActorAuthorityActionResult = Readonly<
  { accepted: true; changed: boolean; action?: ActorAction } | { accepted: false; changed: boolean; reason: string }
>;

export const ACTOR_ATTACK_DISTANCE = 1.7;
export const ACTOR_CONSUME_DISTANCE = 1.1;
export const ACTOR_MOVE_ARRIVAL_DISTANCE = 0.8;

export type ActorAuthorityRulesContext = Readonly<{
  actors: Map<string, ActorState>;
  actions: ActionRuntime;
  entities: EntityStore;
  time: number;
  worldTime: number;
  updateActive: (actor: ActorState) => void;
  actionTarget: (action: ActorAction) => NavigationPosition | null;
  finishSuccess: (id: string, result?: unknown) => void;
  finishFailure: (id: string, reason: string) => void;
}>;

const reject = (reason: string): ActorAuthorityActionResult => ({ accepted: false, changed: false, reason });
const distanceSquared = (left: readonly number[], right: readonly number[]) =>
  left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0);

export function startAuthorityMovement(
  context: ActorAuthorityRulesContext,
  actorId: string,
  target: NavigationPosition,
  start: () => ActorAction,
): ActorAuthorityActionResult {
  const actor = context.actors.get(actorId);
  const entity = context.entities.get(actorId);
  if (!actor || !entity || !actor.active) return reject('actor-inactive');
  const current = context.actions.forActor(actorId);
  if (
    current?.type === 'move-to' &&
    current.targetPosition?.every((value, index) => Math.abs(value - target[index]) <= 1e-6)
  )
    return { accepted: true, changed: false, action: current };
  const action = start();
  const running = context.actions.markRunning(action.id, [entity.position, target]);
  if (actor.behavior !== 'flee') {
    if (actor.archetype === 'grazer') actor.behavior = actor.hunger >= 50 ? 'seek-food' : 'wander';
    else if (actor.archetype === 'night-stalker') actor.behavior = 'chase';
    else actor.behavior = context.worldTime >= 6 && context.worldTime < 18 ? 'routine-work' : 'routine-home';
  }
  return { accepted: true, changed: true, action: running };
}

export function retainAuthorityAction(
  context: ActorAuthorityRulesContext,
  actorId: string,
  actionId: string,
): ActorAuthorityActionResult {
  const current = context.actions.forActor(actorId);
  return !current || current.id !== actionId
    ? reject('action-mismatch')
    : { accepted: true, changed: false, action: current };
}

export function executeAuthorityConsume(
  context: ActorAuthorityRulesContext,
  actorId: string,
  targetId: string,
  consume: () => boolean,
  start: () => ActorAction,
  existingActionId?: string,
): ActorAuthorityActionResult {
  const actor = context.actors.get(actorId);
  if (!actor || actor.archetype !== 'grazer' || actor.hunger < 50) return reject('not-hungry');
  const existing = existingActionId ? context.actions.forActor(actorId) : null;
  if (existingActionId && (!existing || existing.id !== existingActionId || existing.type !== 'eat'))
    return reject('action-mismatch');
  const action = existing ?? start();
  context.actions.markRunning(action.id, []);
  if (!consume()) {
    context.finishFailure(action.id, 'food-missing');
    return { accepted: false, changed: true, reason: 'food-missing' };
  }
  actor.hunger = 0;
  actor.behavior = 'idle';
  actor.targetEntityId = null;
  context.finishSuccess(action.id, { consumedEntityId: targetId, count: 1 });
  return { accepted: true, changed: true, action: context.actions.get(action.id)! };
}

export function tickAuthorityActorRules(context: ActorAuthorityRulesContext, elapsedSeconds: number): void {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0)
    throw new RangeError('Actor rule elapsed seconds must be non-negative and finite.');
  context.actors.forEach((actor) => {
    context.updateActive(actor);
    const action = context.actions.forActor(actor.entityId);
    if (!action || !['move-to', 'wander', 'flee', 'go-to-poi'].includes(action.type)) return;
    const entity = context.entities.get(actor.entityId);
    const target = context.actionTarget(action);
    if (!entity || !target) return context.finishFailure(action.id, entity ? 'target-missing' : 'actor-missing');
    if (distanceSquared(entity.position, target) > ACTOR_MOVE_ARRIVAL_DISTANCE ** 2) return;
    actor.behavior = 'idle';
    actor.targetEntityId = null;
    context.finishSuccess(action.id, { position: entity.position });
  });
}
