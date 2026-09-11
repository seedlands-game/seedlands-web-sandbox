import type { CombatRuntime } from '../gameplay/combat-runtime';
import type { PreparedCombatMutation } from '../gameplay/prepared-combat-mutation';
import type { ActionRuntime } from './action-runtime';
import type { ActorState } from './actor-state';
import type { CharacterRuntime } from './character-runtime';
import type { PerceptionRuntime } from './perception-runtime';
import { prepareCombatEffects, type CombatAutonomyEffects } from './prepared-combat-effects';
import { prepareDeathEffects } from './prepared-death-effects';

type Shared = Readonly<{
  combat: CombatRuntime;
  actions: ActionRuntime;
  actors: Map<string, ActorState>;
  perception: PerceptionRuntime;
  characters: CharacterRuntime | null;
  now: number;
  counted(interrupted: number, completed: number): void;
}>;

export function createPreparedAutonomyDeaths(ids: readonly string[], options: Shared) {
  const effects = prepareDeathEffects({
    ids,
    combat: options.combat,
    actions: options.actions,
    perception: options.perception,
    actors: options.actors,
    now: options.now,
  });
  return {
    validate: () => effects.validate(),
    apply: () => {
      effects.apply();
      ids.forEach((id) => options.characters?.unregister(id, 'actor-dead'));
      options.counted(effects.interrupted, effects.completed);
    },
  };
}

export function createPreparedAutonomyCombatEffects(
  combatPlan: PreparedCombatMutation,
  input: CombatAutonomyEffects,
  options: Shared,
) {
  const effects = prepareCombatEffects({
    ...input,
    combatPlan,
    combat: options.combat,
    actions: options.actions,
    actors: options.actors,
    perception: options.perception,
    now: options.now,
  });
  return {
    validate: () => effects.validate(),
    apply: () => {
      effects.apply();
      input.deaths?.forEach((id) => options.characters?.unregister(id, 'killed'));
      if (input.attacked) options.characters?.recordAttacked(input.attacked.targetId, input.attacked.actorId, false);
      options.counted(effects.interrupted, effects.completed);
    },
  };
}

export function createPreparedAutonomyCancellation(
  actorIds: readonly string[],
  reason: string,
  interruptActions: boolean,
  combat: CombatRuntime,
  prepareEffects: (
    combatPlan: PreparedCombatMutation,
    input: CombatAutonomyEffects,
  ) => {
    validate(): void;
    apply(): void;
  },
) {
  const mutation = combat.prepareMutation({ cancelActorIds: actorIds, actorCancellationReason: reason });
  const effects = prepareEffects(mutation, {
    interruptions: interruptActions ? actorIds.map((actorId) => ({ actorId, reason })) : [],
  });
  return {
    validate: () => {
      mutation.validate();
      effects.validate();
    },
    apply: () => {
      mutation.apply();
      effects.apply();
    },
  };
}
