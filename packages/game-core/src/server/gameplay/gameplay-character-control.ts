import type {
  CharacterControlRequest,
  CharacterControlResult,
  CharacterPosition,
} from '../../runtime/character-control-protocol';
import type { ActorRegistration } from '../simulation/autonomy-runtime';
import type { AutonomyRuntime } from '../simulation/autonomy-runtime';
import type { EntitySpawn, EntityStore, GameplayEntity } from './entity-store';

type Position = [number, number, number];
type Options = Readonly<{
  entities: EntityStore;
  simulation: AutonomyRuntime;
  spawnAutonomous: (input: EntitySpawn, registration: ActorRegistration) => GameplayEntity;
}>;

const characterPosition = (value: CharacterPosition): Position => {
  if (value.length !== 3 || !value.every(Number.isFinite)) throw new TypeError('Character position is invalid.');
  return [...value];
};

const defaultCharacterPosition = (options: Options, player?: Position): Position => {
  if (!player) throw new Error('Character creation requires a player or an explicit position.');
  for (const [dx, dz] of [
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
  ] as const) {
    const target: Position = [player[0] + dx, player[1], player[2] + dz];
    if (options.entities.queryNearby(target, 1.25).length > 0) continue;
    if (options.simulation.navigator.plan(player, target, { maxExpanded: 64 }).status === 'reached') return target;
  }
  throw new Error('No nearby walkable character position is available.');
};

export function executeGameplayCharacterRequest(
  options: Options,
  request: CharacterControlRequest,
): CharacterControlResult {
  if (!request || typeof request !== 'object' || typeof request.kind !== 'string')
    throw new TypeError('Character request is invalid.');
  if (request.kind !== 'create') return options.simulation.characters.execute(request);
  const player = options.entities.query({ type: 'player' })[0];
  const requested = request.position
    ? characterPosition(request.position)
    : defaultCharacterPosition(options, player?.position);
  const home = request.homePosition ? characterPosition(request.homePosition) : requested;
  options.simulation.characters.validateRegistration(request.profile, home, request.behaviorTree);
  const entity = options.spawnAutonomous(
    {
      type: 'npc',
      archetype: 'settler',
      position: requested,
      health: 20,
      maxHealth: 20,
      persistent: true,
    },
    { archetype: 'settler', hunger: 60 },
  );
  try {
    return {
      kind: 'created',
      character: options.simulation.characters.register(entity.id, request.profile, home, request.behaviorTree),
    };
  } catch (error) {
    options.simulation.unregisterActor(entity.id);
    options.entities.despawn(entity.id);
    throw error;
  }
}
