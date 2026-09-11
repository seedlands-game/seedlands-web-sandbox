export type KernelStateSnapshot = Readonly<{
  epoch: number;
  commitSequence: number;
  worldRevision: number;
  gameplayRevision: number;
  gameplayTime: number;
  worldTime: number;
}>;

export type KernelStateParticipantDefinition<Value> = Readonly<{
  id: string;
  create(): Value;
  dispose(value: Value): void;
}>;

const safeNonNegative = (value: number, label: string) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer.`);
};

const finiteNonNegative = (value: number, label: string) => {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be finite and non-negative.`);
};

/**
 * Single per-world owner for execution epoch, commit ordering and legacy
 * revision/clock projections. Domain code prepares mutations first, then asks
 * this owner to publish the already validated revision.
 */
export function createKernelStateOwner(initial: Partial<KernelStateSnapshot> = {}) {
  let epoch = initial.epoch ?? 1;
  let commitSequence = initial.commitSequence ?? 0;
  let worldRevision = initial.worldRevision ?? 0;
  let gameplayRevision = initial.gameplayRevision ?? 0;
  let gameplayTime = initial.gameplayTime ?? 0;
  let worldTime = initial.worldTime ?? 0;
  const participants = new Map<string, Readonly<{ value: unknown; dispose(value: unknown): void }>>();
  let participantsFrozen = false;
  let disposed = false;
  safeNonNegative(epoch, 'Kernel epoch');
  if (epoch === 0) throw new RangeError('Kernel epoch must be positive.');
  safeNonNegative(commitSequence, 'Kernel commit sequence');
  safeNonNegative(worldRevision, 'Kernel world revision');
  safeNonNegative(gameplayRevision, 'Kernel gameplay revision');
  finiteNonNegative(gameplayTime, 'Kernel gameplay time');
  if (!Number.isFinite(worldTime)) throw new RangeError('Kernel world time must be finite.');

  const nextCommit = () => {
    if (commitSequence >= Number.MAX_SAFE_INTEGER) throw new RangeError('Kernel commit sequence is exhausted.');
    commitSequence += 1;
  };
  const gameplayCommitCount = (eventCount: number) => {
    safeNonNegative(eventCount, 'Kernel event count');
    const count = Math.max(1, eventCount);
    if (gameplayRevision >= Number.MAX_SAFE_INTEGER) throw new RangeError('Kernel gameplay revision is exhausted.');
    if (commitSequence > Number.MAX_SAFE_INTEGER - count) throw new RangeError('Kernel commit sequence is exhausted.');
    return count;
  };
  const assertExpectedEpoch = (expectedEpoch: number) => {
    if (disposed) throw new Error('Kernel state owner is disposed.');
    if (expectedEpoch !== epoch) throw new Error(`Stale Kernel epoch: expected ${epoch}, received ${expectedEpoch}.`);
  };
  return Object.freeze({
    get epoch() {
      return epoch;
    },
    get commitSequence() {
      return commitSequence;
    },
    get worldRevision() {
      return worldRevision;
    },
    get gameplayRevision() {
      return gameplayRevision;
    },
    get gameplayTime() {
      return gameplayTime;
    },
    get worldTime() {
      return worldTime;
    },
    assertExpectedEpoch,
    createParticipant<Value>(definition: KernelStateParticipantDefinition<Value>): Value {
      if (disposed) throw new Error('Kernel state owner is disposed.');
      if (participantsFrozen) throw new Error('Kernel state participant registration is frozen.');
      if (!definition.id || participants.has(definition.id))
        throw new TypeError(`Kernel state participant id is invalid or duplicated: ${definition.id}`);
      const value = definition.create();
      participants.set(definition.id, {
        value,
        dispose: (candidate) => definition.dispose(candidate as Value),
      });
      return value;
    },
    freezeParticipants(): void {
      if (disposed) throw new Error('Kernel state owner is disposed.');
      participantsFrozen = true;
    },
    commitWorldRevision(expectedEpoch: number, nextRevision: number): void {
      assertExpectedEpoch(expectedEpoch);
      safeNonNegative(nextRevision, 'Kernel world revision');
      if (nextRevision !== worldRevision + 1)
        throw new Error(`Kernel world revision must advance exactly once: ${worldRevision} -> ${nextRevision}.`);
      nextCommit();
      worldRevision = nextRevision;
    },
    commitGameplay(expectedEpoch: number): number {
      assertExpectedEpoch(expectedEpoch);
      if (gameplayRevision >= Number.MAX_SAFE_INTEGER) throw new RangeError('Kernel gameplay revision is exhausted.');
      nextCommit();
      gameplayRevision += 1;
      return gameplayRevision;
    },
    assertGameplayCommitCapacity(expectedEpoch: number, eventCount: number): void {
      assertExpectedEpoch(expectedEpoch);
      gameplayCommitCount(eventCount);
    },
    assertGameplayBatchCapacity(expectedEpoch: number, mutationCount: number): void {
      assertExpectedEpoch(expectedEpoch);
      safeNonNegative(mutationCount, 'Kernel gameplay mutation count');
      if (gameplayRevision > Number.MAX_SAFE_INTEGER - mutationCount)
        throw new RangeError('Kernel gameplay revision is exhausted.');
      if (commitSequence > Number.MAX_SAFE_INTEGER - mutationCount)
        throw new RangeError('Kernel commit sequence is exhausted.');
    },
    commitGameplayBatch(expectedEpoch: number, mutationCount: number): number {
      assertExpectedEpoch(expectedEpoch);
      safeNonNegative(mutationCount, 'Kernel gameplay mutation count');
      if (mutationCount < 1) throw new RangeError('Kernel gameplay mutation count must be positive.');
      if (gameplayRevision > Number.MAX_SAFE_INTEGER - mutationCount)
        throw new RangeError('Kernel gameplay revision is exhausted.');
      if (commitSequence > Number.MAX_SAFE_INTEGER - mutationCount)
        throw new RangeError('Kernel commit sequence is exhausted.');
      commitSequence += mutationCount;
      gameplayRevision += mutationCount;
      return gameplayRevision;
    },
    commitGameplayTransaction(expectedEpoch: number, eventCount: number): number {
      assertExpectedEpoch(expectedEpoch);
      const count = gameplayCommitCount(eventCount);
      commitSequence += count;
      gameplayRevision += 1;
      return gameplayRevision;
    },
    commitEvent(expectedEpoch: number): number {
      assertExpectedEpoch(expectedEpoch);
      nextCommit();
      return commitSequence;
    },
    synchronizeGameplayTime(expectedEpoch: number, nextTime: number): void {
      assertExpectedEpoch(expectedEpoch);
      finiteNonNegative(nextTime, 'Kernel gameplay time');
      if (nextTime < gameplayTime) throw new Error('Kernel gameplay time cannot move backwards during execution.');
      gameplayTime = nextTime;
    },
    setWorldTime(expectedEpoch: number, hours: number): number {
      assertExpectedEpoch(expectedEpoch);
      if (!Number.isFinite(hours)) throw new TypeError('Kernel world time must be finite.');
      worldTime = ((hours % 24) + 24) % 24;
      return worldTime;
    },
    restoreWorldRevision(nextRevision: number): void {
      safeNonNegative(nextRevision, 'Kernel restored world revision');
      worldRevision = nextRevision;
    },
    restoreCommitFrontier(nextCommitSequence: number, nextWorldRevision: number): void {
      safeNonNegative(nextCommitSequence, 'Kernel restored commit sequence');
      safeNonNegative(nextWorldRevision, 'Kernel restored world revision');
      commitSequence = nextCommitSequence;
      worldRevision = nextWorldRevision;
    },
    restoreGameplay(nextTime: number, nextRevision: number): void {
      finiteNonNegative(nextTime, 'Kernel restored gameplay time');
      safeNonNegative(nextRevision, 'Kernel restored gameplay revision');
      gameplayTime = nextTime;
      gameplayRevision = nextRevision;
    },
    prepareReplacement(
      previousEpoch: number,
      checkpoint: Pick<KernelStateSnapshot, 'commitSequence' | 'worldRevision'>,
    ): number {
      if (disposed) throw new Error('Kernel state owner is disposed.');
      safeNonNegative(previousEpoch, 'Kernel previous epoch');
      if (previousEpoch === 0) throw new RangeError('Kernel previous epoch must be positive.');
      if (previousEpoch >= Number.MAX_SAFE_INTEGER) throw new RangeError('Kernel epoch is exhausted.');
      safeNonNegative(checkpoint.commitSequence, 'Kernel restored commit sequence');
      safeNonNegative(checkpoint.worldRevision, 'Kernel restored world revision');
      epoch = previousEpoch + 1;
      commitSequence = checkpoint.commitSequence;
      worldRevision = checkpoint.worldRevision;
      return epoch;
    },
    replaceEpoch(): number {
      if (epoch >= Number.MAX_SAFE_INTEGER) throw new RangeError('Kernel epoch is exhausted.');
      epoch += 1;
      return epoch;
    },
    snapshot(): KernelStateSnapshot {
      return Object.freeze({ epoch, commitSequence, worldRevision, gameplayRevision, gameplayTime, worldTime });
    },
    dispose(): void {
      if (disposed) return;
      const failures: string[] = [];
      for (const participant of [...participants.values()].reverse()) {
        try {
          participant.dispose(participant.value);
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }
      participants.clear();
      disposed = true;
      if (epoch < Number.MAX_SAFE_INTEGER) epoch += 1;
      if (failures.length) throw new Error(`Kernel state participant disposal failed: ${failures.join('; ')}`);
    },
  });
}

export type KernelStateOwner = ReturnType<typeof createKernelStateOwner>;
