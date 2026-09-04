export type ChunkTask = {
  chunkKey: string;
  cx: number;
  cy: number;
  cz: number;
};

export type ChunkSummary = {
  triangles: number;
  drawCalls: number;
  meshBytes: number;
};

export type ChunkRecord<Task extends ChunkTask, Resource extends object> = ChunkSummary & {
  task: Task;
  resource: Resource;
};

export type ChunkResourceAdapter<Task extends ChunkTask, Part, Resource extends object> = {
  create: (task: Task) => Resource;
  commitPart: (resource: Resource, task: Task, part: Part) => void;
  attach: (resource: Resource, task: Task, onPostrender: () => void) => void;
  destroy: (resource: Resource) => void;
};

type CommitProfile = {
  maxMeshCommitsPerFrame: number;
  maxMeshPartsPerFrame: number;
  maxCommitMs: number;
};

type CommitJob<Task extends ChunkTask, Part, Resource extends object> = {
  task: Task;
  parts: Part[];
  nextPart: number;
  resource: Resource;
};

type RepositoryOptions<Task extends ChunkTask, Part, Resource extends object> = {
  adapter: ChunkResourceAdapter<Task, Part, Resource>;
  isCurrent: (task: Task) => boolean;
  profile: CommitProfile;
  now: () => number;
  summarize: (parts: Part[]) => ChunkSummary;
  onVisible: (task: Task) => void;
  onDiscard: (task: Task, reason: string) => void;
};

export class ChunkResourceRepository<Task extends ChunkTask, Part, Resource extends object> {
  readonly chunks = new Map<string, ChunkRecord<Task, Resource>>();
  private readonly commitQueue: Array<CommitJob<Task, Part, Resource>> = [];
  private readonly attaching = new Set<CommitJob<Task, Part, Resource>>();
  private readonly destroyed = new WeakSet<Resource>();
  private disposed = false;
  private frameCommits = 0;
  private frameParts = 0;
  private maxFrameCommits = 0;
  private maxFrameParts = 0;
  private renderedAfterPostrender = false;

  constructor(private readonly options: RepositoryOptions<Task, Part, Resource>) {}

  get queueSize() {
    return this.commitQueue.length + this.attaching.size;
  }

  get maxMeshCommitsInFrame() {
    return this.maxFrameCommits;
  }

  get maxMeshPartsInFrame() {
    return this.maxFrameParts;
  }

  get visibleAfterPostrender() {
    return this.renderedAfterPostrender;
  }

  beginFrame() {
    this.frameCommits = 0;
    this.frameParts = 0;
  }

  enqueue(task: Task, parts: Part[]) {
    const resource = this.options.adapter.create(task);
    const job = { task, parts, nextPart: 0, resource };
    if (this.disposed || !this.options.isCurrent(task)) {
      this.destroy(resource);
      this.options.onDiscard(task, 'stale-result');
      return resource;
    }
    this.commitQueue.push(job);
    return resource;
  }

  drain() {
    if (this.disposed) return;
    const startedAt = this.options.now();
    while (
      this.commitQueue.length &&
      this.frameCommits < this.options.profile.maxMeshCommitsPerFrame &&
      this.frameParts < this.options.profile.maxMeshPartsPerFrame &&
      this.options.now() - startedAt < this.options.profile.maxCommitMs
    ) {
      const job = this.commitQueue[0];
      if (!this.options.isCurrent(job.task)) {
        this.commitQueue.shift();
        this.discard(job);
        continue;
      }
      const part = job.parts[job.nextPart];
      if (part === undefined) {
        this.commitQueue.shift();
        this.attach(job);
        continue;
      }
      this.options.adapter.commitPart(job.resource, job.task, part);
      job.nextPart += 1;
      this.frameParts += 1;
    }
    this.maxFrameCommits = Math.max(this.maxFrameCommits, this.frameCommits);
    this.maxFrameParts = Math.max(this.maxFrameParts, this.frameParts);
  }

  unload(key: string) {
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    this.chunks.delete(key);
    this.destroy(chunk.resource);
  }

  clear() {
    this.commitQueue.splice(0).forEach((job) => this.destroy(job.resource));
    this.attaching.forEach((job) => this.destroy(job.resource));
    this.attaching.clear();
    this.chunks.forEach((chunk) => this.destroy(chunk.resource));
    this.chunks.clear();
    this.resetFrameStats();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
  }

  private attach(job: CommitJob<Task, Part, Resource>) {
    if (!this.options.isCurrent(job.task)) {
      this.discard(job);
      return;
    }
    this.attaching.add(job);
    this.options.adapter.attach(job.resource, job.task, () => this.finishAttach(job));
    this.frameCommits += 1;
  }

  private finishAttach(job: CommitJob<Task, Part, Resource>) {
    if (!this.attaching.delete(job)) return;
    if (this.disposed || !this.options.isCurrent(job.task)) {
      this.discard(job);
      return;
    }
    const previous = this.chunks.get(job.task.chunkKey);
    if (previous) this.destroy(previous.resource);
    this.chunks.set(job.task.chunkKey, {
      task: job.task,
      resource: job.resource,
      ...this.options.summarize(job.parts),
    });
    this.renderedAfterPostrender = true;
    this.options.onVisible(job.task);
  }

  private discard(job: CommitJob<Task, Part, Resource>) {
    this.attaching.delete(job);
    this.destroy(job.resource);
    this.options.onDiscard(job.task, 'stale-result');
  }

  private destroy(resource: Resource) {
    if (this.destroyed.has(resource)) return;
    this.destroyed.add(resource);
    this.options.adapter.destroy(resource);
  }

  private resetFrameStats() {
    this.frameCommits = 0;
    this.frameParts = 0;
    this.maxFrameCommits = 0;
    this.maxFrameParts = 0;
    this.renderedAfterPostrender = false;
  }
}
