import { BROWSER_VERTICAL_CHUNKS } from './browser-world-limits';
import * as pc from 'playcanvas';
import { CHUNK_SIZE, chunkKey, floorDiv } from '../world/voxel';
import type { WorldChange } from '../world/storage';
import type { WorldCommitResult, WorldEditBatch } from '../server/game-server-types';
import type { AuthorityGameplayView } from '../worker/authority-worker-protocol';
import { resolveFillCommand, type FillCommand } from '../server/commands/fill-command';
import type { PerformanceProfile } from '../client/performance-profile';
import type { PerformanceTelemetry } from '../client/performance-telemetry';
import type { MeshPart, PendingMeshTask, PerformanceSummary, StreamingVariant } from './app-contracts';
import { ChunkResourceRepository } from './chunk-resource-repository';
import { MeshTaskScheduler } from './mesh-task-scheduler';
import type { MeshRequestOptions, MeshWorkerPort } from './mesh-task-scheduler';
import {
  createPlayCanvasChunkAdapter,
  summarizeMeshParts,
  type PlayCanvasChunkResource,
} from './playcanvas-chunk-adapter';
import type { QualityProfile } from './quality-profile';
import { FluidFeedbackTracker, type FluidFeedbackTarget } from './fluid-feedback-tracker';
import { WaterMeshTransitionTracker } from './water-mesh-transition';
import { acceptStreamingCanonical, StreamingAdmissionRetry } from './streaming-admission-retry';

type WorldTelemetry = {
  loadedChunks: number;
  renderedChunks: number;
  generationQueue: number;
  meshingQueue: number;
  uploadQueue: number;
  deferredRemeshes: number;
  triangles: number;
  drawCalls: number;
  meshBytes: number;
};

export type WorldAuthorityPort = Readonly<{
  seedText: string;
  seed: number;
  generatorVersion: number;
  mutationCount: number;
  worldRevision: number;
  worldTime: number;
  physicsTick: number;
  commitSequence: number;
  gameplay: AuthorityGameplayView;
  ensureChunkNeighborhood(cx: number, cy: number, cz: number): Promise<void>;
  releasePreparation(cx: number, cy: number, cz: number): void;
  releaseChunkNeighborhood(cx: number, cy: number, cz: number): void;
  prepareWorkerInput(
    cx: number,
    cy: number,
    cz: number,
  ): {
    chunkRevision: number;
    generatorVersion: number;
    canonical?: Uint16Array;
    fluid?: Uint8Array;
    overlays: Array<{ cx: number; cy: number; cz: number; voxels: Uint16Array; fluid?: Uint8Array }>;
  };
  acceptWorkerCanonical(
    task: PendingMeshTask,
    result: Readonly<{ canonical?: ArrayBuffer; generatorVersion?: number }>,
  ): boolean | Promise<boolean>;
  getVoxel(x: number, y: number, z: number): number;
  getFluidCell(x: number, y: number, z: number): { level: number; source: boolean } | null;
  getChunkRevision(cx: number, cy: number, cz: number): number | null;
  setFluidActiveChunks(keys: readonly string[]): void;
  editWorld(
    actorId: string,
    edits: readonly { x: number; y: number; z: number; value: number }[],
  ): Promise<WorldCommitResult>;
  setWorldTime(hours: number): Promise<{ worldTime: number }>;
}>;

export class World {
  private readonly scheduler: MeshTaskScheduler;
  private readonly repository: ChunkResourceRepository<PendingMeshTask, MeshPart, PlayCanvasChunkResource>;
  private readonly dirtyChunks = new Set<string>();
  private readonly fluidDirtyChunks = new Set<string>();
  private remeshTimer: number | null = null;
  private aggregateStructuralEventCount = 0;
  private aggregateRemeshSchedulingCount = 0;
  private latestCommitMutationCount = 0;
  private latestCommitMeshChunkCount = 0;
  private scenarioSequence = 0;
  private scenarioId = 'default';
  private readonly fluidFeedback = new FluidFeedbackTracker();
  private readonly waterTransitions = new WaterMeshTransitionTracker();
  private readonly streamingAdmissionRetry = new StreamingAdmissionRetry();
  private lastCenter = '';
  private disposed = false;

  constructor(
    readonly authority: WorldAuthorityPort,
    meshWorker: MeshWorkerPort,
    app: pc.Application,
    resolveMaterial: (part: MeshPart) => pc.StandardMaterial,
    private readonly quality: QualityProfile,
    private readonly telemetryRecorder: PerformanceTelemetry,
    profile: PerformanceProfile,
    variant: StreamingVariant,
    onStaleVisibleCommit: () => void = () => undefined,
    waterLayerId?: number,
  ) {
    this.scheduler = new MeshTaskScheduler({
      worker: meshWorker,
      profile,
      telemetry: telemetryRecorder,
      variant,
      source: {
        seed: authority.seed,
        generatorVersion: authority.generatorVersion,
        beforePrepare: (cx, cy, cz) => authority.ensureChunkNeighborhood(cx, cy, cz),
        releasePrepared: (cx, cy, cz) => authority.releasePreparation(cx, cy, cz),
        prepareMainSnapshot: () => {
          throw new Error('生产浏览器会话只允许 worker-first 网格路径。');
        },
        prepareWorkerInput: (cx, cy, cz) => authority.prepareWorkerInput(cx, cy, cz),
        acceptWorkerCanonical: (task, result) =>
          acceptStreamingCanonical(() => authority.acceptWorkerCanonical(task, result), this.streamingAdmissionRetry),
      },
      onAcceptedResult: (task, result) => this.repository.enqueue(task, result.meshes),
    });
    this.repository = new ChunkResourceRepository({
      adapter: createPlayCanvasChunkAdapter(
        app,
        resolveMaterial,
        telemetryRecorder,
        waterLayerId,
        this.waterTransitions,
      ),
      isCurrent: (task) => this.scheduler.isCurrent(task),
      profile,
      now: () => performance.now(),
      summarize: summarizeMeshParts,
      onVisible: (task, { transitionPending }) => {
        if (!transitionPending || task.visibilityBarrierRevision === undefined) this.scheduler.completeVisible(task);
        if (!transitionPending)
          this.fluidFeedback.completeVisible(
            task,
            this.telemetryRecorder.trace(task.traceId),
            this.scheduler.fluidSchedulingMetrics,
          );
      },
      onTransitionVisible: (task) => {
        if (task.visibilityBarrierRevision !== undefined) this.scheduler.completeVisible(task);
        this.fluidFeedback.completeVisible(
          task,
          this.telemetryRecorder.trace(task.traceId),
          this.scheduler.fluidSchedulingMetrics,
          'water-transition-progress-visible',
        );
      },
      onDiscard: (task, reason) => {
        telemetryRecorder.markTrace(task.traceId, reason, 'main');
        telemetryRecorder.counter(reason, (telemetryRecorder.snapshot().gauges[reason] ?? 0) + 1);
        onStaleVisibleCommit();
      },
    });
  }

  get seedText() {
    return this.authority.seedText;
  }

  get seed() {
    return this.authority.seed;
  }

  get mutationCount() {
    return this.authority.mutationCount;
  }

  get generatorVersion() {
    return this.authority.generatorVersion;
  }

  get worldTime() {
    return this.authority.worldTime;
  }

  get physicsTick() {
    return this.authority.physicsTick;
  }

  get commitSequence() {
    return this.authority.commitSequence;
  }

  get gameplay() {
    return this.authority.gameplay;
  }

  get transactionDiagnostics() {
    return {
      worldRevision: this.authority.worldRevision,
      structuralEventCount: this.aggregateStructuralEventCount,
      remeshSchedulingCount: this.aggregateRemeshSchedulingCount,
      lastCommitMutationCount: this.latestCommitMutationCount,
      lastCommitMeshChunkCount: this.latestCommitMeshChunkCount,
    };
  }

  get streamCenter(): [number, number] {
    const [x, z] = this.lastCenter.split(',').map(Number);
    return [x || 0, z || 0];
  }

  get telemetry(): WorldTelemetry {
    const chunks = [...this.repository.chunks.values()];
    const meshBytes = chunks.reduce((sum, chunk) => sum + chunk.meshBytes, 0);
    this.telemetryRecorder.gauge('loaded_chunks', chunks.length);
    this.telemetryRecorder.gauge('visible_chunks', chunks.length);
    this.telemetryRecorder.gauge('generation_queue_depth', this.scheduler.generationQueueSize);
    this.telemetryRecorder.gauge('meshing_queue_depth', this.scheduler.meshingQueueSize);
    this.telemetryRecorder.gauge('upload_queue_depth', this.repository.queueSize);
    this.telemetryRecorder.gauge('mesh_cpu_bytes', meshBytes);
    return {
      loadedChunks: chunks.length,
      renderedChunks: chunks.filter((chunk) => chunk.triangles > 0).length,
      generationQueue: this.scheduler.generationQueueSize,
      meshingQueue: this.scheduler.meshingQueueSize,
      uploadQueue: this.repository.queueSize,
      deferredRemeshes: this.dirtyChunks.size,
      triangles: chunks.reduce((sum, chunk) => sum + chunk.triangles, 0),
      drawCalls: chunks.reduce((sum, chunk) => sum + chunk.drawCalls, 0),
      meshBytes,
    };
  }

  get performanceSummary(): PerformanceSummary {
    const snapshot = this.telemetryRecorder.snapshot();
    const traceIds = [...this.scheduler.traceIds];
    return {
      scenarioId: this.scenarioId,
      frame: this.telemetryRecorder.frameSummary(),
      chunkVisible: this.telemetryRecorder.traceSummaryFor(this.scheduler.traceIds),
      completedChunkTraces: traceIds.filter((traceId) => this.telemetryRecorder.trace(traceId)?.complete).length,
      traceEventCount: traceIds.reduce(
        (count, traceId) => count + (this.telemetryRecorder.trace(traceId)?.marks.length ?? 0),
        0,
      ),
      maxMeshCommitsInFrame: this.repository.maxMeshCommitsInFrame,
      maxMeshPartsInFrame: this.repository.maxMeshPartsInFrame,
      visibleAfterPostrender: this.repository.visibleAfterPostrender,
      incidents: this.telemetryRecorder.incidents().length,
      droppedEvents: snapshot.droppedEvents,
      uploadQueueDepth: this.repository.queueSize,
      estimatedMeshBytes: this.telemetry.meshBytes,
    };
  }

  get fluidFeedbackSummary() {
    return this.fluidFeedback.summary();
  }

  get waterTransitionSnapshot() {
    return this.waterTransitions.snapshot();
  }

  beginFluidFeedbackSample(target?: Omit<FluidFeedbackTarget, 'chunkRevisions'>) {
    const chunkRevisions: { key: string; revision: number }[] = [];
    if (target) {
      if (![target.x, target.y, target.z, target.radius].every(Number.isFinite) || target.radius < 0)
        throw new TypeError('Fluid feedback target is invalid.');
      const min = [target.x - target.radius, target.y - target.radius, target.z - target.radius] as const;
      const max = [target.x + target.radius, target.y + target.radius, target.z + target.radius] as const;
      for (let cy = floorDiv(min[1], CHUNK_SIZE); cy <= floorDiv(max[1], CHUNK_SIZE); cy += 1)
        for (let cz = floorDiv(min[2], CHUNK_SIZE); cz <= floorDiv(max[2], CHUNK_SIZE); cz += 1)
          for (let cx = floorDiv(min[0], CHUNK_SIZE); cx <= floorDiv(max[0], CHUNK_SIZE); cx += 1)
            chunkRevisions.push({
              key: chunkKey(cx, cy, cz),
              revision: this.authority.getChunkRevision(cx, cy, cz) ?? -1,
            });
    }
    this.fluidFeedback.begin(this.scheduler.fluidSchedulingMetrics, target ? { ...target, chunkRevisions } : null);
  }

  setWaterTransitionHoldForHarness(held: boolean) {
    this.waterTransitions.setHeldForHarness(held);
  }

  beginFrame() {
    this.repository.beginFrame();
  }

  beginScenario(name: string) {
    this.telemetryRecorder.reset();
    this.scenarioId = `${name}-${++this.scenarioSequence}`;
    this.scheduler.beginScenario();
    this.repository.clear();
    this.fluidFeedback.reset();
    this.waterTransitions.reset();
    this.lastCenter = '';
    return this.scenarioId;
  }

  setStreamingVariant(variant: StreamingVariant) {
    if (variant !== 'worker-first') throw new Error('生产浏览器会话只允许 worker-first 网格路径。');
    if (!this.scheduler.setVariant(variant)) return;
    this.beginScenario(`variant-${variant}`);
  }

  exportTrace() {
    return this.telemetryRecorder.exportChromeTrace();
  }

  async restoreLegacyChanges(changes: WorldChange[]) {
    if (!changes.length) return;
    const result = await this.authority.editWorld(
      'legacy-storage-migration',
      changes.map(([x, y, z, value]) => ({ x, y, z, value })),
    );
    return result;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.remeshTimer !== null) window.clearTimeout(this.remeshTimer);
    this.scheduler.dispose();
    this.repository.dispose();
    this.dirtyChunks.clear();
    this.fluidDirtyChunks.clear();
    this.remeshTimer = null;
  }

  getVoxel(x: number, y: number, z: number) {
    return this.authority.getVoxel(x, y, z);
  }

  getFluidCell(x: number, y: number, z: number) {
    return this.authority.getFluidCell(x, y, z);
  }

  getChunkRevision(cx: number, cy: number, cz: number) {
    return this.authority.getChunkRevision(cx, cy, cz);
  }

  async setWorldTime(hours: number) {
    return (await this.authority.setWorldTime(hours)).worldTime;
  }

  updateStreaming(position: pc.Vec3) {
    const cx = floorDiv(position.x, CHUNK_SIZE);
    const cz = floorDiv(position.z, CHUNK_SIZE);
    const center = `${cx},${cz}`;
    const centerChanged = center !== this.lastCenter;
    if (!centerChanged && !this.streamingAdmissionRetry.consumeDueRetry()) return;
    if (centerChanged) this.streamingAdmissionRetry.reset();
    this.lastCenter = center;
    const span = this.telemetryRecorder.beginSpan('streaming', 'DetermineNeededChunks');
    const needs: [number, number, number, number][] = [];
    for (let y = 0; y < BROWSER_VERTICAL_CHUNKS; y += 1)
      for (let z = cz - this.quality.renderRadius; z <= cz + this.quality.renderRadius; z += 1)
        for (let x = cx - this.quality.renderRadius; x <= cx + this.quality.renderRadius; x += 1)
          needs.push([x, y, z, Math.abs(x - cx) + Math.abs(z - cz)]);
    needs.sort((left, right) => left[3] - right[3]);
    this.authority.setFluidActiveChunks(needs.map(([x, y, z]) => chunkKey(x, y, z)));
    for (const [x, y, z] of needs) this.request(x, y, z);
    const cacheRadius = this.quality.renderRadius + 1;
    for (const [key, chunk] of this.repository.chunks) {
      if (Math.abs(chunk.task.cx - cx) <= cacheRadius && Math.abs(chunk.task.cz - cz) <= cacheRadius) continue;
      this.scheduler.cancel(key);
      this.repository.unload(key);
      this.authority.releaseChunkNeighborhood(chunk.task.cx, chunk.task.cy, chunk.task.cz);
    }
    for (const key of this.scheduler.requestedKeys) {
      const [x, , z] = key.split(',').map(Number);
      if (Math.abs(x - cx) <= cacheRadius && Math.abs(z - cz) <= cacheRadius) continue;
      this.scheduler.cancel(key);
      this.dirtyChunks.delete(key);
    }
    this.telemetryRecorder.endSpan(span);
  }

  requestChunk(cx: number, cy: number, cz: number) {
    this.request(cx, cy, cz, { priority: 'interactive' });
  }

  async edit(x: number, y: number, z: number, value: number) {
    return this.authority.editWorld('player-edit', [{ x, y, z, value }]);
  }

  async editBatch(batch: WorldEditBatch) {
    const edits = [...(batch.edits ?? [])];
    batch.buffers?.forEach((buffer) => buffer.forEach((x, y, z, value) => edits.push({ x, y, z, value })));
    return this.authority.editWorld(batch.actorId, edits);
  }

  async fill(actorId: string, command: FillCommand) {
    return this.editBatch({ actorId, buffers: [resolveFillCommand(command)] });
  }

  consumeServerCommit(result: WorldCommitResult) {
    const change = result.structuralChange;
    if (!change) return;
    const fluidPriority = change.actorId === 'fluid-v2';
    this.fluidFeedback.markFirstCommit(change.chunkRevisions, change.bounds ?? undefined);
    this.aggregateStructuralEventCount += 1;
    this.latestCommitMutationCount = change.mutationCount;
    this.latestCommitMeshChunkCount = change.meshChunks.length;
    let hasPresentationWork = false;
    const revisions = new Map(change.chunkRevisions.map(({ key, revision }) => [key, revision] as const));
    const authorityKeys = new Set(revisions.keys());
    const presentationKeys = [...change.meshChunks].sort(
      (left, right) => Number(authorityKeys.has(right)) - Number(authorityKeys.has(left)),
    );
    presentationKeys.forEach((key) => {
      const pending = this.scheduler.latestTask(key);
      if (pending) {
        hasPresentationWork = true;
        const revision = revisions.get(key);
        if (!fluidPriority && revision !== undefined) this.scheduler.protectVisibleRevision(key, revision);
        this.scheduler.request(pending.cx, pending.cy, pending.cz, {
          forceRemesh: true,
          priority: fluidPriority ? 'interactive-fluid' : 'interactive',
        });
      } else if (this.repository.chunks.has(key)) {
        hasPresentationWork = true;
        const revision = revisions.get(key);
        if (!fluidPriority && revision !== undefined) this.scheduler.protectVisibleRevision(key, revision);
        this.dirtyChunks.add(key);
        if (fluidPriority) this.fluidDirtyChunks.add(key);
      }
    });
    if (hasPresentationWork) this.aggregateRemeshSchedulingCount += 1;
    this.scheduleRemesh(fluidPriority ? 0 : 48);
  }

  drainCommits() {
    this.repository.drain();
  }

  private request(cx: number, cy: number, cz: number, options: boolean | MeshRequestOptions = false) {
    const key = `${cx},${cy},${cz}`;
    const forceRemesh = typeof options === 'boolean' ? options : (options.forceRemesh ?? false);
    if (!forceRemesh && this.repository.chunks.has(key)) return;
    this.scheduler.request(cx, cy, cz, options);
  }

  private scheduleRemesh(delayMs: number) {
    if (this.dirtyChunks.size === 0) return;
    if (this.remeshTimer !== null) {
      if (delayMs > 0) return;
      window.clearTimeout(this.remeshTimer);
    }
    this.remeshTimer = window.setTimeout(() => {
      this.remeshTimer = null;
      const keys = [...this.dirtyChunks];
      this.dirtyChunks.clear();
      for (const key of keys) {
        const chunk = this.repository.chunks.get(key);
        if (chunk)
          this.scheduler.request(chunk.task.cx, chunk.task.cy, chunk.task.cz, {
            forceRemesh: true,
            priority: this.fluidDirtyChunks.has(key) ? 'interactive-fluid' : 'interactive',
          });
        this.fluidDirtyChunks.delete(key);
      }
    }, delayMs);
  }
}
