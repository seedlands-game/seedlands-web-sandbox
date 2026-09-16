import type { WorldModuleBinding } from '../commands/module-command';
import type { EntityStore } from './entity-store';
import type { PlayerState } from './player-state';
import type { EntitySpawn, GameplayEntity } from './entity-store';
import type { ActorProfileRegistry } from './actor-profile';
import type { ActorRegistration, AutonomyRuntime } from '../simulation/autonomy-runtime';
import { resolveProfiledActorSpawn } from './profiled-actor-spawn';
import type { WorldCommitResult } from '../game-server-types';
import { advanceGameplayClock, assertGameplayAdvance } from './gameplay-clock';

type Disposable = Readonly<{ dispose(): void }>;
type ActorRequestRuntime<Result> = Readonly<{
  request(actorId: string, targetId: string, existingActionId?: string, binding?: WorldModuleBinding): Result;
}>;

export function disposeGameplayRuntime(schedule: Disposable | null, modules: Disposable): void {
  try {
    schedule?.dispose();
  } finally {
    modules.dispose();
  }
}

export function despawnGameplayEntity(
  id: string,
  simulation: Readonly<{
    cancelCombat(id: string, reason: string): void;
    cancelCombatTarget(id: string): void;
    unregisterActor(id: string): unknown;
  }>,
  entities: EntityStore,
  players: Map<string, PlayerState>,
  changed: () => void,
): boolean {
  simulation.cancelCombat(id, 'entity-removed');
  simulation.cancelCombatTarget(id);
  simulation.unregisterActor(id);
  const removed = entities.despawn(id);
  if (!removed) return false;
  players.delete(id);
  changed();
  return true;
}

export function spawnGameplayAutonomous(
  input: EntitySpawn,
  registration: ActorRegistration,
  options: Readonly<{
    entities: EntityStore;
    profiles: ActorProfileRegistry;
    simulation: AutonomyRuntime;
    changed(): void;
  }>,
): GameplayEntity {
  options.simulation.validateActorRegistration(registration);
  const entity = options.entities.spawn(resolveProfiledActorSpawn(input, options.profiles, registration.archetype));
  try {
    options.simulation.registerActor(entity.id, registration);
  } catch (error) {
    options.entities.despawn(entity.id);
    throw error;
  }
  options.changed();
  return entity;
}

export function advanceGameplayRules(
  seconds: number,
  options: Readonly<{
    schedule: Readonly<{
      assertAdvance(seconds: number): number;
      activate(): void;
      advance(seconds: number): number;
    }> | null;
    modules: Readonly<{ flushQueued(): void }>;
    blocks: Readonly<{ drain(): void; takeCommits(): readonly WorldCommitResult[] }> | null;
    players: ReadonlyMap<string, PlayerState>;
    simulation: AutonomyRuntime;
    revision(): number;
    advancePlayer(player: PlayerState, seconds: number, commits: WorldCommitResult[]): void;
    advanceUnscheduled(seconds: number): void;
    touchWithoutEvent(): void;
    assertRevisionCapacity(): void;
  }>,
): { commits: WorldCommitResult[] } {
  assertGameplayAdvance(seconds);
  options.schedule?.assertAdvance(seconds);
  if (seconds > 0) options.assertRevisionCapacity();
  options.schedule?.activate();
  options.modules.flushQueued();
  options.blocks?.drain();
  const startingRevision = options.revision();
  const commits: WorldCommitResult[] = [];
  advanceGameplayClock(seconds, (step) => {
    const canonical = options.schedule?.assertAdvance(step) ?? step;
    if (options.schedule) options.players.forEach((player) => options.advancePlayer(player, canonical, commits));
    const elapsed = options.schedule ? options.schedule.advance(canonical) : canonical;
    if (!options.schedule) {
      options.advanceUnscheduled(elapsed);
      options.players.forEach((player) => options.advancePlayer(player, elapsed, commits));
    }
    options.simulation.advanceAuthorityRules(elapsed);
    options.blocks?.drain();
  });
  if (seconds > 0 && options.revision() === startingRevision) options.touchWithoutEvent();
  commits.push(...(options.blocks?.takeCommits() ?? []));
  return { commits };
}

export function bindRegisteredActorRequest<Result>(
  runtime: ActorRequestRuntime<Result> | null,
  label: string,
  binding?: WorldModuleBinding,
) {
  if (!runtime) throw new Error(`Registered ${label} is unavailable.`);
  return (actorId: string, targetId: string, existingActionId?: string) =>
    runtime.request(actorId, targetId, existingActionId, binding);
}
