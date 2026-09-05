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

export type SequenceDecision =
  | 'accepted'
  | 'invalid'
  | 'duplicate'
  | 'out-of-order'
  | 'late'
  | 'target-out-of-order'
  | 'too-far-ahead'
  | 'capacity'
  | 'wrong-epoch'
  | 'wrong-stream';

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

const copyInput = (command: InputCommand): InputCommand => ({
  ...command,
  state: { ...command.state },
  edges: { ...command.edges },
});

function validMotionInput(command: InputCommand): boolean {
  return Boolean(
    command &&
    command.kind === 'input' &&
    command.protocolVersion === PROTOCOL_VERSION &&
    Number.isFinite(command.issuedAtMs) &&
    command.state &&
    Number.isFinite(command.state.moveX) &&
    Math.abs(command.state.moveX) <= 1 &&
    Number.isFinite(command.state.moveZ) &&
    Math.abs(command.state.moveZ) <= 1 &&
    [-1, 0, 1].includes(command.state.verticalIntent) &&
    typeof command.state.jumpHeld === 'boolean' &&
    command.edges &&
    typeof command.edges.jumpPressed === 'boolean',
  );
}

export class InputCommandBuffer {
  private readonly gate: EpochSequenceGate;
  private currentValue: InputCommand;
  private readonly pending: InputCommand[] = [];
  private consumedSequence = -1;
  private consumedPhysicsTick = -1;
  private lastAcceptedTargetTick = -1;
  private resyncRequired = false;
  private readonly limits: Readonly<{ maxFutureTicks: number; maxPendingCommands: number }>;

  constructor(
    epoch: SessionEpoch,
    stream: string,
    limits: Partial<Readonly<{ maxFutureTicks: number; maxPendingCommands: number }>> = {},
  ) {
    this.gate = new EpochSequenceGate(epoch, stream);
    this.currentValue = idleInput(epoch, stream);
    this.limits = {
      maxFutureTicks: limits.maxFutureTicks ?? 240,
      maxPendingCommands: limits.maxPendingCommands ?? 256,
    };
    if (
      !Number.isSafeInteger(this.limits.maxFutureTicks) ||
      this.limits.maxFutureTicks < 1 ||
      !Number.isSafeInteger(this.limits.maxPendingCommands) ||
      this.limits.maxPendingCommands < 1
    )
      throw new RangeError('Input buffer limits must be positive integers.');
  }

  get acknowledgedSequence() {
    return this.consumedSequence;
  }

  get current() {
    return copyInput(this.currentValue);
  }

  get requiresResync() {
    return this.resyncRequired;
  }

  push(command: InputCommand): SequenceDecision {
    if (!validMotionInput(command)) return 'invalid';
    const decision = this.gate.accept(command.epoch, command.stream, command.sequence);
    if (decision !== 'accepted') return decision;
    if (!Number.isSafeInteger(command.targetPhysicsTick) || command.targetPhysicsTick < 0) {
      this.invalidatePending();
      return 'target-out-of-order';
    }
    if (command.targetPhysicsTick <= this.consumedPhysicsTick) {
      this.invalidatePending();
      return 'late';
    }
    if (command.targetPhysicsTick < this.lastAcceptedTargetTick) {
      this.invalidatePending();
      return 'target-out-of-order';
    }
    if (command.targetPhysicsTick > this.consumedPhysicsTick + this.limits.maxFutureTicks) {
      this.invalidatePending();
      return 'too-far-ahead';
    }
    if (this.pending.length >= this.limits.maxPendingCommands) {
      this.invalidatePending();
      return 'capacity';
    }
    this.pending.push(copyInput(command));
    this.lastAcceptedTargetTick = command.targetPhysicsTick;
    this.resyncRequired = false;
    return 'accepted';
  }

  clear() {
    if (this.pending.length) this.resyncRequired = true;
    this.pending.length = 0;
    this.lastAcceptedTargetTick = this.consumedPhysicsTick;
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
      state: { ...this.currentValue.state },
      jumpRequested: jumpEdge || this.currentValue.state.jumpHeld,
      acknowledgedSequence: this.consumedSequence,
    };
  }

  private invalidatePending() {
    this.pending.length = 0;
    this.lastAcceptedTargetTick = this.consumedPhysicsTick;
    this.currentValue = {
      ...this.currentValue,
      state: { moveX: 0, moveZ: 0, verticalIntent: 0, jumpHeld: false },
      edges: { jumpPressed: false },
    };
    this.resyncRequired = true;
  }
}

type DeduplicationResult<T> =
  Readonly<{ status: 'executed' | 'duplicate'; receipt: T }> | Readonly<{ status: 'expired' | 'capacity' }>;

type TransactionStream<T> = {
  highWatermark: number;
  receipts: Map<number, T>;
};

export class TransactionDeduplicator<T> {
  private readonly streams = new Map<string, TransactionStream<T>>();
  private readonly limits: Readonly<{ maxStreams: number; maxReceiptsPerStream: number }>;

  constructor(
    private readonly epoch: SessionEpoch,
    limits: Partial<Readonly<{ maxStreams: number; maxReceiptsPerStream: number }>> = {},
  ) {
    this.limits = {
      maxStreams: limits.maxStreams ?? 64,
      maxReceiptsPerStream: limits.maxReceiptsPerStream ?? 256,
    };
    if (
      !Number.isSafeInteger(this.limits.maxStreams) ||
      this.limits.maxStreams < 1 ||
      !Number.isSafeInteger(this.limits.maxReceiptsPerStream) ||
      this.limits.maxReceiptsPerStream < 1
    )
      throw new RangeError('Transaction receipt limits must be positive integers.');
  }

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
    const key = `${issuer}\u0000${stream}`;
    let transactionStream = this.streams.get(key);
    if (!transactionStream) {
      if (this.streams.size >= this.limits.maxStreams) return { status: 'capacity' };
      transactionStream = { highWatermark: -1, receipts: new Map() };
      this.streams.set(key, transactionStream);
    }
    if (transactionStream.receipts.has(sequence))
      return { status: 'duplicate', receipt: transactionStream.receipts.get(sequence)! };
    if (sequence <= transactionStream.highWatermark) return { status: 'expired' };
    const receipt = operation();
    transactionStream.highWatermark = sequence;
    transactionStream.receipts.set(sequence, receipt);
    while (transactionStream.receipts.size > this.limits.maxReceiptsPerStream) {
      const oldest = transactionStream.receipts.keys().next().value;
      if (oldest === undefined) break;
      transactionStream.receipts.delete(oldest);
    }
    return { status: 'executed', receipt };
  }
}

export function createSessionEpoch(worldId: string, sequence: number): SessionEpoch {
  if (!worldId || !Number.isSafeInteger(sequence) || sequence < 0) throw new TypeError('Session epoch is invalid.');
  return `${worldId}:${sequence}`;
}
