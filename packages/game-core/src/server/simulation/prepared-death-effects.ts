import type { ActionRuntime, ActionSettlement } from './action-runtime';
import type { ActorState } from './actor-state';
import type { CombatRuntime } from '../gameplay/combat-runtime';

/** Prepare every affected action before an ECS owner installs any death or drop. */
export function prepareDeathEffects(
  options: Readonly<{
    ids: readonly string[];
    combat: CombatRuntime;
    actions: ActionRuntime;
    actors: ReadonlyMap<string, ActorState>;
    now: number;
  }>,
) {
  const combat = options.combat.prepareMutation({
    cancelActorIds: options.ids,
    cancelTargetIds: options.ids,
    actorCancellationReason: 'attacker-dead',
    targetCancellationReason: 'target-missing',
  });
  const settlements = new Map<string, ActionSettlement>();
  const affected = new Map<string, ActorState>();
  for (const event of combat.lifecycleEvents) {
    const actor = options.actors.get(event.actorId);
    if (!actor) continue;
    affected.set(actor.entityId, actor);
    const action = options.actions.forActor(event.actorId);
    if (action?.id !== event.actionId) continue;
    settlements.set(
      action.id,
      event.status === 'cancelled'
        ? { id: action.id, status: 'interrupted', now: options.now, reason: event.result?.reason ?? 'combat-cancelled' }
        : { id: action.id, status: 'succeeded', now: options.now, result: event.result ?? undefined },
    );
  }
  for (const id of options.ids) {
    const actor = options.actors.get(id);
    if (actor) affected.set(id, actor);
    const action = options.actions.forActor(id);
    if (action)
      settlements.set(action.id, { id: action.id, status: 'interrupted', now: options.now, reason: 'actor-dead' });
  }
  const entries = [...settlements.values()];
  const actions: ReturnType<ActionRuntime['prepareSettlements']>[] = [];
  for (let offset = 0; offset < entries.length; offset += 128)
    actions.push(options.actions.prepareSettlements(entries.slice(offset, offset + 128)));
  const interrupted = entries.filter((entry) => entry.status === 'interrupted').length;
  const completed = entries.filter((entry) => entry.status === 'succeeded').length;
  let validated = false,
    used = false;
  return {
    interrupted,
    completed,
    validate() {
      if (used) throw new Error('Death effects already applied.');
      combat.validate();
      actions.forEach((action) => action.validate());
      validated = true;
    },
    apply() {
      if (!validated || used) throw new Error('Death effects require a fresh validation.');
      combat.apply();
      actions.forEach((action) => action.apply());
      options.combat.acknowledgeLifecycleEvents(combat.lifecycleEvents.length);
      affected.forEach((actor) => {
        actor.behavior = 'idle';
        actor.targetEntityId = null;
      });
      used = true;
    },
  };
}
