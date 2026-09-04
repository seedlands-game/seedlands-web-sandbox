export type PendingChunkSave = {
  key: string;
  revision: number;
  voxels: Uint16Array;
};

type ChunkSaveState = {
  revision: number;
  persistedRevision: number;
  dirty: boolean;
  evicted: boolean;
  epoch: number;
  leases: number;
  pending?: PendingChunkSave;
  inFlightRevision?: number;
};

export type ChunkSaveCoordinatorOptions = {
  save: (snapshot: PendingChunkSave) => Promise<void>;
};

export class ChunkSaveCoordinator {
  private readonly states = new Map<string, ChunkSaveState>();
  private flushing: Promise<void> | null = null;

  constructor(private readonly options: ChunkSaveCoordinatorOptions) {}

  enqueue(snapshot: PendingChunkSave): void {
    const state = this.states.get(snapshot.key);
    if (state && snapshot.revision < state.revision) throw new Error('Cannot enqueue an older Chunk revision.');
    const next: ChunkSaveState = state ?? {
      revision: 0,
      persistedRevision: 0,
      dirty: false,
      evicted: false,
      epoch: 0,
      leases: 0,
    };
    next.revision = snapshot.revision;
    next.dirty = next.revision > next.persistedRevision;
    next.evicted = false;
    next.epoch += 1;
    next.pending = { ...snapshot, voxels: snapshot.voxels.slice() };
    this.states.set(snapshot.key, next);
  }

  state(key: string): Readonly<ChunkSaveState> | undefined {
    const state = this.states.get(key);
    return state
      ? { ...state, pending: state.pending && { ...state.pending, voxels: state.pending.voxels.slice() } }
      : undefined;
  }

  acknowledge(key: string, revision: number): void {
    const state = this.states.get(key);
    if (!state || revision <= state.persistedRevision) return;
    if (revision > state.revision) throw new Error('Cannot acknowledge a revision newer than the current Chunk.');
    state.persistedRevision = revision;
    state.dirty = state.revision > revision;
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushPending().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async flushPending(): Promise<void> {
    const candidates = [...this.states.entries()].flatMap(([key, state]) =>
      state.pending && state.dirty ? [{ key, revision: state.pending.revision }] : [],
    );
    for (const candidate of candidates) {
      const state = this.states.get(candidate.key);
      const snapshot = state?.pending;
      if (!state || !snapshot || snapshot.revision !== candidate.revision) continue;
      state.pending = undefined;
      state.inFlightRevision = snapshot.revision;
      try {
        await this.options.save(snapshot);
        this.acknowledge(candidate.key, snapshot.revision);
      } catch (error) {
        const pendingAfterFailure = state.pending as PendingChunkSave | undefined;
        if (!pendingAfterFailure || pendingAfterFailure.revision < snapshot.revision) state.pending = snapshot;
        state.dirty = true;
        throw error;
      } finally {
        if (state.inFlightRevision === snapshot.revision) state.inFlightRevision = undefined;
      }
    }
  }

  acquireLease(key: string): { release: () => void } {
    const state = this.states.get(key);
    if (!state) throw new Error(`Unknown Chunk save state: ${key}`);
    state.leases += 1;
    state.epoch += 1;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        state.leases = Math.max(0, state.leases - 1);
        state.epoch += 1;
      },
    };
  }

  async requestEviction(key: string): Promise<boolean> {
    const state = this.states.get(key);
    if (!state) return true;
    const epoch = state.epoch;
    const revision = state.revision;
    if (state.dirty) await this.flush();
    if (
      state.epoch !== epoch ||
      state.revision !== revision ||
      state.persistedRevision !== state.revision ||
      state.leases ||
      state.inFlightRevision !== undefined
    )
      return false;
    state.evicted = true;
    return true;
  }
}
