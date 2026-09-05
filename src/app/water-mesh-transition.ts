export type WaterMeshTransitionIdentity = {
  chunkKey: string;
  targetRevision: number;
  traceId: string;
};

export type WaterMeshTransitionRecord = WaterMeshTransitionIdentity & {
  progress: number;
  frameCount: number;
  completed: boolean;
  superseded: boolean;
  progressSamples: number[];
};

export type WaterMeshTransitionSnapshot = {
  activeCount: number;
  active: WaterMeshTransitionRecord[];
  recent: WaterMeshTransitionRecord[];
};

const cloneRecord = (record: WaterMeshTransitionRecord): WaterMeshTransitionRecord => ({
  ...record,
  progressSamples: [...record.progressSamples],
});

export class WaterMeshTransitionTracker {
  private readonly active = new Map<string, WaterMeshTransitionRecord>();
  private readonly recent: WaterMeshTransitionRecord[] = [];
  private heldForHarness = false;

  get held() {
    return this.heldForHarness;
  }

  setHeldForHarness(held: boolean) {
    this.heldForHarness = held;
  }

  begin(identity: WaterMeshTransitionIdentity, initialProgress: number) {
    const progress = Math.max(0, Math.min(1, initialProgress));
    const record: WaterMeshTransitionRecord = {
      ...identity,
      progress,
      frameCount: 1,
      completed: false,
      superseded: false,
      progressSamples: [progress],
    };
    this.active.set(identity.traceId, record);
  }

  advance(traceId: string, progress: number) {
    const record = this.active.get(traceId);
    if (!record) return;
    record.progress = Math.max(record.progress, Math.min(1, progress));
    record.progressSamples.push(record.progress);
    record.frameCount += 1;
  }

  complete(traceId: string) {
    const record = this.active.get(traceId);
    if (!record) return;
    this.advance(traceId, 1);
    record.completed = true;
    this.active.delete(traceId);
    this.pushRecent(record);
  }

  cancel(traceId: string) {
    const record = this.active.get(traceId);
    if (!record) return;
    record.superseded = true;
    this.active.delete(traceId);
    this.pushRecent(record);
  }

  reset() {
    this.active.clear();
    this.recent.length = 0;
    this.heldForHarness = false;
  }

  snapshot(): WaterMeshTransitionSnapshot {
    return {
      activeCount: this.active.size,
      active: [...this.active.values()].map(cloneRecord),
      recent: this.recent.map(cloneRecord),
    };
  }

  private pushRecent(record: WaterMeshTransitionRecord) {
    this.recent.push(record);
    if (this.recent.length > 32) this.recent.shift();
  }
}
