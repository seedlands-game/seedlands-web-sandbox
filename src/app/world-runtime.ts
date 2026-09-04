import * as pc from 'playcanvas';
import { CHUNK_SIZE, floorDiv } from '../world/voxel';
import type { WorldChange } from '../world/storage';
import type { GameServer } from '../server/game-server';
import type { PerformanceProfile } from '../client/performance-profile';
import type { PerformanceTelemetry } from '../client/performance-telemetry';
import type { MeshPart, PendingMeshTask, PerformanceSummary, StreamingVariant } from './app-contracts';
import { ChunkResourceRepository } from './chunk-resource-repository';
import { MeshTaskScheduler } from './mesh-task-scheduler';
import {
  createPlayCanvasChunkAdapter,
  summarizeMeshParts,
  type PlayCanvasChunkResource,
} from './playcanvas-chunk-adapter';
import type { QualityProfile } from './quality-profile';

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

export class World {
  private readonly scheduler: MeshTaskScheduler;
  private readonly repository: ChunkResourceRepository<PendingMeshTask, MeshPart, PlayCanvasChunkResource>;
  private readonly dirtyChunks = new Set<string>();
  private remeshTimer: number | null = null;
  private scenarioSequence = 0;
  private scenarioId = 'default';
  private lastCenter = '';
  private disposed = false;

  constructor(
    readonly server: GameServer,
    app: pc.Application,
    materials: Map<number, pc.StandardMaterial>,
    private readonly quality: QualityProfile,
    private readonly telemetryRecorder: PerformanceTelemetry,
    profile: PerformanceProfile,
    variant: StreamingVariant,
    onStaleVisibleCommit: () => void = () => undefined,
  ) {
    this.scheduler = new MeshTaskScheduler({
      worker: new Worker(new URL('../worker/world-worker.ts', import.meta.url), { type: 'module' }),
      profile,
      telemetry: telemetryRecorder,
      variant,
      source: {
        seed: server.seed,
        prepareMainSnapshot: (cx, cy, cz) => server.createDerivedMeshSnapshot(cx, cy, cz),
        prepareWorkerInput: (cx, cy, cz) => server.prepareWorkerMeshInput(cx, cy, cz),
        acceptWorkerCanonical: (task, result) =>
          server.acceptWorkerCanonical({
            key: task.chunkKey,
            cx: task.cx,
            cy: task.cy,
            cz: task.cz,
            chunkRevision: task.chunkRevision,
            generatorVersion: task.generatorVersion,
            canonical: new Uint16Array(result.canonical!),
          }),
      },
      onAcceptedResult: (task, result) => this.repository.enqueue(task, result.meshes),
    });
    this.repository = new ChunkResourceRepository({
      adapter: createPlayCanvasChunkAdapter(app, materials, telemetryRecorder),
      isCurrent: (task) => this.scheduler.isCurrent(task),
      profile,
      now: () => performance.now(),
      summarize: summarizeMeshParts,
      onVisible: (task) => this.scheduler.completeVisible(task),
      onDiscard: (task, reason) => {
        telemetryRecorder.markTrace(task.traceId, reason, 'main');
        telemetryRecorder.counter(reason, (telemetryRecorder.snapshot().gauges[reason] ?? 0) + 1);
        onStaleVisibleCommit();
      },
    });
  }

  get seedText() {
    return this.server.options.seedText;
  }

  get seed() {
    return this.server.seed;
  }

  get mutationCount() {
    return this.server.mutationCount;
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
      renderedChunks: chunks.length,
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

  beginFrame() {
    this.repository.beginFrame();
  }

  beginScenario(name: string) {
    this.telemetryRecorder.reset();
    this.scenarioId = `${name}-${++this.scenarioSequence}`;
    this.scheduler.beginScenario();
    this.repository.clear();
    this.lastCenter = '';
    return this.scenarioId;
  }

  setStreamingVariant(variant: StreamingVariant) {
    if (!this.scheduler.setVariant(variant)) return;
    this.beginScenario(`variant-${variant}`);
  }

  exportTrace() {
    return this.telemetryRecorder.exportChromeTrace();
  }

  restoreLegacyChanges(changes: WorldChange[]) {
    if (!changes.length) return;
    this.server.editBatch({
      actorId: 'legacy-storage-migration',
      edits: changes.map(([x, y, z, value]) => ({ x, y, z, value })),
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.remeshTimer !== null) window.clearTimeout(this.remeshTimer);
    this.scheduler.dispose();
    this.repository.dispose();
    this.dirtyChunks.clear();
    this.remeshTimer = null;
  }

  getVoxel(x: number, y: number, z: number) {
    return this.server.getVoxel(x, y, z);
  }

  updateStreaming(position: pc.Vec3) {
    const cx = floorDiv(position.x, CHUNK_SIZE);
    const cz = floorDiv(position.z, CHUNK_SIZE);
    const center = `${cx},${cz}`;
    if (center === this.lastCenter && this.repository.chunks.size) return;
    this.lastCenter = center;
    const span = this.telemetryRecorder.beginSpan('streaming', 'DetermineNeededChunks');
    const needs: [number, number, number, number][] = [];
    for (let y = 0; y <= 1; y += 1)
      for (let z = cz - this.quality.renderRadius; z <= cz + this.quality.renderRadius; z += 1)
        for (let x = cx - this.quality.renderRadius; x <= cx + this.quality.renderRadius; x += 1)
          needs.push([x, y, z, Math.abs(x - cx) + Math.abs(z - cz)]);
    needs.sort((left, right) => left[3] - right[3]);
    for (const [x, y, z] of needs) this.request(x, y, z);
    const cacheRadius = this.quality.renderRadius + 1;
    for (const [key, chunk] of this.repository.chunks) {
      if (Math.abs(chunk.task.cx - cx) <= cacheRadius && Math.abs(chunk.task.cz - cz) <= cacheRadius) continue;
      this.scheduler.cancel(key);
      this.repository.unload(key);
    }
    for (const key of this.scheduler.requestedKeys) {
      const [x, , z] = key.split(',').map(Number);
      if (Math.abs(x - cx) <= cacheRadius && Math.abs(z - cz) <= cacheRadius) continue;
      this.scheduler.cancel(key);
      this.dirtyChunks.delete(key);
    }
    this.telemetryRecorder.endSpan(span);
  }

  edit(x: number, y: number, z: number, value: number) {
    const result = this.server.edit(x, y, z, value);
    result.meshChunks.forEach((key) => {
      const pending = this.scheduler.latestTask(key);
      if (pending) {
        this.scheduler.cancel(key);
        this.scheduler.request(pending.cx, pending.cy, pending.cz, true);
      } else if (this.repository.chunks.has(key)) this.dirtyChunks.add(key);
    });
    this.scheduleRemesh();
  }

  drainCommits() {
    this.repository.drain();
  }

  private request(cx: number, cy: number, cz: number, forceRemesh = false) {
    const key = `${cx},${cy},${cz}`;
    if (!forceRemesh && this.repository.chunks.has(key)) return;
    this.scheduler.request(cx, cy, cz, forceRemesh);
  }

  private scheduleRemesh() {
    if (this.remeshTimer !== null || this.dirtyChunks.size === 0) return;
    this.remeshTimer = window.setTimeout(() => {
      this.remeshTimer = null;
      const keys = [...this.dirtyChunks];
      this.dirtyChunks.clear();
      for (const key of keys) {
        const chunk = this.repository.chunks.get(key);
        if (chunk) this.scheduler.request(chunk.task.cx, chunk.task.cy, chunk.task.cz, true);
      }
    }, 48);
  }
}
