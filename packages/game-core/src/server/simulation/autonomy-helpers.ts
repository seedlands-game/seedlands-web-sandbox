import type { EntityStore, GameplayEntity } from '../gameplay/entity-store';
import type { ActionRuntime, ActorAction, ActorActionInput, ActorActionType } from './action-runtime';
import type { ActorProfileRegistry } from '../gameplay/actor-profile';
import {
  ACTIVE_RADIUS_SQUARED,
  MAX_RETAINED_ACTORS,
  cloneActor,
  simulationDistanceSquared,
  type ActorRegistration,
  type ActorState,
} from './actor-state';
import type { NavigationPosition } from './ground-navigator';
import type { PoiRegistry } from './poi-registry';
import type { CharacterRuntime } from './character-runtime';
import type { SimulationSnapshot } from './actor-state';

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

export function bindActorNeeds(actor: ActorState, entities: EntityStore): void {
  const state = entities.actorStateAccess(actor.entityId);
  state.hunger = actor.hunger;
  Object.defineProperty(actor, 'hunger', {
    enumerable: true,
    configurable: true,
    get: () => state.hunger,
    set: (value: number) => {
      state.hunger = value;
    },
  });
}

export function registerAutonomyActor(
  entityId: string,
  input: ActorRegistration,
  options: Readonly<{
    actors: Map<string, ActorState>;
    entities: EntityStore;
    profiles: ActorProfileRegistry;
    enforceProfiles?: boolean;
    isPlayerAlive(id: string): boolean;
  }>,
): ActorState {
  if (options.actors.size >= MAX_RETAINED_ACTORS) throw new Error('Autonomous actor limit reached.');
  if (options.actors.has(entityId)) throw new Error(`Actor already registered: ${entityId}`);
  const entity = options.entities.get(entityId);
  if (!entity || entity.archetype !== input.archetype || !['creature', 'npc'].includes(entity.type))
    throw new TypeError('Actor registration does not match a canonical autonomous entity.');
  const profile = options.profiles.require(input.archetype);
  if (options.enforceProfiles && (entity.type !== profile.entityType || entity.maxHealth !== profile.maxHealth))
    throw new TypeError('Actor entity does not match its world profile.');
  const hunger = input.hunger ?? 0;
  if (!Number.isFinite(hunger) || hunger < 0 || hunger > 100) throw new TypeError('Actor hunger is invalid.');
  const actor: ActorState = {
    entityId,
    archetype: input.archetype,
    hunger,
    behavior: profile.initialBehavior ?? 'idle',
    targetEntityId: null,
    homePoiId: input.homePoiId ?? null,
    workPoiId: input.workPoiId ?? null,
    foodPoiId: input.foodPoiId ?? null,
    active: false,
    wanderIndex: 0,
  };
  bindActorNeeds(actor, options.entities);
  options.actors.set(entityId, actor);
  updateActorActive(actor, options.entities, options.isPlayerAlive);
  return cloneActor(actor);
}

export function restoreAutonomyCharacters(
  characters: CharacterRuntime | null,
  snapshot: SimulationSnapshot,
  entities: EntityStore,
): void {
  if (!characters) {
    if (
      snapshot.characters ||
      snapshot.characterTombstones ||
      entities.query({ type: 'npc' }).some((entity) => Boolean(entities.bindActorCharacterComponent(entity.id)))
    )
      throw new TypeError('Character state requires the behavior module.');
    return;
  }
  if (snapshot.characters && snapshot.characterTombstones)
    throw new TypeError('Legacy Character state cannot include Character tombstones.');
  if (snapshot.characters) return characters.restore(snapshot.characters);
  characters.restoreFromComponents();
  if (snapshot.characterTombstones) characters.restoreTombstones(snapshot.characterTombstones);
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
