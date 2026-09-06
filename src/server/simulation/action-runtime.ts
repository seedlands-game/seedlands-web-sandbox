import type { NavigationPosition } from './ground-navigator';

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
export type ActionSnapshot = { version: 1; sequence: number; actions: ActorAction[] };

const terminal = (status: ActorActionStatus) => ['succeeded', 'failed', 'interrupted'].includes(status);
const clone = (action: ActorAction): ActorAction => ({
  ...action,
  ...(action.targetPosition ? { targetPosition: [...action.targetPosition] } : {}),
  path: action.path.map((point) => [...point]),
  ...(action.result && typeof action.result === 'object' ? { result: structuredClone(action.result) } : {}),
});

export class ActionRuntime {
  private readonly actions = new Map<string, ActorAction>();
  private readonly currentByActor = new Map<string, string>();
  private sequence = 0;

  start(input: ActorActionInput, now: number): ActorAction {
    this.validateInput(input, now);
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
    this.currentByActor.set(action.actorId, action.id);
    return clone(action);
  }

  get(id: string): ActorAction | null {
    const action = this.actions.get(id);
    return action ? clone(action) : null;
  }

  forActor(actorId: string): ActorAction | null {
    const id = this.currentByActor.get(actorId);
    return id ? this.get(id) : null;
  }

  markRunning(id: string, path: readonly NavigationPosition[]): ActorAction {
    const action = this.requireActive(id);
    action.status = 'running';
    action.path = path.map((point) => [...point]);
    action.pathIndex = Math.min(1, action.path.length);
    return clone(action);
  }

  updatePath(id: string, path: readonly NavigationPosition[], repathCount: number): ActorAction {
    const action = this.requireActive(id);
    action.path = path.map((point) => [...point]);
    action.pathIndex = Math.min(1, action.path.length);
    action.repathCount = repathCount;
    action.status = 'running';
    return clone(action);
  }

  setPathIndex(id: string, pathIndex: number): void {
    const action = this.requireActive(id);
    if (!Number.isInteger(pathIndex) || pathIndex < 0 || pathIndex > action.path.length)
      throw new TypeError('Action path index is invalid.');
    action.pathIndex = pathIndex;
  }

  succeed(id: string, now: number, result?: unknown): ActorAction {
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
    return { version: 1, sequence: this.sequence, actions: [...this.actions.values()].map(clone) };
  }

  restore(raw: unknown): void {
    try {
      const snapshot = raw as ActionSnapshot;
      if (
        !snapshot ||
        snapshot.version !== 1 ||
        !Number.isInteger(snapshot.sequence) ||
        snapshot.sequence < 0 ||
        !Array.isArray(snapshot.actions)
      )
        throw new TypeError('header is invalid');
      const actions = new Map<string, ActorAction>();
      const current = new Map<string, string>();
      for (const action of snapshot.actions) {
        this.validateAction(action);
        if (actions.has(action.id)) throw new TypeError('duplicate action id');
        actions.set(action.id, clone(action));
        if (!terminal(action.status)) {
          if (current.has(action.actorId)) throw new TypeError('actor has multiple active actions');
          current.set(action.actorId, action.id);
        }
      }
      this.actions.clear();
      actions.forEach((action, id) => this.actions.set(id, action));
      this.currentByActor.clear();
      current.forEach((id, actorId) => this.currentByActor.set(actorId, id));
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
    if (result !== undefined) action.result = structuredClone(result);
    this.currentByActor.delete(action.actorId);
    return clone(action);
  }

  private requireActive(id: string): ActorAction {
    const action = this.actions.get(id);
    if (!action) throw new RangeError(`Unknown action: ${id}`);
    if (terminal(action.status)) throw new Error(`Action is already ${action.status}: ${id}`);
    return action;
  }

  private validateInput(input: ActorActionInput, now: number): void {
    if (!input.actorId?.trim() || !Number.isFinite(now)) throw new TypeError('Action identity or time is invalid.');
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
      !Number.isInteger(action.pathIndex) ||
      !Number.isInteger(action.repathCount)
    )
      throw new TypeError('action fields are invalid');
    action.path.forEach((point) => {
      if (point.length !== 3 || !point.every(Number.isFinite)) throw new TypeError('action path is invalid');
    });
  }
}
