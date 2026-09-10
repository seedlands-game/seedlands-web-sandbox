import type { StationStateCodec } from './ecs-station-state';
import { validateBlockBreakAction } from './modules/block-action-model';
import type { CombatOriginRuntimeOptions } from './combat-origin';
import type { ModuleScheduleSnapshot } from '../composition/lifecycle-contracts';
import type { WorldRulesetV1 } from './modules/ruleset-module';
import { AutonomyRuntime, type SimulationSnapshot } from '../simulation/autonomy-runtime';
import { bodyConfigFor } from '../../physics/body-registry';
import { EntityStore, type EntityStoreComponentSnapshot, type GameplayEntity } from './entity-store';
import { PlayerState, type PlayerSnapshot } from './player-state';
import type { CoreClone } from '../../runtime/platform-ports';
import type { MeleeDefinition } from './combat-runtime';
import { defaultItemDefinitionRegistry, type ItemDefinitionRegistry } from './item-registry';
import type { CompositionCheckpointIdentity } from '../composition/checkpoint-identity';
import type { ActorProfileRegistry } from './actor-profile';
import type { BehaviorCapabilityRegistry } from '../composition/behavior-capability-registry';
import type { CharacterActorDomainPort } from '../simulation/character-runtime-types';
import { validateCharacterSnapshotRecord } from '../simulation/character-runtime-validation';

type Position = [number, number, number];

export type GameplaySnapshotV1 = {
  version: 1;
  revision: number;
  gameplayTime: number;
  entitySequence: number;
  entities: GameplayEntity[];
  players: PlayerSnapshot[];
};
export type GameplaySnapshotV2 = Omit<GameplaySnapshotV1, 'version'> & {
  version: 2;
  worldTime: number;
  simulation: SimulationSnapshot;
};
export const GAMEPLAY_COORDINATE_SCHEMA = Object.freeze({
  version: 1 as const,
  units: 'voxel' as const,
  entityOrigin: 'body-feet-center' as const,
});
export const GAMEPLAY_PHYSICS_SCHEMA = Object.freeze({
  version: 1 as const,
  bodyRegistryVersion: 1 as const,
});
export type GameplaySnapshotV3 = Omit<GameplaySnapshotV2, 'version'> & {
  version: 3;
  coordinateSchema: typeof GAMEPLAY_COORDINATE_SCHEMA;
  physicsSchema: typeof GAMEPLAY_PHYSICS_SCHEMA;
};
export type GameplaySnapshotV4 = Omit<GameplaySnapshotV3, 'version' | 'entitySequence' | 'entities' | 'players'> & {
  version: 4;
  composition?: CompositionCheckpointIdentity;
  ruleset?: WorldRulesetV1;
  moduleSchedule?: ModuleScheduleSnapshot;
  entityStore: EntityStoreComponentSnapshot;
};
export type GameplaySnapshot = GameplaySnapshotV1 | GameplaySnapshotV2 | GameplaySnapshotV3 | GameplaySnapshotV4;

export const createGameplaySnapshotMetadata = () => ({
  coordinateSchema: { ...GAMEPLAY_COORDINATE_SCHEMA },
  physicsSchema: { ...GAMEPLAY_PHYSICS_SCHEMA },
});

export const createGameplaySnapshotV4 = (
  revision: number,
  gameplayTime: number,
  worldTime: number,
  entityStore: EntityStoreComponentSnapshot,
  simulation: SimulationSnapshot,
): GameplaySnapshotV4 => ({
  version: 4,
  revision,
  gameplayTime,
  worldTime,
  entityStore,
  simulation,
  ...createGameplaySnapshotMetadata(),
});

export type ValidatedGameplaySnapshot = {
  snapshot: GameplaySnapshotV4;
  sourceVersion: 1 | 2 | 3 | 4;
  legacyCombatLockouts: Map<string, number>;
};

type GameplaySnapshotValidationOptions = {
  getVoxel: (x: number, y: number, z: number) => number;
  getWorldTime: () => number;
  clone: CoreClone;
  items?: ItemDefinitionRegistry;
  stationCodec?: StationStateCodec;
  meleeDefinitions?: readonly MeleeDefinition[];
  actorProfiles?: ActorProfileRegistry;
  registeredNeeds?: boolean;
  registeredFeeding?: boolean;
  registeredBlocks?: boolean;
  combatOriginFor?(entities: EntityStore): CombatOriginRuntimeOptions;
  needsPlayerLimit?: number;
  behaviorCapabilities?: BehaviorCapabilityRegistry;
};

const LEGACY_PLAYER_EYE_TO_FEET = 1.6;
const worldItemConfig = bodyConfigFor('world-item');
const LEGACY_WORLD_ITEM_CENTER_TO_FEET = (worldItemConfig.localAabb.max.y - worldItemConfig.localAabb.min.y) / 2;
const roundCoordinate = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

export function legacyPlayerPositionToFeet(position: Position): Position {
  if (position.length !== 3 || !position.every(Number.isFinite))
    throw new TypeError('Legacy player position must contain three finite coordinates.');
  return [position[0], roundCoordinate(position[1] - LEGACY_PLAYER_EYE_TO_FEET), position[2]];
}

const emptySimulation = (): SimulationSnapshot => ({
  version: 1,
  time: 0,
  stepAccumulator: 0,
  needsAccumulator: 0,
  perceptionAccumulator: 0,
  behaviorAccumulator: 0,
  starterEcologyVersion: 0,
  actors: [],
  pois: { version: 1, sequence: 0, pois: [] },
  actions: { version: 1, sequence: 0, actions: [] },
});

export const simulationSnapshotFor = (snapshot: GameplaySnapshot): SimulationSnapshot =>
  snapshot.version === 1 ? emptySimulation() : snapshot.simulation;

const migrateLegacyEntity = (entity: GameplayEntity, clone: CoreClone): GameplayEntity => {
  const offset =
    entity.type === 'player'
      ? LEGACY_PLAYER_EYE_TO_FEET
      : entity.type === 'world-item'
        ? LEGACY_WORLD_ITEM_CENTER_TO_FEET
        : 0;
  return {
    ...clone(entity),
    position: [entity.position[0], roundCoordinate(entity.position[1] - offset), entity.position[2]],
  };
};

const migrateLegacyPlayer = (player: PlayerSnapshot, clone: CoreClone): PlayerSnapshot => ({
  ...clone(player),
  spawnPosition: legacyPlayerPositionToFeet(player.spawnPosition),
});

function migrateLegacyCharacterBodies(
  snapshot: SimulationSnapshot,
  entities: EntityStore,
  items: ItemDefinitionRegistry,
  capabilities: BehaviorCapabilityRegistry | undefined,
): void {
  if (!snapshot.characters) return;
  if (!capabilities) throw new TypeError('Legacy Character state requires the behavior module.');
  if (snapshot.characters.version !== 1 && snapshot.characters.version !== 2)
    throw new TypeError('Legacy Character snapshot version is invalid.');
  const active = snapshot.characters.characters.filter((character) => character.lifecycle === 'active');
  if (active.length === 0) return;
  const componentSnapshot = entities.exportComponentSnapshot();
  const actors = new Map(componentSnapshot.actors.map((actor) => [actor.entityId, actor]));
  const autonomous = new Map(snapshot.actors.map((actor) => [actor.entityId, actor]));
  for (const character of snapshot.characters.characters) {
    validateCharacterSnapshotRecord(character, capabilities);
    if (character.lifecycle !== 'active') continue;
    const entity = entities.get(character.entityId);
    const actor = actors.get(character.entityId);
    const legacyActor = autonomous.get(character.entityId);
    if (!entity || entity.type !== 'npc' || entity.archetype !== 'settler' || !actor || !legacyActor)
      throw new TypeError(`Legacy Character actor is missing: ${character.entityId}`);
    if (!character.inventory || character.inventory.length !== 12)
      throw new TypeError(`Legacy Character inventory is missing: ${character.entityId}`);
    if (character.hunger === undefined || character.hunger !== legacyActor.hunger)
      throw new TypeError(`Legacy Character needs do not match simulation state: ${character.entityId}`);
    const inventory = character.inventory.map((stack) =>
      stack === null ? null : items.normalizeStack(stack, { migrateLegacyDurability: 'initialize-at-max' }),
    );
    actors.set(character.entityId, {
      ...actor,
      inventory: [...inventory, ...Array.from({ length: 12 }, () => null)],
      needs: { ...actor.needs, hunger: character.hunger },
    });
  }
  entities.restoreComponentSnapshot({ ...componentSnapshot, actors: [...actors.values()] });
}

const validationCharacterDomain = (entities: EntityStore): CharacterActorDomainPort =>
  Object.freeze({
    read: (actorId: string) => {
      const entity = entities.get(actorId);
      const reference = entities.createReference(actorId);
      if (!entity || !reference || !['player', 'creature', 'npc'].includes(entity.type)) return null;
      const actor = entities.actorStateAccess(actorId);
      return Object.freeze({
        reference,
        lifecycle: actor.lifecycle,
        controlSource: actor.controlSource,
        controlRevision: actor.controlRevision,
        health: entity.health!,
        maxHealth: entity.maxHealth!,
        needs: Object.freeze({
          hunger: actor.hunger,
          maxHunger: actor.maxHunger,
          hungerMeaning: actor.hungerMeaning,
        }),
        inventory: Object.freeze({
          slots: Object.freeze(actor.inventory.snapshot()),
          selectedSlot: actor.selectedSlot,
          revision: actor.inventoryRevision,
        }),
      });
    },
    invoke: () => ({
      ok: false as const,
      code: 'SNAPSHOT_VALIDATION_ONLY',
      message: 'Registered operations are unavailable while validating a snapshot.',
    }),
  });

function validatePlayerSnapshot(player: PlayerSnapshot): void {
  const nonNegative = [
    player.attackCooldownSeconds,
    player.hungerAccumulator,
    player.healingAccumulator,
    player.starvationAccumulator,
  ];
  if (
    !player.entityId?.trim() ||
    player.maxHealth !== 20 ||
    player.maxHunger !== 20 ||
    player.hotbarSize !== 8 ||
    !player.spawnPosition?.every(Number.isFinite) ||
    nonNegative.some((value) => !Number.isFinite(value) || value < 0)
  )
    throw new TypeError('player state fields are invalid');
  if (
    player.breakAction &&
    (!player.breakAction.position.every(Number.isFinite) ||
      !Number.isFinite(player.breakAction.elapsedSeconds) ||
      player.breakAction.elapsedSeconds < 0 ||
      !Number.isFinite(player.breakAction.requiredSeconds) ||
      player.breakAction.requiredSeconds < 0 ||
      !Number.isInteger(player.breakAction.voxel) ||
      player.breakAction.voxel < 0)
  )
    throw new TypeError('player break action is invalid');
}

function validateCurrentSchemas(snapshot: GameplaySnapshotV3 | GameplaySnapshotV4): void {
  if (
    snapshot.coordinateSchema?.version !== GAMEPLAY_COORDINATE_SCHEMA.version ||
    snapshot.coordinateSchema.units !== GAMEPLAY_COORDINATE_SCHEMA.units ||
    snapshot.coordinateSchema.entityOrigin !== GAMEPLAY_COORDINATE_SCHEMA.entityOrigin
  )
    throw new TypeError('coordinate schema is unsupported');
  if (
    snapshot.physicsSchema?.version !== GAMEPLAY_PHYSICS_SCHEMA.version ||
    snapshot.physicsSchema.bodyRegistryVersion !== GAMEPLAY_PHYSICS_SCHEMA.bodyRegistryVersion
  )
    throw new TypeError('physics schema is unsupported');
}

export function validateGameplaySnapshot(
  raw: unknown,
  options: GameplaySnapshotValidationOptions,
): ValidatedGameplaySnapshot {
  const source = raw as GameplaySnapshot;
  if (
    !source ||
    (source.version !== 1 && source.version !== 2 && source.version !== 3 && source.version !== 4) ||
    !Number.isInteger(source.revision) ||
    source.revision < 0 ||
    !Number.isFinite(source.gameplayTime) ||
    source.gameplayTime < 0
  )
    throw new TypeError('header is invalid');
  if (source.version === 3 || source.version === 4) validateCurrentSchemas(source);
  if (
    source.version !== 4 &&
    (!Number.isInteger(source.entitySequence) ||
      source.entitySequence < 0 ||
      !Array.isArray(source.entities) ||
      !Array.isArray(source.players))
  )
    throw new TypeError('legacy entity header is invalid');
  const worldTime = source.version === 1 ? options.getWorldTime() : source.worldTime;
  if (!Number.isFinite(worldTime) || worldTime < 0 || worldTime >= 24) throw new TypeError('world time is invalid');

  const sourceVersion = source.version;
  const items = options.items ?? defaultItemDefinitionRegistry;
  const entities = new EntityStore(items, options.stationCodec);
  const players = new Map<string, PlayerState>();
  const legacyCombatLockouts = new Map<string, number>();
  try {
    if (source.version === 4) {
      entities.restoreComponentSnapshot(options.clone(source.entityStore));
      for (const entity of entities.query({ type: 'player' })) {
        const access = entities.playerStateAccess(entity.id);
        players.set(entity.id, new PlayerState(entity.id, access.spawnPosition, undefined, entities));
      }
      if (Array.isArray(source.simulation?.actors)) {
        for (const actor of source.simulation.actors) {
          if (
            typeof actor?.entityId === 'string' &&
            entities.get(actor.entityId) &&
            entities.actorStateAccess(actor.entityId).hunger !== actor.hunger
          )
            throw new TypeError(`Actor needs do not match simulation state: ${actor.entityId}`);
        }
      }
    } else {
      const migratedEntities =
        sourceVersion === 3
          ? options.clone(source.entities)
          : source.entities.map((entity) => migrateLegacyEntity(entity, options.clone));
      const migratedPlayers =
        sourceVersion === 3
          ? options.clone(source.players)
          : source.players.map((player) => migrateLegacyPlayer(player, options.clone));
      // Only V1-V3 may omit tool instances; the normalized V4 output is strict thereafter.
      for (const entity of migratedEntities) {
        if (entity.type === 'world-item' && entity.stack)
          entity.stack = items.normalizeStack(entity.stack, { migrateLegacyDurability: 'initialize-at-max' });
      }
      for (const player of migratedPlayers) {
        if (!Array.isArray(player.inventory)) throw new TypeError('Legacy player inventory is invalid.');
        player.inventory = player.inventory.map((stack) =>
          stack === null ? null : items.normalizeStack(stack, { migrateLegacyDurability: 'initialize-at-max' }),
        );
      }
      entities.restore(migratedEntities, source.entitySequence);
      migratedPlayers.forEach((player) => {
        validatePlayerSnapshot(player);
        const entity = entities.get(player.entityId);
        if (!entity || entity.type !== 'player') throw new TypeError('player entity is missing');
        if (players.has(player.entityId)) throw new TypeError('player state is duplicated');
        players.set(
          player.entityId,
          new PlayerState(player.entityId, [...player.spawnPosition] as Position, player, entities),
        );
        if ((source.version === 1 || !source.simulation.combat) && player.attackCooldownSeconds > 0)
          legacyCombatLockouts.set(player.entityId, player.attackCooldownSeconds);
      });
      migrateLegacyCharacterBodies(simulationSnapshotFor(source), entities, items, options.behaviorCapabilities);
    }
    if (options.registeredBlocks) {
      for (const player of players.values()) {
        const action = player.breakAction;
        if (!action) continue;
        if (sourceVersion < 4 || !action.origin) {
          player.breakAction = null;
          continue;
        }
        validateBlockBreakAction(action);
        const reference = entities.createReference(player.entityId);
        if (
          action.origin.originalActor.entityId !== player.entityId ||
          action.origin.originalActor.lifetime !== reference?.lifetime
        )
          throw new TypeError('Break origin actor lifetime does not match the restored actor.');
      }
    }
    if (entities.query({ type: 'player' }).length !== players.size) throw new TypeError('player state is missing');
    if (options.needsPlayerLimit !== undefined && players.size > options.needsPlayerLimit)
      throw new RangeError('Needs player membership budget exceeded.');

    const validator = new AutonomyRuntime({
      entities,
      getVoxel: options.getVoxel,
      getWorldTime: options.getWorldTime,
      isPlayerAlive: (id) => players.get(id)?.lifecycle === 'alive',
      clone: options.clone,
      meleeDefinitions: options.meleeDefinitions,
      actorProfiles: options.actorProfiles,
      combatOrigin: options.combatOriginFor?.(entities),
      ...(options.behaviorCapabilities
        ? {
            character: {
              capabilities: options.behaviorCapabilities,
              domain: validationCharacterDomain(entities),
              changed: () => undefined,
            },
          }
        : {}),
    });
    validator.restore(simulationSnapshotFor(source));
    if (options.registeredFeeding) {
      // Registered Feeding commits immediately; a pending Eat has no durable authorization origin.
      for (const actorId of validator.actorIds()) {
        if (validator.actionForActor(actorId)?.type !== 'eat') continue;
        const cancellation = validator.prepareInterruption(actorId, 'restore-cancelled');
        cancellation.validate();
        cancellation.apply();
      }
    }
    const snapshot = createGameplaySnapshotV4(
      source.revision,
      source.gameplayTime,
      worldTime,
      entities.exportComponentSnapshot(),
      validator.snapshot(),
    );
    if (options.registeredNeeds && sourceVersion < 4) {
      const phase =
        Math.round((snapshot.simulation.needsAccumulator + snapshot.simulation.stepAccumulator) * 1e9) / 1e9;
      if (!Number.isFinite(phase) || phase > Number.MAX_SAFE_INTEGER)
        throw new TypeError('Legacy needs phase is invalid.');
      const ids = new Set(snapshot.simulation.actors.map((actor) => actor.entityId));
      for (const actor of snapshot.entityStore.actors)
        if (ids.has(actor.entityId)) actor.needs.hungerAccumulator = phase;
      snapshot.simulation.needsAccumulator = 0;
    }
    return { snapshot, sourceVersion, legacyCombatLockouts };
  } finally {
    entities.dispose();
  }
}

export function restoreGameplayRuntimeSnapshot(
  raw: unknown,
  options: GameplaySnapshotValidationOptions & {
    entities: EntityStore;
    simulation: AutonomyRuntime;
    players: Map<string, PlayerState>;
    installMetadata: (gameplayTime: number, revision: number) => void;
  },
): { version: 1 | 2 | 3 | 4; worldTime?: number } {
  try {
    const { snapshot, sourceVersion, legacyCombatLockouts } = validateGameplaySnapshot(raw, options);
    options.entities.restoreComponentSnapshot(snapshot.entityStore);
    options.players.clear();
    for (const entity of options.entities.query({ type: 'player' })) {
      const state = options.entities.playerStateAccess(entity.id);
      options.players.set(entity.id, new PlayerState(entity.id, state.spawnPosition, undefined, options.entities));
    }
    options.installMetadata(snapshot.gameplayTime, snapshot.revision);
    options.simulation.restore(simulationSnapshotFor(snapshot));
    legacyCombatLockouts.forEach((seconds, actorId) => options.simulation.restoreCombatLockout(actorId, seconds));
    return sourceVersion === 1 ? { version: 1 } : { version: sourceVersion, worldTime: snapshot.worldTime };
  } catch (error) {
    throw new Error(`Invalid gameplay snapshot: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}
