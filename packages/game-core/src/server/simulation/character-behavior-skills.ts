import { behaviorArgs } from './character-behavior-definition';
import type { BehaviorCondition } from '../../runtime/behavior-control-protocol';
import type { CharacterEvent } from '../../runtime/character-control-protocol';
import { getItemCapability } from '../gameplay/item-registry';
import type { GameplayEntity } from '../gameplay/entity-store';
import type {
  CharacterPositionTuple,
  CharacterRecord,
  CharacterRuntimeOptions,
  CharacterSkillExecution,
} from './character-runtime-types';
import { CHARACTER_THREAT_MEMORY_SECONDS } from './character-runtime-types';
const ARRIVAL = 1.25;
const REPLAN_SECONDS = 1;
const THREAT_CLEARANCE = 12;
export type BehaviorCallbacks = Readonly<{
  record: (
    record: CharacterRecord,
    type: CharacterEvent['type'],
    fields?: Omit<Partial<CharacterEvent>, 'cursor' | 'at' | 'type'>,
  ) => CharacterEvent;
  resolveTargetRef: (record: CharacterRecord, ref: string) => string | null;
}>;
const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const pos = (raw: unknown): CharacterPositionTuple => [...(raw as readonly number[])] as CharacterPositionTuple;
const numberArg = (args: Record<string, unknown>, name: string, fallback: number) =>
  typeof args[name] === 'number' ? args[name] : fallback;
/** Stateful body skills share the world's Action, inventory, navigation and combat owners. */
export class CharacterBehaviorSkills {
  constructor(
    private readonly options: CharacterRuntimeOptions,
    private readonly callbacks: BehaviorCallbacks,
  ) {}
  observeThreat(record: CharacterRecord, seconds: number): void {
    const memory = record.behaviorTree.recentThreat;
    if (memory) {
      memory.secondsRemaining -= seconds;
      if (memory.secondsRemaining <= 0) record.behaviorTree.recentThreat = undefined;
    }
    const observed = this.options.observe(record.entityId).threats[0];
    const threat = observed ? this.options.entities.get(observed.entityId) : null;
    if (threat)
      record.behaviorTree.recentThreat = {
        position: [...threat.position],
        secondsRemaining: CHARACTER_THREAT_MEMORY_SECONDS,
      };
  }
  stepSkill(record: CharacterRecord, execution: CharacterSkillExecution, args: Record<string, unknown>): void {
    const actor = this.options.actor(record.entityId);
    const entity = this.options.entities.get(record.entityId);
    if (!actor || !entity) return this.finish(record, execution, 'failed', 'actor-unavailable');
    switch (execution.skill) {
      case 'hold':
        execution.phase = 'holding';
        return;
      case 'speak':
        this.callbacks.record(record, 'speech', {
          nodeId: execution.nodeId,
          episode: execution.activation,
          text: String(args.text),
        });
        return this.finish(record, execution, 'succeeded');
      case 'wait':
        execution.phase = 'waiting';
        if (execution.elapsedSeconds >= numberArg(args, 'seconds', 0)) this.finish(record, execution, 'succeeded');
        return;
      case 'ignore-threat':
        execution.phase = 'observing-threat';
        if (!this.threat(record)) this.finish(record, execution, 'succeeded');
        return;
      case 'attack-threat':
        return this.attack(record, execution);
      case 'flee-threat':
        return this.flee(record, execution, args);
      case 'satisfy-hunger':
        return this.satisfyHunger(record, execution, args);
      case 'rest-at-home':
        return this.rest(record, execution, args);
      case 'move-to':
        return this.move(record, execution, pos(args.position), numberArg(args, 'maxReplans', 16));
      case 'follow':
        return this.follow(record, execution, args);
      case 'patrol':
        return this.patrol(record, execution, args);
      case 'wander':
        return this.wander(record, execution, args);
      default:
        return this.finish(record, execution, 'failed', 'skill-unavailable');
    }
  }

  private satisfyHunger(
    record: CharacterRecord,
    execution: CharacterSkillExecution,
    args: Record<string, unknown>,
  ): void {
    const actor = this.options.actor(record.entityId)!;
    const avoidThreats = args.avoidThreats !== false;
    const satisfiedAt = numberArg(args, 'satisfiedAt', 20);
    if (actor.hunger <= satisfiedAt) return this.finish(record, execution, 'succeeded');
    const inventory = record.inventory.snapshot();
    const slot = inventory.findIndex((item) => item && getItemCapability(item.itemId, 'consume'));
    if (slot >= 0) {
      const item = inventory[slot]!;
      record.inventory.removeFromSlot(slot, 1);
      actor.hunger = Math.max(0, actor.hunger - (getItemCapability(item.itemId, 'consume')?.hungerRestore ?? 1));
      execution.count += 1;
      this.callbacks.record(record, 'item-consumed', {
        nodeId: execution.nodeId,
        actionId: execution.actionId,
        count: execution.count,
        hunger: actor.hunger,
      });
      if (actor.hunger <= satisfiedAt) this.finish(record, execution, 'succeeded');
      return;
    }
    let target = execution.targetEntityId ? this.options.entities.get(execution.targetEntityId) : null;
    if (
      !target?.stack ||
      !getItemCapability(target.stack.itemId, 'consume') ||
      (avoidThreats && !this.safePosition(record, target.position))
    )
      target = this.nearestFood(record, avoidThreats);
    if (!target) {
      execution.targetEntityId = undefined;
      const body = this.options.entities.get(record.entityId)!;
      if (!execution.searchOrigin) {
        const threat = avoidThreats ? record.behaviorTree.recentThreat : undefined;
        if (threat) {
          const dx = body.position[0] - threat.position[0];
          const dz = body.position[2] - threat.position[2];
          const length = Math.hypot(dx, dz);
          execution.searchOrigin = [
            body.position[0] + (length ? dx / length : -1) * 4,
            body.position[1],
            body.position[2] + (length ? dz / length : 0) * 4,
          ];
        } else execution.searchOrigin = [...record.homePosition];
      }
      const home = execution.searchOrigin;
      return this.patrol(record, execution, {
        positions: [home[0] + 3, home[1], home[2], home[0], home[1], home[2] + 3, home[0] - 3, home[1], home[2]],
        maxReplans: args.maxReplans ?? 16,
        avoidThreats,
      });
    }
    execution.targetEntityId = target.id;
    if (distance(this.options.entities.get(record.entityId)!.position, target.position) <= ARRIVAL) {
      const before = record.inventory.snapshot();
      if (!record.inventory.add({ itemId: target.stack!.itemId, count: 1 }))
        return this.finish(record, execution, 'failed', 'inventory-full');
      const consumed = this.options.entities.consumeWorldItemUnit(target.id);
      if (!consumed) {
        record.inventory.replace(before);
        return this.finish(record, execution, 'failed', 'food-unavailable');
      }
      execution.targetEntityId = undefined;
      this.callbacks.record(record, 'item-picked-up', {
        nodeId: execution.nodeId,
        actionId: execution.actionId,
        count: execution.count + 1,
      });
      return;
    }
    this.move(record, execution, target.position, numberArg(args, 'maxReplans', 16), target.id, avoidThreats);
  }

  private rest(record: CharacterRecord, execution: CharacterSkillExecution, args: Record<string, unknown>): void {
    if (this.isDay()) return this.finish(record, execution, 'succeeded');
    const home = pos(args.position);
    if (args.avoidThreats === true && !this.safePosition(record, home)) return this.waitForSafety(record, execution);
    if (distance(this.options.entities.get(record.entityId)!.position, home) <= ARRIVAL) {
      if (execution.actionId) this.completeAction(execution, { position: home });
      execution.phase = 'resting';
      return;
    }
    this.move(record, execution, home, 16, undefined, args.avoidThreats === true);
  }

  private patrol(record: CharacterRecord, execution: CharacterSkillExecution, args: Record<string, unknown>): void {
    const flat = args.positions as readonly number[];
    const positions = Array.from({ length: flat.length / 3 }, (_, index) =>
      pos(flat.slice(index * 3, index * 3 + 3)),
    ).filter((target) => args.avoidThreats !== true || this.safePosition(record, target));
    if (!positions.length) return this.waitForSafety(record, execution);
    const target = positions[execution.count % positions.length];
    if (distance(this.options.entities.get(record.entityId)!.position, target) <= ARRIVAL) {
      const actionId = execution.actionId;
      if (actionId) this.completeAction(execution, { position: target });
      execution.count += 1;
      execution.phase = 'patrolling';
      this.callbacks.record(record, 'activity-succeeded', {
        nodeId: execution.nodeId,
        actionId,
        episode: execution.activation,
        position: target,
        count: execution.count,
      });
      return;
    }
    this.move(record, execution, target, numberArg(args, 'maxReplans', 16), undefined, args.avoidThreats === true);
  }

  private wander(record: CharacterRecord, execution: CharacterSkillExecution, args: Record<string, unknown>): void {
    const entity = this.options.entities.get(record.entityId)!;
    const radius = numberArg(args, 'radius', 3);
    const directions = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ] as const;
    const direction = directions[(execution.activation + execution.count) % directions.length];
    const target: CharacterPositionTuple = [
      record.homePosition[0] + direction[0] * radius,
      entity.position[1],
      record.homePosition[2] + direction[1] * radius,
    ];
    this.patrol(record, execution, { positions: target, maxReplans: args.maxReplans ?? 16 });
  }

  private follow(record: CharacterRecord, execution: CharacterSkillExecution, args: Record<string, unknown>): void {
    const targetId = this.callbacks.resolveTargetRef(record, String(args.targetRef));
    const target = targetId ? this.options.entities.get(targetId) : null;
    if (!target) return this.finish(record, execution, 'failed', 'target-unavailable');
    if (distance(this.options.entities.get(record.entityId)!.position, target.position) <= 1.5) {
      if (execution.actionId) this.completeAction(execution, { followedEntityId: target.id });
      execution.phase = 'following';
      return;
    }
    this.move(record, execution, target.position, numberArg(args, 'maxReplans', 64), target.id);
  }

  private flee(record: CharacterRecord, execution: CharacterSkillExecution, args: Record<string, unknown>): void {
    const maxReplans = numberArg(args, 'maxReplans', 16);
    if (execution.targetPosition)
      return this.move(record, execution, execution.targetPosition, maxReplans, execution.targetEntityId);
    const threat = this.threat(record);
    if (!threat) return this.finish(record, execution, 'succeeded');
    const body = this.options.entities.get(record.entityId)!;
    const dx = body.position[0] - threat.position[0];
    const dz = body.position[2] - threat.position[2];
    const length = Math.hypot(dx, dz);
    const span = numberArg(args, 'distance', 6);
    this.move(
      record,
      execution,
      [
        body.position[0] + (length ? dx / length : -1) * span,
        body.position[1],
        body.position[2] + (length ? dz / length : 0) * span,
      ],
      maxReplans,
      threat.id,
    );
  }

  private attack(record: CharacterRecord, execution: CharacterSkillExecution): void {
    const threat = this.threat(record);
    if (!threat) return this.finish(record, execution, 'succeeded');
    if (!execution.actionId) {
      const result = this.options.requestCombat(record.entityId, threat.id);
      if (!result.success || !result.actionId)
        return this.finish(record, execution, 'failed', result.reason ?? 'combat-rejected');
      execution.actionId = result.actionId;
      execution.targetEntityId = threat.id;
      execution.phase = 'attacking';
      return;
    }
    const action = this.options.action(execution.actionId);
    if (!action) return this.finish(record, execution, 'failed', 'action-unavailable');
    if (action.status === 'succeeded') this.finish(record, execution, 'succeeded');
    else if (action.status === 'failed' || action.status === 'interrupted')
      this.finish(record, execution, 'failed', action.reason);
  }

  private move(
    record: CharacterRecord,
    execution: CharacterSkillExecution,
    target: CharacterPositionTuple,
    maxReplans: number,
    targetEntityId?: string,
    avoidThreats = false,
  ): void {
    const entity = this.options.entities.get(record.entityId)!;
    if (avoidThreats && !this.safePosition(record, target)) return this.waitForSafety(record, execution);
    if (distance(entity.position, target) <= ARRIVAL) {
      if (execution.actionId) this.completeAction(execution, { position: target });
      return this.finish(record, execution, 'succeeded');
    }
    let existing = execution.actionId ? this.options.action(execution.actionId) : null;
    if (existing && (existing.status === 'failed' || existing.status === 'interrupted'))
      return this.finish(record, execution, 'failed', existing.reason);
    if (existing?.status === 'succeeded') {
      execution.actionId = undefined;
      existing = null;
    }
    execution.phase = 'moving';
    const changed = !execution.targetPosition || distance(execution.targetPosition, target) > 0.25;
    const due = execution.elapsedSeconds >= (execution.replanCount + 1) * REPLAN_SECONDS;
    if (existing && !changed) {
      if (avoidThreats && !this.safePath(record, [entity.position, ...existing.path.slice(existing.pathIndex)]))
        return this.waitForSafety(record, execution);
      this.advanceWaypoint(existing, entity);
      existing = this.options.action(existing.id);
      const progressing = distance(entity.position, record.lastPosition) > 0.05;
      if (!due || progressing) return;
    }
    if (existing && execution.replanCount >= maxReplans)
      return this.finish(record, execution, 'failed', 'replan-limit');
    const plan = this.options.plan(entity.position, target);
    if (plan.status !== 'reached') {
      execution.replanCount += 1;
      if (execution.replanCount >= maxReplans) this.finish(record, execution, 'failed', `path-${plan.status}`);
      return;
    }
    // ActionRuntime starts at waypoint 1; waypoint 0 is the snapped start cell, not an executed segment.
    if (avoidThreats && !this.safePath(record, [entity.position, ...plan.path.slice(1)]))
      return this.waitForSafety(record, execution);
    if (existing) this.options.updateActionPath(existing.id, plan.path, ++execution.replanCount, target);
    else {
      if (!this.options.canStartAction()) return this.finish(record, execution, 'failed', 'action-sequence-exhausted');
      const action = this.options.startAction(record.entityId, {
        type: 'move-to',
        targetPosition: target,
        ...(targetEntityId ? { targetEntityId } : {}),
      });
      this.options.markActionRunning(action.id, plan.path);
      execution.actionId = action.id;
    }
    execution.targetPosition = [...target];
    execution.targetEntityId = targetEntityId;
  }

  private advanceWaypoint(
    action: NonNullable<ReturnType<CharacterRuntimeOptions['action']>>,
    entity: GameplayEntity,
  ): void {
    const waypoint = action.path[action.pathIndex];
    if (waypoint && action.pathIndex < action.path.length - 1 && distance(entity.position, waypoint) <= 0.65)
      this.options.setActionPathIndex(action.id, action.pathIndex + 1);
  }

  private completeAction(execution: CharacterSkillExecution, result: unknown): void {
    const action = execution.actionId ? this.options.action(execution.actionId) : null;
    if (action && (action.status === 'pending' || action.status === 'running'))
      this.options.succeedAction(action.id, result);
    execution.actionId = undefined;
    execution.targetPosition = undefined;
  }

  private finish(
    record: CharacterRecord,
    execution: CharacterSkillExecution,
    status: 'succeeded' | 'failed',
    reason?: string,
  ): void {
    if (execution.status !== 'running') return;
    const actionId = execution.actionId;
    const action = actionId ? this.options.action(actionId) : null;
    if (action && (action.status === 'pending' || action.status === 'running')) {
      if (status === 'succeeded') this.options.succeedAction(action.id, { behaviorNodeId: execution.nodeId });
      else this.options.failAction(action.id, reason ?? 'skill-failed');
    }
    execution.status = status;
    execution.reason = reason;
    this.callbacks.record(record, status === 'succeeded' ? 'activity-succeeded' : 'activity-failed', {
      nodeId: execution.nodeId,
      actionId,
      episode: execution.activation,
      reason,
      count: execution.count,
      position: this.options.entities.get(record.entityId)?.position,
      hunger: this.options.actor(record.entityId)?.hunger,
    });
    if (execution.nodeId === 'legacy-goal') {
      if (status === 'succeeded') {
        if (record.currentGoal.goal.kind !== 'forage' && record.currentGoal.goal.kind !== 'follow') {
          record.currentGoal = { ...record.currentGoal, status: 'succeeded' };
          record.revision += 1;
        }
        this.callbacks.record(record, 'goal-succeeded');
      } else {
        record.currentGoal = { ...record.currentGoal, status: 'failed', reason };
        record.revision += 1;
        this.callbacks.record(record, reason === 'target-unavailable' ? 'target-lost' : 'goal-failed', { reason });
        this.callbacks.record(record, 'fallback', { reason });
      }
    }
  }

  interrupt(record: CharacterRecord, execution: CharacterSkillExecution, reason: string): void {
    if (execution.status !== 'running') return;
    const actionId = execution.actionId;
    if (actionId && ['pending', 'running'].includes(this.options.action(actionId)?.status ?? ''))
      this.options.interruptAction(record.entityId, reason);
    execution.status = 'interrupted';
    execution.reason = reason;
    this.callbacks.record(record, 'activity-interrupted', {
      nodeId: execution.nodeId,
      actionId,
      episode: execution.activation,
      reason,
    });
  }

  private safePosition(record: CharacterRecord, position: readonly number[]): boolean {
    const memory = record.behaviorTree.recentThreat;
    return !memory || distance(memory.position, position) >= THREAT_CLEARANCE;
  }

  private safePath(record: CharacterRecord, path: readonly CharacterPositionTuple[]): boolean {
    const memory = record.behaviorTree.recentThreat;
    if (!memory || !path.length) return true;
    // Allow outward travel when starting inside the remembered radius, but not a shortcut back through it.
    const clearance = Math.min(THREAT_CLEARANCE, distance(path[0], memory.position)) - 0.1;
    for (let index = 1; index < path.length; index += 1) {
      const start = path[index - 1];
      const end = path[index];
      const delta = end.map((coordinate, axis) => coordinate - start[axis]);
      const squared = delta.reduce((sum, coordinate) => sum + coordinate * coordinate, 0);
      const along = squared
        ? Math.max(
            0,
            Math.min(
              1,
              delta.reduce((sum, coordinate, axis) => sum + coordinate * (memory.position[axis] - start[axis]), 0) /
                squared,
            ),
          )
        : 0;
      if (
        distance(
          memory.position,
          start.map((coordinate, axis) => coordinate + delta[axis] * along),
        ) < clearance
      )
        return false;
    }
    return true;
  }

  private waitForSafety(record: CharacterRecord, execution: CharacterSkillExecution): void {
    if (execution.actionId) this.options.interruptAction(record.entityId, 'remembered-threat');
    execution.actionId = undefined;
    execution.targetPosition = undefined;
    execution.phase = 'waiting-for-safety';
  }

  private nearestFood(record: CharacterRecord, avoidThreats: boolean): GameplayEntity | null {
    const body = this.options.entities.get(record.entityId)!;
    return (
      this.options
        .observe(record.entityId)
        .visibleEntities.map((entry) => this.options.entities.get(entry.entityId))
        .filter((entry): entry is GameplayEntity =>
          Boolean(
            entry?.stack &&
            getItemCapability(entry.stack.itemId, 'consume') &&
            (!avoidThreats || this.safePosition(record, entry.position)),
          ),
        )
        .sort(
          (a, b) =>
            distance(body.position, a.position) - distance(body.position, b.position) || a.id.localeCompare(b.id),
        )[0] ?? null
    );
  }

  private threat(record: CharacterRecord): GameplayEntity | null {
    if (record.dangerSecondsRemaining > 0 && record.lastThreatEntityId) {
      const recent = this.options.entities.get(record.lastThreatEntityId);
      if (recent) return recent;
    }
    const entry = this.options.observe(record.entityId).threats[0];
    return entry ? this.options.entities.get(entry.entityId) : null;
  }

  private isDay(): boolean {
    const hour = ((this.options.worldTime() % 24) + 24) % 24;
    return hour >= 6 && hour < 18;
  }

  condition(record: CharacterRecord, condition: BehaviorCondition, dialogueAfterCursor = 0): boolean {
    if ('all' in condition) {
      const values = condition.all.map((entry) => this.condition(record, entry, dialogueAfterCursor));
      return values.every(Boolean);
    }
    if ('any' in condition) {
      const values = condition.any.map((entry) => this.condition(record, entry, dialogueAfterCursor));
      return values.some(Boolean);
    }
    if ('not' in condition) return !this.condition(record, condition.not, dialogueAfterCursor);
    const args = behaviorArgs(condition.args);
    const actor = this.options.actor(record.entityId);
    const entity = this.options.entities.get(record.entityId);
    switch (condition.name) {
      case 'always':
        return true;
      case 'threat-visible':
        return Boolean(this.threat(record));
      case 'dialogue-received':
        return record.events.some((event) => event.type === 'dialogue-heard' && event.cursor > dialogueAfterCursor);
      case 'hunger-at-least':
        return Boolean(actor && actor.hunger >= numberArg(args, 'value', 0));
      case 'hunger-at-most':
        return Boolean(actor && actor.hunger <= numberArg(args, 'value', 100));
      case 'is-day':
        return this.isDay();
      case 'is-night':
        return !this.isDay();
      case 'at-position':
        return Boolean(entity && distance(entity.position, pos(args.position)) <= numberArg(args, 'radius', ARRIVAL));
      default:
        return false;
    }
  }
}
