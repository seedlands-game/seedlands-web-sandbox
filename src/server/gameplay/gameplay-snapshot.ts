import { AutonomyRuntime, type SimulationSnapshot } from '../simulation/autonomy-runtime';
import { EntityStore, type GameplayEntity } from './entity-store';
import { PlayerState, type PlayerSnapshot } from './player-state';

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
export type GameplaySnapshot = GameplaySnapshotV1 | GameplaySnapshotV2;

export type ValidatedGameplaySnapshot = {
  snapshot: GameplaySnapshot;
  entities: EntityStore;
  players: Map<string, PlayerState>;
};

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
  snapshot.version === 2 ? snapshot.simulation : emptySimulation();

export function validateGameplaySnapshot(
  raw: unknown,
  options: { getVoxel: (x: number, y: number, z: number) => number; getWorldTime: () => number },
): ValidatedGameplaySnapshot {
  const snapshot = raw as GameplaySnapshot;
  if (
    !snapshot ||
    (snapshot.version !== 1 && snapshot.version !== 2) ||
    !Number.isInteger(snapshot.revision) ||
    snapshot.revision < 0 ||
    !Number.isFinite(snapshot.gameplayTime) ||
    snapshot.gameplayTime < 0 ||
    !Number.isInteger(snapshot.entitySequence) ||
    snapshot.entitySequence < 0 ||
    !Array.isArray(snapshot.entities) ||
    !Array.isArray(snapshot.players)
  )
    throw new TypeError('header is invalid');
  if (
    snapshot.version === 2 &&
    (!Number.isFinite(snapshot.worldTime) || snapshot.worldTime < 0 || snapshot.worldTime >= 24)
  )
    throw new TypeError('world time is invalid');

  const entities = new EntityStore();
  snapshot.entities.forEach((entity) => entities.spawn(entity));
  const players = new Map<string, PlayerState>();
  snapshot.players.forEach((player) => {
    const entity = entities.get(player.entityId);
    if (!entity || entity.type !== 'player') throw new TypeError('player entity is missing');
    players.set(player.entityId, new PlayerState(player.entityId, [...player.spawnPosition] as Position, player));
  });
  if (entities.query({ type: 'player' }).length !== players.size) throw new TypeError('player state is missing');

  const validator = new AutonomyRuntime({
    entities,
    getVoxel: options.getVoxel,
    getWorldTime: options.getWorldTime,
    isPlayerAlive: (id) => players.get(id)?.lifecycle === 'alive',
    damagePlayer: () => false,
    consumeWorldItem: () => false,
    spawnWorldItem: () => undefined,
  });
  validator.restore(simulationSnapshotFor(snapshot));
  return { snapshot, entities, players };
}
