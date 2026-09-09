import type { NavigationPosition } from './ground-navigator';
import type { CoreClone } from '../../runtime/platform-ports';
import {
  entityReferenceExecutionFailure,
  isEntityLifetimeReference,
  rebindEntityLifetimeReference,
  type EntityIdentityPort,
  type EntityLifetimeReference,
} from './action-identity';

export type ActorActionType = 'move-to' | 'wander' | 'attack' | 'flee' | 'eat' | 'idle' | 'go-to-poi';
export type ActorActionStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'interrupted';
export type ActorAction = {
  id: string;
  actorId: string;
  type: ActorActionType;
  status: ActorActionStatus;
  targetPosition?: NavigationPosition;
  targetEntityId?: string;
  poiId?: string;
  startedAt: number;
  endedAt?: number;
  reason?: string;
  result?: unknown;
  path: NavigationPosition[];
  pathIndex: number;
  repathCount: number;
};
export type ActorActionInput = Pick<ActorAction, 'actorId' | 'type'> &
  Partial<Pick<ActorAction, 'targetPosition' | 'targetEntityId' | 'poiId'>>;
export type ActionSnapshotV1 = { version: 1; sequence: number; actions: ActorAction[] };
export type BoundActorActionSnapshot = ActorAction & {
  actorIdentity?: EntityLifetimeReference;
  targetIdentity?: EntityLifetimeReference;
};
export type ActionSnapshotV2 = { version: 2; sequence: number; actions: BoundActorActionSnapshot[] };
export type ActionSnapshot = ActionSnapshotV1 | ActionSnapshotV2;

type ActionBindings = {
  actor: EntityLifetimeReference | null;
  target: EntityLifetimeReference | null;
};

const validatePath = (path: readonly NavigationPosition[]): void => {
  if (
    !Array.isArray(path) ||
    path.some((point) => !Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite))
  )
    throw new TypeError('Action path is invalid.');
};
const terminal = (status: ActorActionStatus) => ['succeeded', 'failed', 'interrupted'].includes(status);
export class ActionRuntime {
  private readonly actions = new Map<string, ActorAction>();
  private readonly currentByActor = new Map<string, string>();
  private readonly bindings = new Map<string, ActionBindings>();
  private sequence = 0;

  constructor(
    private readonly cloneValue: CoreClone,
    private readonly identity?: EntityIdentityPort,
  ) {}

  private clone(action: ActorAction): ActorAction {
    return {
      ...action,
      ...(action.targetPosition ? { targetPosition: [...action.targetPosition] } : {}),
      path: action.path.map((point) => [...point]),
      ...(action.result && typeof action.result === 'object' ? { result: this.cloneValue(action.result) } : {}),
    };
  }

  start(input: ActorActionInput, now: number): ActorAction {
    this.validateInput(input, now);
    if (this.sequence >= Number.MAX_SAFE_INTEGER) throw new RangeError('Action sequence is exhausted.');
    const bindings = this.captureBindings(input.actorId, input.targetEntityId);
    this.interruptActor(input.actorId, now, 'replaced');
    const action: ActorAction = {
      ...input,
      ...(input.targetPosition ? { targetPosition: [...input.targetPosition] } : {}),
      id: `action-${++this.sequence}`,
      status: 'pending',
      startedAt: now,
      path: [],
      pathIndex: 0,
      repathCount: 0,
    };
    this.actions.set(action.id, action);
    this.bindings.set(action.id, bindings);
    this.currentByActor.set(action.actorId, action.id);
    return this.clone(action);
  }

  get(id: string): ActorAction | null {
    const action = this.actions.get(id);
    return action ? this.clone(action) : null;
  }

  forActor(actorId: string): ActorAction | null {
    const id = this.currentByActor.get(actorId);
    return id ? this.get(id) : null;
  }

  markRunning(id: string, path: readonly NavigationPosition[]): ActorAction {
    validatePath(path);
    const action = this.requireExecutable(id);
    action.status = 'running';
    action.path = path.map((point) => [...point]);
    action.pathIndex = Math.min(1, action.path.length);
    return this.clone(action);
  }

  updatePath(id: string, path: readonly NavigationPosition[], repathCount: number): ActorAction {
    validatePath(path);
    if (!Number.isSafeInteger(repathCount) || repathCount < 0) throw new TypeError('Action repath count is invalid.');
    const action = this.requireExecutable(id);
    action.path = path.map((point) => [...point]);
    action.pathIndex = Math.min(1, action.path.length);
    action.repathCount = repathCount;
    action.status = 'running';
    return this.clone(action);
  }

  setPathIndex(id: string, pathIndex: number): void {
    const action = this.requireExecutable(id);
    if (!Number.isInteger(pathIndex) || pathIndex < 0 || pathIndex > action.path.length)
      throw new TypeError('Action path index is invalid.');
    action.pathIndex = pathIndex;
  }

  succeed(id: string, now: number, result?: unknown): ActorAction {
    // The committed effect may consume the target; actor identity still has to be current.
    this.requireExecutable(id, false);
    return this.finish(id, 'succeeded', now, undefined, result);
  }

  fail(id: string, now: number, reason: string): ActorAction {
    return this.finish(id, 'failed', now, reason);
  }

  interruptActor(actorId: string, now: number, reason: string): boolean {
    const id = this.currentByActor.get(actorId);
    if (!id) return false;
    this.finish(id, 'interrupted', now, reason);
    return true;
  }

  snapshot(): ActionSnapshot {
    if (this.identity) {
      return {
        version: 2,
        sequence: this.sequence,
        actions: [...this.actions.values()].map((action) => {
          const bindings = this.bindings.get(action.id);
          return {
            ...this.clone(action),
            ...(bindings?.actor ? { actorIdentity: { ...bindings.actor } } : {}),
            ...(bindings?.target ? { targetIdentity: { ...bindings.target } } : {}),
          };
        }),
      };
    }
    return {
      version: 1,
      sequence: this.sequence,
      actions: [...this.actions.values()].map((action) => this.clone(action)),
    };
  }

  restore(raw: unknown): void {
    try {
      const snapshot = raw as ActionSnapshot;
      if (
        !snapshot ||
        (snapshot.version !== 1 && snapshot.version !== 2) ||
        !Number.isSafeInteger(snapshot.sequence) ||
        snapshot.sequence < 0 ||
        !Array.isArray(snapshot.actions)
      )
        throw new TypeError('header is invalid');
      if (snapshot.version === 2 && !this.identity) throw new TypeError('version 2 requires an entity identity port');
      const actions = new Map<string, ActorAction>();
      const current = new Map<string, string>();
      const bindings = new Map<string, ActionBindings>();
      for (const encoded of snapshot.actions) {
        const plainAction = { ...(encoded as BoundActorActionSnapshot) };
        delete plainAction.actorIdentity;
        delete plainAction.targetIdentity;
        const action = this.clone(plainAction);
        this.validateAction(action);
        const ordinal = Number(/^action-([1-9]\d*)$/.exec(action.id)?.[1]);
        if (!Number.isSafeInteger(ordinal) || ordinal > snapshot.sequence)
          throw new TypeError('Action identity exceeds the allocator high-water mark.');
        if (actions.has(action.id)) throw new TypeError('duplicate action id');
        const rebound =
          snapshot.version === 2
            ? this.restoreBoundAction(encoded as BoundActorActionSnapshot, action)
            : this.restoreLegacyAction(action);
        actions.set(action.id, action);
        bindings.set(action.id, rebound);
        if (!terminal(action.status)) {
          if (current.has(action.actorId)) throw new TypeError('actor has multiple active actions');
          current.set(action.actorId, action.id);
        }
      }
      this.actions.clear();
      actions.forEach((action, id) => this.actions.set(id, action));
      this.currentByActor.clear();
      current.forEach((id, actorId) => this.currentByActor.set(actorId, id));
      this.bindings.clear();
      bindings.forEach((value, id) => this.bindings.set(id, value));
      this.sequence = snapshot.sequence;
    } catch (error) {
      throw new Error(`Invalid action snapshot: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
  }

  private finish(
    id: string,
    status: Extract<ActorActionStatus, 'succeeded' | 'failed' | 'interrupted'>,
    now: number,
    reason?: string,
    result?: unknown,
  ): ActorAction {
    const action = this.requireActive(id);
    action.status = status;
    action.endedAt = now;
    if (reason) action.reason = reason;
    if (result !== undefined) action.result = this.cloneValue(result);
    this.currentByActor.delete(action.actorId);
    return this.clone(action);
  }

  private requireActive(id: string): ActorAction {
    const action = this.actions.get(id);
    if (!action) throw new RangeError(`Unknown action: ${id}`);
    if (terminal(action.status)) throw new Error(`Action is already ${action.status}: ${id}`);
    return action;
  }

  private requireExecutable(id: string, checkTarget = true): ActorAction {
    const action = this.requireActive(id);
    if (!this.identity) return action;
    const bindings = this.bindings.get(id);
    if (!bindings?.actor) return this.rejectExecution(action, 'actor-binding-missing');
    const actorReason = entityReferenceExecutionFailure(this.identity, bindings.actor, action.actorId, 'actor');
    if (actorReason) return this.rejectExecution(action, actorReason);
    if (checkTarget && action.targetEntityId) {
      if (!bindings.target) return this.rejectExecution(action, 'target-binding-missing');
      const targetReason = entityReferenceExecutionFailure(
        this.identity,
        bindings.target,
        action.targetEntityId,
        'target',
      );
      if (targetReason) return this.rejectExecution(action, targetReason);
    }
    return action;
  }

  private rejectExecution(action: ActorAction, reason: string): never {
    action.status = 'failed';
    action.endedAt = action.startedAt;
    action.reason = reason;
    this.currentByActor.delete(action.actorId);
    throw new Error(`Action identity rejected: ${reason}`);
  }

  private captureBindings(actorId: string, targetId?: string): ActionBindings {
    if (!this.identity) return { actor: null, target: null };
    const actor = this.identity.referenceFor(actorId);
    if (!actor) throw new TypeError('Action actor binding is unavailable.');
    const target = targetId ? this.identity.referenceFor(targetId) : null;
    if (targetId && !target) throw new TypeError('Action target binding is unavailable.');
    return { actor: { ...actor }, target: target ? { ...target } : null };
  }

  private restoreLegacyAction(action: ActorAction): ActionBindings {
    if (!this.identity || terminal(action.status)) return { actor: null, target: null };
    const actor = this.identity.referenceFor(action.actorId);
    if (!actor) throw new TypeError('restore-actor-missing');
    const target = action.targetEntityId ? this.identity.referenceFor(action.targetEntityId) : null;
    if (action.targetEntityId && !target) this.settleRestoredAction(action, 'restore-target-missing');
    return { actor: { ...actor }, target: target ? { ...target } : null };
  }

  private restoreBoundAction(encoded: BoundActorActionSnapshot, action: ActorAction): ActionBindings {
    const actor = encoded.actorIdentity;
    const target = encoded.targetIdentity;
    if (actor !== undefined && (!isEntityLifetimeReference(actor) || actor.entityId !== action.actorId))
      throw new TypeError('actor binding is invalid');
    if (
      target !== undefined &&
      (!isEntityLifetimeReference(target) || !action.targetEntityId || target.entityId !== action.targetEntityId)
    )
      throw new TypeError('target binding is invalid');
    if (terminal(action.status)) {
      return {
        actor: actor ? { ...actor } : null,
        target: target ? { ...target } : null,
      };
    }
    if (!actor) throw new TypeError('active actor binding is missing');
    const reboundActor = rebindEntityLifetimeReference(this.identity!, actor, action.actorId, 'actor');
    if (!reboundActor.ok) throw new TypeError(reboundActor.reason);
    if (!action.targetEntityId) {
      if (target) throw new TypeError('target binding has no target entity');
      return { actor: reboundActor.reference, target: null };
    }
    if (!target) throw new TypeError('active target binding is missing');
    const reboundTarget = rebindEntityLifetimeReference(this.identity!, target, action.targetEntityId, 'target');
    if (!reboundTarget.ok) {
      this.settleRestoredAction(action, reboundTarget.reason);
      return { actor: reboundActor.reference, target: { ...target } };
    }
    return { actor: reboundActor.reference, target: reboundTarget.reference };
  }

  private settleRestoredAction(action: ActorAction, reason: string): void {
    action.status = 'failed';
    action.endedAt = action.startedAt;
    action.reason = reason;
  }

  private validateInput(input: ActorActionInput, now: number): void {
    if (!input.actorId?.trim() || !Number.isFinite(now)) throw new TypeError('Action identity or time is invalid.');
    if (
      Object.prototype.hasOwnProperty.call(input, 'actorIdentity') ||
      Object.prototype.hasOwnProperty.call(input, 'targetIdentity')
    )
      throw new TypeError('Action identity binding must be supplied by the host.');
    if (!['move-to', 'wander', 'attack', 'flee', 'eat', 'idle', 'go-to-poi'].includes(input.type))
      throw new TypeError('Action type is invalid.');
    if (input.targetPosition && (input.targetPosition.length !== 3 || !input.targetPosition.every(Number.isFinite)))
      throw new TypeError('Action target position is invalid.');
  }

  private validateAction(action: ActorAction): void {
    this.validateInput(action, action.startedAt);
    if (
      !action.id?.trim() ||
      !['pending', 'running', 'succeeded', 'failed', 'interrupted'].includes(action.status) ||
      !Array.isArray(action.path) ||
      !Number.isSafeInteger(action.pathIndex) ||
      action.pathIndex < 0 ||
      action.pathIndex > action.path.length ||
      !Number.isSafeInteger(action.repathCount) ||
      action.repathCount < 0
    )
      throw new TypeError('action fields are invalid');
    validatePath(action.path);
  }
}
