import type { RegisteredCombatRuntime } from './modules/registered-combat-runtime';

export function optionalRegisteredCombatRequest(combat: RegisteredCombatRuntime | null) {
  if (!combat) return {};
  return {
    registeredCombatRequest: (actorId: string, targetId: string, existingActionId?: string) =>
      combat.request(actorId, targetId, existingActionId),
  };
}
