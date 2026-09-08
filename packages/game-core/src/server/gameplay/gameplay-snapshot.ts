import { AutonomyRuntime, type SimulationSnapshot } from '../simulation/autonomy-runtime';
import { bodyConfigFor } from '../../physics/body-registry';
import { EntityStore, type GameplayEntity } from './entity-store';
import { PlayerState, type PlayerSnapshot } from './player-state';
import type { CoreClone } from '../../runtime/platform-ports';

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
export type GameplaySnapshot = GameplaySnapshotV1 | GameplaySnapshotV2 | GameplaySnapshotV3;

export const createGameplaySnapshotMetadata = () => ({
  coordinateSchema: { ...GAMEPLAY_COORDINATE_SCHEMA },
  physicsSchema: { ...GAMEPLAY_PHYSICS_SCHEMA },
});

export type ValidatedGameplaySnapshot = {
  snapshot: GameplaySnapshotV3;
  sourceVersion: 1 | 2 | 3;
  entities: EntityStore;
  players: Map<string, PlayerState>;
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

function validateV3Schemas(snapshot: GameplaySnapshotV3): void {
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
  options: {
    getVoxel: (x: number, y: number, z: number) => number;
    getWorldTime: () => number;
    clone: CoreClone;
  },
): ValidatedGameplaySnapshot {
  const source = raw as GameplaySnapshot;
  if (
    !source ||
    (source.version !== 1 && source.version !== 2 && source.version !== 3) ||
    !Number.isInteger(source.revision) ||
    source.revision < 0 ||
    !Number.isFinite(source.gameplayTime) ||
    source.gameplayTime < 0 ||
    !Number.isInteger(source.entitySequence) ||
    source.entitySequence < 0 ||
    !Array.isArray(source.entities) ||
    !Array.isArray(source.players)
  )
    throw new TypeError('header is invalid');
  if (source.version === 3) validateV3Schemas(source);
  const worldTime = source.version === 1 ? options.getWorldTime() : source.worldTime;
  if (!Number.isFinite(worldTime) || worldTime < 0 || worldTime >= 24) throw new TypeError('world time is invalid');

  const sourceVersion = source.version;
  const migratedEntities =
    sourceVersion === 3
      ? options.clone(source.entities)
      : source.entities.map((entity) => migrateLegacyEntity(entity, options.clone));
  const migratedPlayers =
    sourceVersion === 3
      ? options.clone(source.players)
      : source.players.map((player) => migrateLegacyPlayer(player, options.clone));

  const entities = new EntityStore();
  entities.restore(migratedEntities, source.entitySequence);
  const players = new Map<string, PlayerState>();
  migratedPlayers.forEach((player) => {
    validatePlayerSnapshot(player);
    const entity = entities.get(player.entityId);
    if (!entity || entity.type !== 'player') throw new TypeError('player entity is missing');
    if (players.has(player.entityId)) throw new TypeError('player state is duplicated');
    players.set(player.entityId, new PlayerState(player.entityId, [...player.spawnPosition] as Position, player));
  });
  if (entities.query({ type: 'player' }).length !== players.size) throw new TypeError('player state is missing');

  const validator = new AutonomyRuntime({
    entities,
    getVoxel: options.getVoxel,
    getWorldTime: options.getWorldTime,
    isPlayerAlive: (id) => players.get(id)?.lifecycle === 'alive',
    clone: options.clone,
  });
  validator.restore(simulationSnapshotFor(source));
  const snapshot: GameplaySnapshotV3 = {
    version: 3,
    revision: source.revision,
    gameplayTime: source.gameplayTime,
    worldTime,
    entitySequence: source.entitySequence,
    entities: entities.exportSnapshot(),
    players: [...players.values()].map((player) => player.snapshot()),
    simulation: validator.snapshot(),
    coordinateSchema: { ...GAMEPLAY_COORDINATE_SCHEMA },
    physicsSchema: { ...GAMEPLAY_PHYSICS_SCHEMA },
  };
  return { snapshot, sourceVersion, entities, players };
}
