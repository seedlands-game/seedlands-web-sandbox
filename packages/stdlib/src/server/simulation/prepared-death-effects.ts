import type { ActionRuntime } from './action-runtime';
import type { ActorState } from './actor-state';
import type { CombatRuntime } from '../gameplay/combat-runtime';
import type { PerceptionRuntime } from './perception-runtime';
import { prepareCombatEffects } from './prepared-combat-effects';

/** Needs deaths share the same player/NPC Action and Combat settlement owner. */
export function prepareDeathEffects(
  options: Readonly<{
    ids: readonly string[];
    combat: CombatRuntime;
    actions: ActionRuntime;
    actors: Map<string, ActorState>;
    perception: PerceptionRuntime;
    now: number;
  }>,
) {
  const combatPlan = options.combat.prepareMutation({
    cancelActorIds: options.ids,
    cancelTargetIds: options.ids,
    actorCancellationReason: 'attacker-dead',
    targetCancellationReason: 'target-missing',
  });
  const effects = prepareCombatEffects({ ...options, combatPlan, deaths: options.ids });
  return Object.freeze({
    interrupted: effects.interrupted,
    completed: effects.completed,
    validate: () => effects.validate(),
    apply: () => {
      combatPlan.apply();
      effects.apply();
    },
  });
}
