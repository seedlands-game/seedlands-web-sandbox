export const PROTOCOL_VERSION = 1 as const;
export type SessionEpoch = string;

export type InputCommand = Readonly<{
  kind: 'input';
  protocolVersion: typeof PROTOCOL_VERSION;
  epoch: SessionEpoch;
  stream: string;
  sequence: number;
  targetPhysicsTick: number;
  issuedAtMs: number;
  state: Readonly<{
    moveX: number;
    moveZ: number;
    verticalIntent: -1 | 0 | 1;
    jumpHeld: boolean;
  }>;
  edges: Readonly<{ jumpPressed: boolean }>;
}>;

export type TransactionCommand<T = unknown> = Readonly<{
  kind: 'transaction';
  protocolVersion: typeof PROTOCOL_VERSION;
  epoch: SessionEpoch;
  issuer: string;
  stream: string;
  sequence: number;
  expectedCommitSequence?: number;
  issuedAtMs: number;
  transaction: T;
}>;

export type SequenceDecision = 'accepted' | 'duplicate' | 'out-of-order' | 'late' | 'wrong-epoch' | 'wrong-stream';

export class EpochSequenceGate {
  private lastSequence = -1;

  constructor(
    private readonly epoch: SessionEpoch,
    private readonly stream: string,
  ) {}

  get acknowledgedSequence() {
    return this.lastSequence;
  }

  accept(epoch: SessionEpoch, stream: string, sequence: number): SequenceDecision {
    if (epoch !== this.epoch) return 'wrong-epoch';
    if (stream !== this.stream) return 'wrong-stream';
    if (!Number.isSafeInteger(sequence) || sequence < 0) return 'out-of-order';
    if (sequence === this.lastSequence) return 'duplicate';
    if (sequence < this.lastSequence) return 'out-of-order';
    this.lastSequence = sequence;
    return 'accepted';
  }
}

const idleInput = (epoch: SessionEpoch, stream: string): InputCommand => ({
  kind: 'input',
  protocolVersion: PROTOCOL_VERSION,
  epoch,
  stream,
  sequence: -1,
  targetPhysicsTick: 0,
  issuedAtMs: 0,
  state: { moveX: 0, moveZ: 0, verticalIntent: 0, jumpHeld: false },
  edges: { jumpPressed: false },
});

export class InputCommandBuffer {
  private readonly gate: EpochSequenceGate;
  private currentValue: InputCommand;
  private readonly pending: InputCommand[] = [];
  private consumedSequence = -1;
  private consumedPhysicsTick = -1;
  private resyncRequired = false;

  constructor(epoch: SessionEpoch, stream: string) {
    this.gate = new EpochSequenceGate(epoch, stream);
    this.currentValue = idleInput(epoch, stream);
  }

  get acknowledgedSequence() {
    return this.consumedSequence;
  }

  get current() {
    return this.currentValue;
  }

  get requiresResync() {
    return this.resyncRequired;
  }

  push(command: InputCommand): SequenceDecision {
    if (command.protocolVersion !== PROTOCOL_VERSION) return 'out-of-order';
    const decision = this.gate.accept(command.epoch, command.stream, command.sequence);
    if (decision !== 'accepted') return decision;
    if (command.targetPhysicsTick <= this.consumedPhysicsTick) {
      this.resyncRequired = true;
      return 'late';
    }
    this.pending.push(command);
    this.pending.sort(
      (left, right) => left.targetPhysicsTick - right.targetPhysicsTick || left.sequence - right.sequence,
    );
    return 'accepted';
  }

  clear() {
    if (this.pending.length) this.resyncRequired = true;
    this.consumedSequence = Math.max(this.consumedSequence, ...this.pending.map((command) => command.sequence));
    this.pending.length = 0;
    this.currentValue = {
      ...this.currentValue,
      state: { moveX: 0, moveZ: 0, verticalIntent: 0, jumpHeld: false },
      edges: { jumpPressed: false },
    };
  }

  consumeForTick(physicsTick: number) {
    if (!Number.isSafeInteger(physicsTick) || physicsTick < this.consumedPhysicsTick)
      throw new RangeError('Physics tick must be an increasing integer.');
    this.consumedPhysicsTick = physicsTick;
    let jumpEdge = false;
    while (this.pending[0] && this.pending[0].targetPhysicsTick <= physicsTick) {
      const command = this.pending.shift()!;
      this.currentValue = command;
      this.consumedSequence = command.sequence;
      jumpEdge ||= command.edges.jumpPressed;
    }
    return {
      state: this.currentValue.state,
      jumpRequested: jumpEdge || this.currentValue.state.jumpHeld,
      acknowledgedSequence: this.consumedSequence,
    };
  }
}

type DeduplicationResult<T> = Readonly<{ status: 'executed' | 'duplicate'; receipt: T }>;

export class TransactionDeduplicator<T> {
  private readonly receipts = new Map<string, T>();

  constructor(private readonly epoch: SessionEpoch) {}

  execute(
    epoch: SessionEpoch,
    issuer: string,
    stream: string,
    sequence: number,
    operation: () => T,
  ): DeduplicationResult<T> {
    if (epoch !== this.epoch) throw new RangeError('Transaction epoch does not match the session.');
    if (!issuer || !stream || !Number.isSafeInteger(sequence) || sequence < 0)
      throw new TypeError('Transaction idempotency key is invalid.');
    const key = `${issuer}\u0000${stream}\u0000${sequence}`;
    const previous = this.receipts.get(key);
    if (previous !== undefined) return { status: 'duplicate', receipt: previous };
    const receipt = operation();
    this.receipts.set(key, receipt);
    return { status: 'executed', receipt };
  }
}

export function createSessionEpoch(worldId: string, sequence: number): SessionEpoch {
  if (!worldId || !Number.isSafeInteger(sequence) || sequence < 0) throw new TypeError('Session epoch is invalid.');
  return `${worldId}:${sequence}`;
}
