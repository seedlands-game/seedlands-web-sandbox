import type { WorldModuleBinding } from '../commands/module-command';
import type { EntityStore } from './entity-store';
import type { PlayerState } from './player-state';

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

export function bindRegisteredActorRequest<Result>(
  runtime: ActorRequestRuntime<Result> | null,
  label: string,
  binding?: WorldModuleBinding,
) {
  if (!runtime) throw new Error(`Registered ${label} is unavailable.`);
  return (actorId: string, targetId: string, existingActionId?: string) =>
    runtime.request(actorId, targetId, existingActionId, binding);
}
