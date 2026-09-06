export type MeshVisibilityBarrierTask = Readonly<{
  chunkKey: string;
  chunkRevision: number;
  visibilityBarrierRevision?: number;
}>;

type BarrierCompletion<Request> = Readonly<{
  deferred?: Request;
  nextBarrier?: number;
}>;

export class MeshVisibilityBarriers<Request extends { visibilityBarrierRevision?: number }> {
  private readonly deferred = new Map<string, Request>();
  private readonly current = new Map<string, number>();
  private readonly next = new Map<string, number>();
  private readonly awaiting = new Set<string>();

  reset() {
    this.deferred.clear();
    this.current.clear();
    this.next.clear();
    this.awaiting.clear();
  }

  cancel(key: string) {
    this.deferred.delete(key);
    this.current.delete(key);
    this.next.delete(key);
    this.awaiting.delete(key);
  }

  protect(key: string, revision: number, active?: MeshVisibilityBarrierTask) {
    if (!Number.isSafeInteger(revision) || revision < 0)
      throw new RangeError('Mesh visibility barrier revision must be a non-negative safe integer.');
    const current = this.current.get(key);
    if (current === undefined) {
      this.current.set(key, revision);
      return;
    }
    if (revision <= current) return;
    if (this.awaiting.has(key) || (active?.visibilityBarrierRevision === current && active.chunkRevision >= current))
      this.next.set(key, Math.max(revision, this.next.get(key) ?? revision));
  }

  isDelaying(key: string) {
    return this.awaiting.has(key);
  }

  existingDeferred(key: string) {
    return this.deferred.get(key);
  }

  defer(key: string, request: Request) {
    this.deferred.set(key, request);
  }

  revisionForRequest(key: string) {
    return this.awaiting.has(key) ? this.next.get(key) : this.current.get(key);
  }

  presents(task: MeshVisibilityBarrierTask) {
    return task.visibilityBarrierRevision !== undefined && task.chunkRevision >= task.visibilityBarrierRevision;
  }

  hold(task: MeshVisibilityBarrierTask, replacement?: Request) {
    this.awaiting.add(task.chunkKey);
    if (replacement) this.deferred.set(task.chunkKey, replacement);
  }

  releaseAttempt(task: MeshVisibilityBarrierTask): Request | undefined {
    if (!this.awaiting.delete(task.chunkKey)) return undefined;
    const deferred = this.deferred.get(task.chunkKey);
    this.deferred.delete(task.chunkKey);
    if (deferred) {
      const current = this.current.get(task.chunkKey);
      if (current === undefined) delete deferred.visibilityBarrierRevision;
      else deferred.visibilityBarrierRevision = current;
    } else {
      this.current.delete(task.chunkKey);
      this.next.delete(task.chunkKey);
    }
    return deferred;
  }

  complete(task: MeshVisibilityBarrierTask): BarrierCompletion<Request> | null {
    if (!this.presents(task)) return null;
    this.awaiting.delete(task.chunkKey);
    const queuedNext = this.next.get(task.chunkKey);
    const nextBarrier = queuedNext !== undefined && task.chunkRevision < queuedNext ? queuedNext : undefined;
    this.next.delete(task.chunkKey);
    if (nextBarrier === undefined) this.current.delete(task.chunkKey);
    else this.current.set(task.chunkKey, nextBarrier);
    const deferred = this.deferred.get(task.chunkKey);
    this.deferred.delete(task.chunkKey);
    return { ...(deferred ? { deferred } : {}), ...(nextBarrier === undefined ? {} : { nextBarrier }) };
  }
}
