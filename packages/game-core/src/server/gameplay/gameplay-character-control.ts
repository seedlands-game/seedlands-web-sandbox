import { characterText } from '../simulation/character-runtime-validation';
import type {
  CharacterControlRequest,
  CharacterControlResult,
  CharacterActorBinding,
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
  actorBinding?: CharacterActorBinding,
): CharacterControlResult {
  if (!request || typeof request !== 'object' || typeof request.kind !== 'string')
    throw new TypeError('Character request is invalid.');
  const characters = options.simulation.characters;
  if (!characters) throw new Error('Character behavior module is unavailable.');
  if (request.kind !== 'create') return characters.execute(request, actorBinding);
  const creation =
    request.creationRequestId === undefined
      ? undefined
      : {
          id: characterText(request.creationRequestId, 'Creation request id', 160),
          fingerprint: JSON.stringify({
            profile: request.profile,
            position: request.position ?? null,
            homePosition: request.homePosition ?? null,
            behaviorTree: request.behaviorTree ?? null,
          }),
        };
  if (creation) {
    characterText(creation.fingerprint, 'Creation fingerprint', 65536);
    const previous = characters.createdForRequest(creation.id, creation.fingerprint);
    if (previous) return { kind: 'created', character: previous };
  }
  const player = options.entities.query({ type: 'player' })[0];
  const requested = request.position
    ? characterPosition(request.position)
    : defaultCharacterPosition(options, player?.position);
  const home = request.homePosition ? characterPosition(request.homePosition) : requested;
  characters.validateRegistration(request.profile, home, request.behaviorTree);
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
      character: characters.register(entity.id, request.profile, home, request.behaviorTree, creation),
    };
  } catch (error) {
    options.simulation.unregisterActor(entity.id);
    options.entities.despawn(entity.id);
    throw error;
  }
}
