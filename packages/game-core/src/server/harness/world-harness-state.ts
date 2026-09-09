import type { AuthorityRuntime } from '../authority/authority-runtime';
import type { FrozenGameSaveSnapshot } from '../persistence/game-save-snapshot';
import {
  WORLD_HARNESS_MAX_CHECKPOINT_BYTES,
  WORLD_HARNESS_TRACE_CAPACITY,
  type WorldCheckpointRequest,
  type WorldCheckpointResult,
  type WorldTraceEvent,
  type WorldTraceRequest,
  type WorldTraceResult,
  type WorldHarnessError,
} from './world-harness-contract';
import { checkpointBytes, validatePortableCheckpoint } from './world-harness-validation';

type CheckpointOptions = Readonly<{
  runtime: () => AuthorityRuntime;
  clone: <Value>(value: Value) => Value;
  restore: (snapshot: FrozenGameSaveSnapshot) => Promise<void>;
}>;

export class WorldCheckpointRuntime {
  private acknowledgedCommitSequence = -1;

  constructor(private readonly options: CheckpointOptions) {}

  get lastAcknowledgedCommitSequence(): number {
    return this.acknowledgedCommitSequence;
  }

  async execute(request: WorldCheckpointRequest): Promise<WorldCheckpointResult> {
    if (request.kind === 'export') {
      const runtime = this.options.runtime();
      const frozen = runtime.exportPortableCheckpoint();
      const persisted = await runtime.persistPortableCheckpoint(frozen);
      if (!persisted.gameplaySaved) throw new CheckpointUnavailableFailure();
      const snapshot = this.options.clone(frozen);
      const byteLength = checkpointBytes(snapshot);
      if (byteLength > WORLD_HARNESS_MAX_CHECKPOINT_BYTES)
        throw new RangeError('Checkpoint exceeds the portable size limit.');
      this.acknowledgedCommitSequence = snapshot.commitSequence;
      return { snapshot, byteLength };
    }
    let snapshot: FrozenGameSaveSnapshot;
    try {
      snapshot = this.options.clone(validatePortableCheckpoint(request.snapshot));
    } catch (cause) {
      throw new InvalidCheckpointFailure(cause instanceof Error ? cause.message : String(cause));
    }
    await this.options.restore(snapshot);
    this.acknowledgedCommitSequence = snapshot.commitSequence;
    return { restored: true, byteLength: checkpointBytes(snapshot) };
  }
}

export class InvalidCheckpointFailure extends Error {
  readonly code = 'WORLD_CHECKPOINT_INVALID';
  readonly kind = 'validation' as const;
}

export class CheckpointUnavailableFailure extends Error {
  readonly code = 'WORLD_CHECKPOINT_UNAVAILABLE';
  readonly kind = 'unavailable' as const;
  constructor() {
    super('Portable checkpoint persistence is unavailable for this Authority.');
  }
}

export class WorldTraceRuntime {
  private readonly events: WorldTraceEvent[] = [];
  private sequence = 0;
  private dropped = 0;

  record(event: Omit<WorldTraceEvent, 'sequence'>): void {
    this.events.push({ sequence: ++this.sequence, ...event });
    if (this.events.length <= WORLD_HARNESS_TRACE_CAPACITY) return;
    const remove = this.events.length - WORLD_HARNESS_TRACE_CAPACITY;
    this.events.splice(0, remove);
    this.dropped += remove;
  }

  read(request: WorldTraceRequest): WorldTraceResult {
    const limit =
      request.kind === 'read'
        ? Math.min(WORLD_HARNESS_TRACE_CAPACITY, Math.max(0, request.limit ?? 64))
        : WORLD_HARNESS_TRACE_CAPACITY;
    if (!Number.isSafeInteger(limit)) throw new TypeError('Trace limit must be a safe integer.');
    const events = limit === 0 ? [] : this.events.slice(-limit);
    return {
      events,
      dropped: this.dropped,
      ...(request.kind === 'export' ? { jsonl: events.map((event) => JSON.stringify(event)).join('\n') } : {}),
    };
  }
}

export class WorldOperationFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly kind: WorldHarnessError['kind'],
  ) {
    super(message);
  }
}
