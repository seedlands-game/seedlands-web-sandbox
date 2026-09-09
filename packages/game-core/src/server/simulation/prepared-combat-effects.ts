import type { ActionRuntime, ActionSettlement } from './action-runtime';
import type { ActorState } from './actor-state';
import type { PerceptionRuntime, ObservationEvent } from './perception-runtime';
import type { CombatRuntime } from '../gameplay/combat-runtime';
import type { PreparedCombatMutation } from '../gameplay/prepared-combat-mutation';

export type CombatAutonomyEffects = Readonly<{
  deaths?: readonly string[];
  interruptions?: readonly Readonly<{ actorId: string; reason: string }>[];
  removals?: readonly string[];
  attacked?: Readonly<{ targetId: string; actorId: string }>;
  started?: Readonly<{ actorId: string; targetId: string; replaced: boolean }>;
}>;

/** Uses one already prepared Combat frontier; never prepares or applies a second one. */
export function prepareCombatEffects(
  options: CombatAutonomyEffects &
    Readonly<{
      combat: CombatRuntime;
      combatPlan: PreparedCombatMutation;
      actions: ActionRuntime;
      actors: Map<string, ActorState>;
      perception: PerceptionRuntime;
      now: number;
    }>,
) {
  const settlements = new Map<string, ActionSettlement>();
  const original = new Map<
    string,
    Readonly<{ actor: ActorState; behavior: ActorState['behavior']; target: string | null }>
  >();
  const updates = new Map<string, Readonly<{ behavior: ActorState['behavior']; target: string | null }>>();
  const records: { observerId: string; event: ObservationEvent }[] = [];
  const completedObservers = new Map<string, string>();
  const absent = new Set<string>();
  const capture = (id: string) => {
    const actor = options.actors.get(id);
    if (!actor) absent.add(id);
    if (actor && !original.has(id)) original.set(id, { actor, behavior: actor.behavior, target: actor.targetEntityId });
    return actor;
  };
  for (const event of options.combatPlan.lifecycleEvents) {
    const actor = capture(event.actorId);
    const action = options.actions.forActor(event.actorId);
    if (action?.id === event.actionId) {
      settlements.set(
        action.id,
        event.status === 'cancelled'
          ? {
              id: action.id,
              status: 'interrupted',
              now: options.now,
              reason: event.result?.reason ?? 'combat-cancelled',
            }
          : { id: action.id, status: 'succeeded', now: options.now, result: event.result ?? undefined },
      );
      if (actor && event.status === 'completed') completedObservers.set(action.id, actor.entityId);
    }
    if (actor) updates.set(actor.entityId, { behavior: 'idle', target: null });
  }
  const deaths = [...new Set(options.deaths ?? [])],
    removals = [...new Set(options.removals ?? [])];
  if (deaths.length > 640 || removals.length > 512 || removals.some((id) => !deaths.includes(id)))
    throw new RangeError('Combat death/removal effects exceed their actor budget.');
  for (const id of deaths) {
    if (capture(id)) updates.set(id, { behavior: 'idle', target: null });
    const action = options.actions.forActor(id);
    if (action)
      settlements.set(action.id, { id: action.id, status: 'interrupted', now: options.now, reason: 'actor-dead' });
  }
  const interruptions = options.interruptions ?? [];
  if (interruptions.length > 640 || new Set(interruptions.map((entry) => entry.actorId)).size !== interruptions.length)
    throw new RangeError('Combat interruption effects exceed their actor budget.');
  for (const { actorId, reason } of interruptions) {
    if (!actorId.trim() || !reason.trim()) throw new TypeError('Combat interruption is invalid.');
    if (capture(actorId)) updates.set(actorId, { behavior: 'idle', target: null });
    const action = options.actions.forActor(actorId);
    if (action) settlements.set(action.id, { id: action.id, status: 'interrupted', now: options.now, reason });
  }
  if (options.attacked && !deaths.includes(options.attacked.targetId) && capture(options.attacked.targetId)) {
    updates.set(options.attacked.targetId, { behavior: 'flee', target: options.attacked.actorId });
    records.push({
      observerId: options.attacked.targetId,
      event: { type: 'attacked', subjectId: options.attacked.actorId },
    });
  }
  if (options.started && deaths.includes(options.started.actorId))
    throw new TypeError('Cannot start Combat for a dying actor.');
  for (const [actionId, observerId] of completedObservers)
    if (settlements.get(actionId)?.status === 'succeeded')
      records.push({ observerId, event: { type: 'action-completed', subjectId: actionId } });
  if (options.started && capture(options.started.actorId))
    updates.set(options.started.actorId, { behavior: 'attack', target: options.started.targetId });
  const entries = [...settlements.values()];
  const actions: ReturnType<ActionRuntime['prepareSettlements']>[] = [];
  for (let offset = 0; offset < entries.length; offset += 128)
    actions.push(options.actions.prepareSettlements(entries.slice(offset, offset + 128)));
  const perception = options.perception.prepareRecords(records);
  let used = false,
    validated = false;
  return Object.freeze({
    interrupted: entries.filter((entry) => entry.status === 'interrupted').length + (options.started?.replaced ? 1 : 0),
    completed: entries.filter((entry) => entry.status === 'succeeded').length,
    validate() {
      if (used) throw new Error('Prepared Combat effects were already used.');
      validated = false;
      options.combatPlan.validate();
      for (const [id, previous] of original)
        if (
          options.actors.get(id) !== previous.actor ||
          previous.actor.behavior !== previous.behavior ||
          previous.actor.targetEntityId !== previous.target
        )
          throw new Error('Prepared Combat autonomy effects are stale.');
      for (const id of absent)
        if (options.actors.has(id)) throw new Error('Prepared Combat autonomy absence is stale.');
      actions.forEach((plan) => plan.validate());
      perception.validate();
      validated = true;
    },
    apply() {
      if (used || !validated) throw new Error('Prepared Combat effects require fresh validation.');
      actions.forEach((plan) => plan.apply());
      perception.apply();
      options.combat.acknowledgeLifecycleEvents(options.combatPlan.lifecycleEvents.length);
      for (const [id, update] of updates) {
        const actor = original.get(id)!.actor;
        actor.behavior = update.behavior;
        actor.targetEntityId = update.target;
      }
      for (const id of removals) options.actors.delete(id);
      used = true;
    },
  });
}
