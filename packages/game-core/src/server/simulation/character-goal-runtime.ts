import type { CharacterEvent, CharacterTargetRef } from '../../runtime/character-control-protocol';
import { getItemCapability } from '../gameplay/item-registry';
import type { GameplayEntity } from '../gameplay/entity-store';
import type { CharacterRecord, CharacterRuntimeOptions, CharacterTargetBinding } from './character-runtime-types';
import { characterDistance as distance, characterPosition } from './character-runtime-validation';

const STALL_TIMEOUT_SECONDS = 5;
const MOVEMENT_REFRESH_SECONDS = 1;
const ARRIVAL_DISTANCE = 1.25;

type Callbacks = Readonly<{
  record: (
    record: CharacterRecord,
    type: CharacterEvent['type'],
    fields?: Pick<CharacterEvent, 'text' | 'target' | 'reason'>,
  ) => CharacterEvent;
  reference: (record: CharacterRecord, kind: CharacterTargetBinding['kind'], targetId: string) => CharacterTargetRef;
  isVisible: (record: CharacterRecord, kind: CharacterTargetBinding['kind'], targetId: string) => boolean;
  requireEntity: (entityId: string) => GameplayEntity;
}>;

export class CharacterGoalRuntime {
  constructor(
    private readonly options: CharacterRuntimeOptions,
    private readonly callbacks: Callbacks,
  ) {}

  advance(record: CharacterRecord, seconds: number): void {
    if (record.lifecycle !== 'active') return;
    const actor = this.options.actor(record.entityId);
    const entity = this.options.entities.get(record.entityId);
    if (!actor || !entity) return;
    record.lastBehavior = actor.behavior;
    record.hunger = actor.hunger;
    if (record.currentGoal.status === 'suspended') {
      record.dangerSecondsRemaining = Math.max(0, record.dangerSecondsRemaining - seconds);
      if (record.dangerSecondsRemaining > 0) return;
      if (actor.behavior === 'flee') this.options.clearDanger(record.entityId);
      if (record.suspendedGoal) {
        record.currentGoal = { ...record.suspendedGoal, status: 'active' };
        record.suspendedGoal = undefined;
      } else {
        record.actionId = undefined;
        record.executionTargetId = undefined;
        record.stalledSeconds = 0;
        record.refreshSeconds = 0;
        record.currentGoal = {
          revision: record.revision + 1,
          requestId: 'fallback-life',
          goal: { kind: 'forage' },
          status: 'active',
        };
      }
      record.revision += 1;
      this.callbacks.record(record, 'fallback', { reason: 'danger-cleared' });
      this.start(record);
      this.options.changed();
      return;
    }
    if (record.currentGoal.status !== 'active') return;
    if (record.currentGoal.goal.kind === 'forage') this.advanceForage(record, entity);
    else if (record.currentGoal.goal.kind === 'follow') this.advanceFollow(record, entity, seconds);
    this.reconcileAction(record, entity, seconds);
  }

  start(record: CharacterRecord): void {
    const goal = record.currentGoal.goal;
    if (goal.kind === 'idle') return void this.options.interruptAction(record.entityId, 'idle');
    if (goal.kind === 'move-to') this.startMovement(record, characterPosition(goal.position, 'Move target'));
    else if (goal.kind === 'return-home') this.startMovement(record, record.homePosition);
    else if (goal.kind === 'follow' && record.executionTargetId) {
      const target = this.options.entities.get(record.executionTargetId);
      if (target) this.startMovement(record, target.position, target.id);
    }
  }

  private advanceForage(record: CharacterRecord, entity: GameplayEntity): void {
    let target = record.executionTargetId ? this.options.entities.get(record.executionTargetId) : null;
    if (!target && record.executionTargetId) return this.fail(record, 'target-unavailable', true);
    if (!target) {
      const visible = this.options
        .observe(record.entityId)
        .visibleEntities.map((entry) => this.options.entities.get(entry.entityId))
        .filter((candidate): candidate is GameplayEntity =>
          Boolean(candidate?.stack && getItemCapability(candidate.stack.itemId, 'consume')),
        )
        .sort(
          (a, b) =>
            distance(entity.position, a.position) - distance(entity.position, b.position) || a.id.localeCompare(b.id),
        );
      target = visible[0] ?? null;
      if (!target) return;
      record.executionTargetId = target.id;
    }
    if (distance(entity.position, target.position) <= ARRIVAL_DISTANCE) {
      if (!this.pickup(record, target)) return this.fail(record, 'target-unavailable', true);
      this.consumeFood(record);
      return this.succeed(record);
    }
    if (!record.actionId) this.startMovement(record, target.position, target.id);
  }

  private advanceFollow(record: CharacterRecord, entity: GameplayEntity, seconds: number): void {
    const target = record.executionTargetId ? this.options.entities.get(record.executionTargetId) : null;
    if (!target || !this.callbacks.isVisible(record, 'entity', target.id))
      return this.fail(record, 'target-unavailable', true);
    record.refreshSeconds += seconds;
    if (distance(entity.position, target.position) <= 1.5) {
      const action = record.actionId ? this.options.action(record.actionId) : null;
      if (action && (action.status === 'pending' || action.status === 'running'))
        this.options.succeedAction(action.id, { followedEntityId: target.id });
      record.actionId = undefined;
      record.stalledSeconds = 0;
      return;
    }
    if (!record.actionId || record.refreshSeconds >= MOVEMENT_REFRESH_SECONDS) {
      record.refreshSeconds = 0;
      this.startMovement(record, target.position, target.id);
    }
  }

  private reconcileAction(record: CharacterRecord, entity: GameplayEntity, seconds: number): void {
    if (!record.actionId) return;
    const action = this.options.action(record.actionId);
    if (!action || action.status === 'failed' || action.status === 'interrupted')
      return this.fail(record, action?.reason ?? 'action-unavailable', true);
    if (action.status === 'succeeded') return this.succeed(record);
    const waypoint = action.path[action.pathIndex];
    if (waypoint && action.pathIndex < action.path.length - 1 && distance(entity.position, waypoint) <= 0.65)
      this.options.setActionPathIndex(action.id, action.pathIndex + 1);
    if (distance(entity.position, record.lastPosition) >= 0.1) {
      record.lastPosition = [...entity.position];
      record.stalledSeconds = 0;
      return;
    }
    record.stalledSeconds += seconds;
    if (record.stalledSeconds < STALL_TIMEOUT_SECONDS) return;
    this.options.failAction(action.id, 'path-stalled');
    this.fail(record, 'path-stalled', true);
  }

  private startMovement(record: CharacterRecord, target: readonly number[], targetEntityId?: string): void {
    if (!this.options.canStartAction()) return this.fail(record, 'action-sequence-exhausted', true);
    const targetPosition = characterPosition(target, 'Character movement target');
    const entity = this.callbacks.requireEntity(record.entityId);
    const plan = this.options.plan(entity.position, targetPosition);
    if (plan.status !== 'reached') return this.fail(record, `path-${plan.status}`, true);
    const action = this.options.startAction(record.entityId, {
      type: 'move-to',
      targetPosition,
      ...(targetEntityId ? { targetEntityId } : {}),
    });
    this.options.markActionRunning(action.id, plan.path);
    record.actionId = action.id;
    record.lastPosition = [...entity.position];
    record.stalledSeconds = 0;
  }

  private pickup(record: CharacterRecord, target: GameplayEntity): boolean {
    if (!target.stack || target.type !== 'world-item') return false;
    const before = record.inventory.snapshot();
    if (!record.inventory.add({ itemId: target.stack.itemId, count: 1 })) return false;
    const eventTarget = this.callbacks.reference(record, 'entity', target.id);
    if (!this.options.entities.consumeWorldItemUnit(target.id)) {
      record.inventory.replace(before);
      return false;
    }
    this.callbacks.record(record, 'item-picked-up', {
      target: eventTarget,
    });
    this.options.changed();
    return true;
  }

  private consumeFood(record: CharacterRecord): void {
    if ((this.options.actor(record.entityId)?.hunger ?? 0) <= 0) return;
    const inventory = record.inventory.snapshot();
    const slot = inventory.findIndex((item) => item && getItemCapability(item.itemId, 'consume'));
    if (slot < 0) return;
    const item = inventory[slot]!;
    record.inventory.removeFromSlot(slot, 1);
    const actor = this.options.actor(record.entityId);
    if (actor)
      actor.hunger = Math.max(0, actor.hunger - (getItemCapability(item.itemId, 'consume')?.hungerRestore ?? 1));
    this.callbacks.record(record, 'item-consumed');
    this.options.changed();
  }

  private succeed(record: CharacterRecord): void {
    if (record.currentGoal.status !== 'active') return;
    const action = record.actionId ? this.options.action(record.actionId) : null;
    if (action && (action.status === 'pending' || action.status === 'running'))
      this.options.succeedAction(action.id, { characterGoal: record.currentGoal.goal.kind });
    if (record.currentGoal.goal.kind === 'follow') {
      record.actionId = undefined;
      record.stalledSeconds = 0;
      this.options.changed();
      return;
    }
    if (record.currentGoal.goal.kind === 'forage') {
      record.actionId = undefined;
      record.executionTargetId = undefined;
      record.stalledSeconds = 0;
      this.callbacks.record(record, 'goal-succeeded');
      this.options.changed();
      return;
    }
    record.currentGoal = { ...record.currentGoal, status: 'succeeded' };
    record.revision += 1;
    record.actionId = undefined;
    this.callbacks.record(record, 'goal-succeeded');
    this.options.changed();
  }

  private fail(record: CharacterRecord, reason: string, fallback: boolean): void {
    if (record.currentGoal.status !== 'active') return;
    const action = record.actionId ? this.options.action(record.actionId) : null;
    if (action && (action.status === 'pending' || action.status === 'running'))
      this.options.failAction(action.id, reason);
    record.currentGoal = { ...record.currentGoal, status: 'failed', reason };
    record.revision += 1;
    record.actionId = undefined;
    this.callbacks.record(record, reason === 'target-unavailable' ? 'target-lost' : 'goal-failed', { reason });
    if (fallback) this.callbacks.record(record, 'fallback', { reason });
    this.options.changed();
  }
}
