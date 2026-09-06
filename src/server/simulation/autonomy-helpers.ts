import type { EntityStore, GameplayEntity } from '../gameplay/entity-store';
import type { ActionRuntime, ActorAction, ActorActionInput, ActorActionType } from './action-runtime';
import { ACTIVE_RADIUS_SQUARED, simulationDistanceSquared, type ActorState } from './actor-state';
import type { NavigationPosition } from './ground-navigator';
import type { PoiRegistry } from './poi-registry';

export function resolveActionTarget(
  action: ActorAction,
  entities: EntityStore,
  pois: PoiRegistry,
): NavigationPosition | null {
  if (action.targetPosition) return [...action.targetPosition];
  if (action.targetEntityId) return entities.get(action.targetEntityId)?.position ?? null;
  if (action.poiId) return pois.get(action.poiId)?.position ?? null;
  return null;
}

export function actorIsAtPoi(entity: GameplayEntity, poiId: string, pois: PoiRegistry): boolean {
  const poi = pois.get(poiId);
  return Boolean(poi && simulationDistanceSquared(entity.position, poi.position) <= 0.8 ** 2);
}

export function fleeTarget(
  from: readonly [number, number, number],
  threat?: readonly [number, number, number],
): NavigationPosition {
  const dx = threat ? from[0] - threat[0] : 1;
  const dz = threat ? from[2] - threat[2] : 0;
  const length = Math.hypot(dx, dz) || 1;
  return [from[0] + (dx / length) * 6, from[1], from[2] + (dz / length) * 6];
}

export function wanderTarget(entity: GameplayEntity, index: number): NavigationPosition {
  const seed = [...entity.id].reduce((sum, character) => sum + character.charCodeAt(0), 0) + index;
  const [dx, dz] = [
    [3, 0],
    [0, 3],
    [-3, 0],
    [0, -3],
  ][seed % 4];
  return [entity.position[0] + dx, entity.position[1], entity.position[2] + dz];
}

export function updateActorActive(
  actor: ActorState,
  entities: EntityStore,
  isPlayerAlive: (id: string) => boolean,
): void {
  const entity = entities.get(actor.entityId);
  actor.active = Boolean(
    entity &&
    entities
      .query({ type: 'player' })
      .some(
        (player) =>
          isPlayerAlive(player.id) &&
          simulationDistanceSquared(entity.position, player.position) <= ACTIVE_RADIUS_SQUARED,
      ),
  );
}

export function ensureActorAction(
  actions: ActionRuntime,
  actor: ActorState,
  type: ActorActionType,
  target: Partial<Pick<ActorActionInput, 'targetPosition' | 'targetEntityId' | 'poiId'>>,
  start: () => void,
): void {
  const current = actions.forActor(actor.entityId);
  if (
    current?.type === type &&
    current.targetEntityId === target.targetEntityId &&
    current.poiId === target.poiId &&
    JSON.stringify(current.targetPosition) === JSON.stringify(target.targetPosition)
  )
    return;
  start();
}
