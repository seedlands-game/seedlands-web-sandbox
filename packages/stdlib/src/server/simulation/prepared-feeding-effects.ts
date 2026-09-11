import type { AutonomyRuntime } from './autonomy-runtime';

/** The single Eat Action plan owns replacement; Combat effects must not settle that Action again. */
export function prepareFeedingEffects(
  simulation: AutonomyRuntime,
  actorId: string,
  targetId: string,
  existingActionId?: string,
) {
  const current = simulation.actions.forActor(actorId);
  if (
    existingActionId &&
    (!current || current.id !== existingActionId || current.type !== 'eat' || current.targetEntityId !== targetId)
  )
    throw new Error('Eat action mismatch.');
  const now = simulation.authorityRulesContext().time;
  const result = { consumedEntityId: targetId, count: 1 };
  const prepared = existingActionId
    ? (() => {
        const plan = simulation.actions.prepareSettlements([
          { id: existingActionId, status: 'succeeded', now, result },
        ]);
        return { plan, action: plan.results[0]! };
      })()
    : (() => {
        const plan = simulation.actions.prepareStart({ actorId, type: 'eat', targetEntityId: targetId }, now, {
          status: 'succeeded',
          result,
        });
        return { plan, action: plan.action };
      })();
  const combat = simulation.combat.prepareMutation({ cancelActorIds: [actorId], actorCancellationReason: 'replaced' });
  const effects = simulation.prepareCombatEffects(combat, {
    completedAction: {
      actorId,
      actionId: prepared.action.id,
      ...(!existingActionId && current ? { replacedActionId: current.id } : {}),
    },
  });
  let validated = false,
    used = false;
  return Object.freeze({
    action: prepared.action,
    validate() {
      if (used) throw new Error('Prepared Feeding effects were already used.');
      validated = false;
      prepared.plan.validate();
      effects.validate();
      validated = true;
    },
    apply() {
      if (used || !validated) throw new Error('Prepared Feeding effects require validation or were already used.');
      combat.apply();
      prepared.plan.apply();
      effects.apply();
      used = true;
    },
  });
}
