import type { ActorAction, ActionSnapshot, BoundActorActionSnapshot } from './action-runtime';
import type { SimulationSnapshot } from './actor-state';
import { isEntityLifetimeReference } from './action-identity';
import type { CombatSnapshot } from '../gameplay/combat-runtime';

/** Combat owns current/buffered targets; Action owns the actor lifecycle only. */
export function projectCombatAction(
  action: ActorAction | null,
  combat: CombatSnapshot | undefined,
): ActorAction | null {
  return action?.type === 'attack' && action.status === 'running' && combat?.active?.actionId === action.id
    ? { ...action, targetEntityId: combat.active.targetId }
    : action;
}

/** V3 Combat snapshots written before this normalization may repeat the original target in Action. */
export function prepareCombatActionSnapshot(
  snapshot: SimulationSnapshot,
  autonomousIds: ReadonlySet<string>,
): ActionSnapshot {
  if (!snapshot.combat || !Array.isArray(snapshot.combat.combatants) || !Array.isArray(snapshot.actions?.actions))
    return snapshot.actions;
  const registered = snapshot.combat.version === 3;
  const running = new Map<string, ActorAction>();
  for (const action of snapshot.actions.actions) {
    if (
      (!registered && !autonomousIds.has(action.actorId)) ||
      action.type !== 'attack' ||
      ['succeeded', 'failed', 'interrupted'].includes(action.status)
    )
      continue;
    if (action.status !== 'running' || running.has(action.actorId))
      throw new TypeError('autonomous combat action is invalid or duplicated');
    running.set(action.actorId, action);
  }
  const matched = new Set<string>(),
    actors = new Set<string>();
  for (const entry of snapshot.combat.combatants) {
    if ((!registered && !autonomousIds.has(entry.actorId)) || !entry.combat?.active) continue;
    if (actors.has(entry.actorId)) throw new TypeError('autonomous combat action is invalid or duplicated');
    actors.add(entry.actorId);
    const action = running.get(entry.actorId);
    if (
      !action ||
      action.id !== entry.combat.active.actionId ||
      (!registered && action.targetEntityId !== entry.combat.active.targetId)
    )
      throw new TypeError('autonomous combat action does not match its running action');
    matched.add(action.id);
    running.delete(entry.actorId);
  }
  if (running.size) throw new TypeError('running attack action is missing autonomous combat');
  if (!registered) return snapshot.actions;
  return {
    ...snapshot.actions,
    actions: snapshot.actions.actions.map((action): BoundActorActionSnapshot => {
      if (!matched.has(action.id)) return action;
      const source = action as BoundActorActionSnapshot;
      if (
        source.targetEntityId !== undefined &&
        (typeof source.targetEntityId !== 'string' || !source.targetEntityId.trim())
      )
        throw new TypeError('Combat Action legacy target is invalid.');
      if (
        source.targetIdentity !== undefined &&
        (!isEntityLifetimeReference(source.targetIdentity) || source.targetIdentity.entityId !== source.targetEntityId)
      )
        throw new TypeError('Combat Action legacy target binding is invalid.');
      const normalized = { ...source };
      delete normalized.targetEntityId;
      delete normalized.targetIdentity;
      return normalized;
    }),
  };
}
