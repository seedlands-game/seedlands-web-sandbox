import * as pc from 'playcanvas';
import './style.css';
import {
  CHUNK_SIZE,
  GENERATOR_VERSION,
  Voxel,
  chunkKey,
  floorDiv,
  isSolid,
  voxelNames,
  type FaceMaterialId,
} from '../world/voxel';
import { macroAt, type MacroBiome } from '../world/macro-world';
import { type RenderLayer } from '../world/mesh';
import { decodeWorldSave, type WorldChange } from '../world/storage';
import { GameServer, type WorldCommitResult, type WorldEditBatch } from '../server/game-server';
import { resolveFillCommand, type FillCommand } from '../server/commands/fill-command';
import { BrowserChunkPersistence, decodeBrowserWorldSave } from '../client/browser-chunk-persistence';
import { createMeshTaskSnapshot, isCurrentMeshTask, type MeshTaskIdentity } from '../client/mesh-task-snapshot';
import { PERFORMANCE_PROFILES, type PerformanceProfile } from '../client/performance-profile';
import { PerformanceTelemetry } from '../client/performance-telemetry';
import {
  QUALITY_PROFILES,
  WorldEnvironment,
  createVoxelMaterials,
  type QualityLevel,
  type QualityProfile,
  type VoxelMaterials,
} from './visual-environment';

type MeshPart = {
  material: FaceMaterialId;
  renderLayer: RenderLayer;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Uint8Array;
  indices: Uint32Array;
};
type WorkerResult = {
  kind: 'mesh-result';
  taskId: number;
  traceId: string;
  epoch: number;
  chunkKey: string;
  chunkRevision: number;
  haloRevision: string;
  cx: number;
  cy: number;
  cz: number;
  workerMeshingMs: number;
  workerGenerationMs?: number;
  workerHaloMs?: number;
  computedHaloRevision?: string;
  canonical?: ArrayBuffer;
  generatorVersion?: number;
  meshes: MeshPart[];
};
type Chunk = {
  cx: number;
  cy: number;
  cz: number;
  entity: pc.Entity;
  meshes: pc.Mesh[];
  triangles: number;
  drawCalls: number;
  meshBytes: number;
};
type Change = WorldChange;
type StreamingVariant = 'main-snapshot' | 'worker-first';
type PendingMeshTask = MeshTaskIdentity & {
  chunkKey: string;
  traceId: string;
  seed: number;
  cx: number;
  cy: number;
  cz: number;
  generatorVersion: number;
  variant: StreamingVariant;
};
type PendingMeshRequest = {
  traceId: string;
  epoch: number;
  chunkKey: string;
  cx: number;
  cy: number;
  cz: number;
  queuedAt: number;
};
type MeshCommitJob = {
  task: PendingMeshTask;
  meshes: MeshPart[];
  nextPart: number;
  entity: pc.Entity;
  gpuMeshes: pc.Mesh[];
  instances: pc.MeshInstance[];
};
type PerformanceSummary = {
  scenarioId: string;
  frame: ReturnType<PerformanceTelemetry['frameSummary']>;
  chunkVisible: ReturnType<PerformanceTelemetry['traceSummary']>;
  completedChunkTraces: number;
  traceEventCount: number;
  maxMeshCommitsInFrame: number;
  maxMeshPartsInFrame: number;
  visibleAfterPostrender: boolean;
  incidents: number;
  droppedEvents: number;
  uploadQueueDepth: number;
  estimatedMeshBytes: number;
};

type HarnessSnapshot = {
  frameMs: number;
  player: [number, number, number];
  loadedChunks: number;
  renderedChunks: number;
  streamCenter: [number, number];
  generationQueue: number;
  meshingQueue: number;
  deferredRemeshes: number;
  onGround: boolean;
  colliding: boolean;
  interactionAttempts: number;
  mutationCount: number;
  worldRevision: number;
  structuralEventCount: number;
  remeshSchedulingCount: number;
  lastCommitMutationCount: number;
  lastCommitMeshChunkCount: number;
  storageBytes: number;
  worldTime: number;
  timePaused: boolean;
  quality: QualityLevel;
  triangles: number;
  drawCalls: number;
  runtime: 'integrated-server';
  serverRevision: number;
  voxelAtOrigin: number;
  serverPlayerPosition: [number, number, number];
  serverWorldTime: number;
  performance: PerformanceSummary;
};

type RestoredSession = {
  player: [number, number, number];
  seed: string;
  persistence: BrowserChunkPersistence;
  changes: Change[];
};

declare global {
  interface Window {
    __seedlandsHarness?: {
      snapshot: () => HarnessSnapshot;
      moveTo: (x: number, z: number) => void;
      burstEdits: () => void;
      fillWorld: (command: FillCommand) => void;
      removeVoxelAt: (x: number, y: number, z: number) => void;
      movePlayerTo: (x: number, y: number, z: number) => void;
      prepareFlatMovement: () => void;
      prepareCenterExcavation: () => void;
      prepareStepDown: () => void;
      setWorldTime: (hour: number) => void;
      setTimePaused: (paused: boolean) => void;
      setTimeSpeed: (speed: number) => void;
      setView: (yaw: number, pitch: number) => void;
      setSpectatorPosition: (x: number, y: number, z: number) => void;
      beginPerformanceScenario: (name: string) => string;
      setStreamingVariant: (variant: StreamingVariant) => void;
      exportPerformanceTrace: () => ReturnType<PerformanceTelemetry['exportChromeTrace']>;
    };
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const startCard = document.querySelector<HTMLElement>('#start-card')!;
const seedInput = document.querySelector<HTMLInputElement>('#seed')!;
const enterButton = document.querySelector<HTMLButtonElement>('#enter')!;
const hud = document.querySelector<HTMLElement>('#hud')!;
const debug = document.querySelector<HTMLElement>('#debug')!;
const hotbar = document.querySelector<HTMLElement>('#hotbar')!;
const worldClock = document.querySelector<HTMLElement>('#world-clock')!;
const interactionFeedback = document.querySelector<HTMLElement>('#interaction-feedback')!;
const qualitySelect = document.querySelector<HTMLSelectElement>('#quality')!;
const mapToggle = document.querySelector<HTMLButtonElement>('#map-toggle')!;
const mapPanel = document.querySelector<HTMLElement>('#macro-map-panel')!;
const mapClose = document.querySelector<HTMLButtonElement>('#map-close')!;
const mapLayer = document.querySelector<HTMLSelectElement>('#map-layer')!;
const mapCanvas = document.querySelector<HTMLCanvasElement>('#macro-map')!;
const PLAYER_HALF_WIDTH = 0.32;
const PLAYER_FEET_OFFSET = 1.6;
const PLAYER_HEAD_OFFSET = 0.2;
const COLLISION_EPSILON = 0.001;

type MapLayer = 'elevation' | 'biome' | 'temperature' | 'humidity' | 'hydrology';

class MacroMapViewer {
  private readonly context = mapCanvas.getContext('2d')!;
  private seed = 0;
  private renderId = 0;
  private active = false;
  private player: readonly [number, number] = [0, 0];
  constructor() {
    mapLayer.onchange = () => this.active && this.render();
  }
  open(seed: number, player: readonly [number, number]) {
    this.seed = seed;
    this.player = player;
    this.active = true;
    mapPanel.hidden = false;
    this.render();
  }
  close() {
    this.active = false;
    this.renderId += 1;
    mapPanel.hidden = true;
  }
  get isOpen() {
    return this.active;
  }
  private render() {
    const id = ++this.renderId;
    const size = mapCanvas.width;
    const image = this.context.createImageData(size, size);
    mapPanel.dataset.status = 'sampling';
    const layer = mapLayer.value as MapLayer;
    let index = 0;
    const paint = () => {
      if (!this.active || this.renderId !== id) return;
      const deadline = performance.now() + 4;
      while (index < size * size && performance.now() < deadline) {
        const px = index % size,
          pz = Math.floor(index / size);
        const context = macroAt(this.seed, (px - size / 2) * 24, (pz - size / 2) * 24);
        const [r, g, b] = this.color(
          context.biome,
          context.terrainHeight,
          context.temperature,
          context.humidity,
          context.hydrology.kind,
          context.hydrology.water,
          layer,
        );
        const offset = index * 4;
        image.data[offset] = r;
        image.data[offset + 1] = g;
        image.data[offset + 2] = b;
        image.data[offset + 3] = 255;
        index += 1;
      }
      this.context.putImageData(image, 0, 0);
      if (index < size * size) requestAnimationFrame(paint);
      else {
        this.paintPlayer();
        mapPanel.dataset.status = 'ready';
      }
    };
    requestAnimationFrame(paint);
  }
  private paintPlayer() {
    const size = mapCanvas.width;
    const x = Math.round(this.player[0] / 24 + size / 2),
      z = Math.round(this.player[1] / 24 + size / 2);
    if (x < 0 || z < 0 || x >= size || z >= size) return;
    this.context.fillStyle = '#fff';
    this.context.fillRect(x - 1, z - 1, 3, 3);
    this.context.strokeStyle = '#07101a';
    this.context.strokeRect(x - 2, z - 2, 5, 5);
  }
  private color(
    biome: MacroBiome,
    elevation: number,
    temperature: number,
    humidity: number,
    hydrology: string,
    water: boolean,
    layer: MapLayer,
  ): [number, number, number] {
    if (layer === 'biome')
      return (
        {
          plains: [86, 154, 82],
          forest: [30, 106, 55],
          mountain: [112, 118, 122],
          dry: [196, 161, 89],
          cold: [215, 231, 239],
          wet: [47, 137, 91],
        } as Record<MacroBiome, [number, number, number]>
      )[biome];
    if (layer === 'temperature')
      return [
        Math.round(52 + temperature * 203),
        Math.round(112 + (1 - temperature) * 105),
        Math.round(220 - temperature * 170),
      ];
    if (layer === 'humidity')
      return [Math.round(175 - humidity * 130), Math.round(92 + humidity * 132), Math.round(54 + humidity * 138)];
    if (layer === 'hydrology')
      return water
        ? hydrology === 'lake'
          ? [48, 131, 213]
          : [75, 177, 229]
        : hydrology !== 'dry'
          ? [53, 103, 122]
          : [32, 50, 42];
    if (water) return [56, 132, 194];
    const light = Math.round(Math.max(0, Math.min(1, (elevation - 8) / 32)) * 170 + 42);
    return [Math.round(light * 0.72), Math.round(light * 0.9), Math.round(light * 0.62)];
  }
}

const macroMapViewer = new MacroMapViewer();

class Store {
  private key = 'seedlands-world-v2';
  load(): RestoredSession | null {
    const raw = localStorage.getItem(this.key);
    const current = decodeBrowserWorldSave(raw);
    if (current)
      return {
        player: current.player,
        seed: current.seed,
        persistence: new BrowserChunkPersistence(current.snapshots),
        changes: [] as Change[],
      };
    const legacy = decodeWorldSave(raw);
    return legacy
      ? {
          player: legacy.player,
          seed: legacy.seed,
          persistence: new BrowserChunkPersistence(),
          changes: legacy.changes,
        }
      : null;
  }
  save(seed: string, player: pc.Vec3, persistence: BrowserChunkPersistence) {
    localStorage.setItem(this.key, JSON.stringify(persistence.serialize(seed, [player.x, player.y, player.z])));
  }
}

class World {
  readonly chunks = new Map<string, Chunk>();
  readonly requested = new Set<string>();
  private readonly worker = new Worker(new URL('../worker/world-worker.ts', import.meta.url), { type: 'module' });
  private readonly queued = new Map<string, PendingMeshRequest>();
  private readonly latestTasks = new Map<string, PendingMeshTask>();
  private readonly commitQueue: MeshCommitJob[] = [];
  private readonly dirtyChunks = new Set<string>();
  private remeshTimer: number | null = null;
  private aggregateStructuralEventCount = 0;
  private aggregateRemeshSchedulingCount = 0;
  private latestCommitMutationCount = 0;
  private latestCommitMeshChunkCount = 0;
  private taskSequence = 0;
  private inFlight = 0;
  private scenarioSequence = 0;
  private scenarioId = 'default';
  private scenarioEpoch = 0;
  private readonly scenarioTraceIds = new Set<string>();
  private frameCommits = 0;
  private frameParts = 0;
  private maxMeshCommitsInFrame = 0;
  private maxMeshPartsInFrame = 0;
  private visibleAfterPostrender = false;
  private lastCenter = '';
  private streamingVariant: StreamingVariant;
  constructor(
    readonly server: GameServer,
    private readonly app: pc.Application,
    private readonly materials: Map<number, pc.StandardMaterial>,
    private readonly quality: QualityProfile,
    private readonly telemetryRecorder: PerformanceTelemetry,
    private readonly profile: PerformanceProfile,
    streamingVariant: StreamingVariant,
  ) {
    this.streamingVariant = streamingVariant;
    this.worker.onmessage = (event: MessageEvent<WorkerResult>) => this.receiveWorker(event.data);
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
  get transactionDiagnostics() {
    return {
      worldRevision: this.server.worldRevision,
      structuralEventCount: this.aggregateStructuralEventCount,
      remeshSchedulingCount: this.aggregateRemeshSchedulingCount,
      lastCommitMutationCount: this.latestCommitMutationCount,
      lastCommitMeshChunkCount: this.latestCommitMeshChunkCount,
    };
  }
  get queueSize() {
    return this.queued.size + this.commitQueue.length;
  }
  get streamCenter(): [number, number] {
    const [x, z] = this.lastCenter.split(',').map(Number);
    return [x || 0, z || 0];
  }
  get telemetry() {
    const chunks = [...this.chunks.values()];
    const meshBytes = chunks.reduce((sum, chunk) => sum + chunk.meshBytes, 0);
    this.telemetryRecorder.gauge('loaded_chunks', chunks.length);
    this.telemetryRecorder.gauge('visible_chunks', chunks.length);
    this.telemetryRecorder.gauge('generation_queue_depth', this.queued.size);
    this.telemetryRecorder.gauge('meshing_queue_depth', this.inFlight);
    this.telemetryRecorder.gauge('upload_queue_depth', this.commitQueue.length);
    this.telemetryRecorder.gauge('mesh_cpu_bytes', meshBytes);
    return {
      loadedChunks: chunks.length,
      renderedChunks: chunks.length,
      generationQueue: this.queued.size,
      meshingQueue: this.inFlight,
      uploadQueue: this.commitQueue.length,
      deferredRemeshes: this.dirtyChunks.size,
      triangles: chunks.reduce((sum, chunk) => sum + chunk.triangles, 0),
      drawCalls: chunks.reduce((sum, chunk) => sum + chunk.drawCalls, 0),
      meshBytes,
    };
  }
  get performanceSummary(): PerformanceSummary {
    const snapshot = this.telemetryRecorder.snapshot();
    return {
      scenarioId: this.scenarioId,
      frame: this.telemetryRecorder.frameSummary(),
      chunkVisible: this.telemetryRecorder.traceSummaryFor(this.scenarioTraceIds),
      completedChunkTraces: [...this.scenarioTraceIds].filter(
        (traceId) => this.telemetryRecorder.trace(traceId)?.complete,
      ).length,
      traceEventCount: [...this.scenarioTraceIds].reduce(
        (count, traceId) => count + (this.telemetryRecorder.trace(traceId)?.marks.length ?? 0),
        0,
      ),
      maxMeshCommitsInFrame: this.maxMeshCommitsInFrame,
      maxMeshPartsInFrame: this.maxMeshPartsInFrame,
      visibleAfterPostrender: this.visibleAfterPostrender,
      incidents: this.telemetryRecorder.incidents().length,
      droppedEvents: snapshot.droppedEvents,
      uploadQueueDepth: this.commitQueue.length,
      estimatedMeshBytes: this.telemetry.meshBytes,
    };
  }
  beginFrame() {
    this.frameCommits = 0;
    this.frameParts = 0;
  }
  beginScenario(name: string): string {
    this.telemetryRecorder.reset();
    this.scenarioEpoch += 1;
    this.scenarioId = `${name}-${++this.scenarioSequence}`;
    this.queued.clear();
    this.latestTasks.clear();
    this.requested.clear();
    this.commitQueue.splice(0).forEach((job) => this.destroyCommitJob(job));
    this.lastCenter = '';
    this.scenarioTraceIds.clear();
    this.maxMeshCommitsInFrame = 0;
    this.maxMeshPartsInFrame = 0;
    this.visibleAfterPostrender = false;
    this.telemetryRecorder.counter('scenario_epoch', this.scenarioEpoch);
    return this.scenarioId;
  }
  setStreamingVariant(variant: StreamingVariant) {
    if (this.streamingVariant === variant) return;
    this.streamingVariant = variant;
    this.beginScenario(`variant-${variant}`);
    this.chunks.forEach((chunk) => this.destroyChunk(chunk));
    this.chunks.clear();
  }
  exportTrace() {
    return this.telemetryRecorder.exportChromeTrace();
  }
  restoreLegacyChanges(changes: Change[]) {
    if (!changes.length) return;
    this.applyCommit(
      this.server.editBatch({
        actorId: 'legacy-storage-migration',
        edits: changes.map(([x, y, z, value]) => ({ x, y, z, value })),
      }),
    );
  }
  dispose() {
    if (this.remeshTimer !== null) window.clearTimeout(this.remeshTimer);
    this.worker.terminate();
    this.chunks.forEach((chunk) => this.destroyChunk(chunk));
    this.commitQueue.forEach((job) => this.destroyCommitJob(job));
    this.chunks.clear();
    this.requested.clear();
    this.queued.clear();
    this.latestTasks.clear();
    this.commitQueue.length = 0;
    this.dirtyChunks.clear();
    this.remeshTimer = null;
  }
  getVoxel(x: number, y: number, z: number): number {
    return this.server.getVoxel(x, y, z);
  }
  updateStreaming(position: pc.Vec3) {
    const cx = floorDiv(position.x, CHUNK_SIZE);
    const cz = floorDiv(position.z, CHUNK_SIZE);
    const center = `${cx},${cz}`;
    if (center === this.lastCenter && this.chunks.size) return;
    this.lastCenter = center;
    const streamingSpan = this.telemetryRecorder.beginSpan('streaming', 'DetermineNeededChunks');
    const needs: [number, number, number, number][] = [];
    for (let y = 0; y <= 1; y += 1)
      for (let z = cz - this.quality.renderRadius; z <= cz + this.quality.renderRadius; z += 1)
        for (let x = cx - this.quality.renderRadius; x <= cx + this.quality.renderRadius; x += 1) {
          const distance = Math.abs(x - cx) + Math.abs(z - cz);
          needs.push([x, y, z, distance]);
        }
    needs.sort((left, right) => left[3] - right[3]);
    for (const [x, y, z] of needs) this.request(x, y, z);
    const cacheRadius = this.quality.renderRadius + 1;
    for (const [key, chunk] of this.chunks)
      if (Math.abs(chunk.cx - cx) > cacheRadius || Math.abs(chunk.cz - cz) > cacheRadius) this.unload(key, chunk);
    for (const key of this.requested) {
      const [x, , z] = key.split(',').map(Number);
      if (Math.abs(x - cx) > cacheRadius || Math.abs(z - cz) > cacheRadius) this.cancel(key);
    }
    this.telemetryRecorder.endSpan(streamingSpan);
    this.drainWorker();
  }
  edit(x: number, y: number, z: number, value: number) {
    this.applyCommit(this.server.edit(x, y, z, value));
  }
  editBatch(batch: WorldEditBatch) {
    const result = this.server.editBatch(batch);
    this.applyCommit(result);
    return result;
  }
  fill(actorId: string, command: FillCommand) {
    return this.editBatch({ actorId, buffers: [resolveFillCommand(command)] });
  }
  private applyCommit(result: WorldCommitResult) {
    const change = result.structuralChange;
    if (!change) return;
    this.aggregateStructuralEventCount += 1;
    this.latestCommitMutationCount = change.mutationCount;
    this.latestCommitMeshChunkCount = change.meshChunks.length;
    let hasPresentationWork = false;
    change.meshChunks.forEach((key) => {
      const pending = this.latestTasks.get(key);
      if (pending) {
        hasPresentationWork = true;
        this.cancel(key);
        this.request(pending.cx, pending.cy, pending.cz, true);
      } else if (this.chunks.has(key)) {
        hasPresentationWork = true;
        this.dirtyChunks.add(key);
      }
    });
    if (hasPresentationWork) this.aggregateRemeshSchedulingCount += 1;
    this.scheduleRemesh();
  }
  drainCommits() {
    const startedAt = performance.now();
    while (
      this.commitQueue.length &&
      this.frameCommits < this.profile.maxMeshCommitsPerFrame &&
      this.frameParts < this.profile.maxMeshPartsPerFrame &&
      performance.now() - startedAt < this.profile.maxCommitMs
    ) {
      const job = this.commitQueue[0];
      if (!this.isTaskCurrent(job.task)) {
        this.commitQueue.shift();
        this.discard(job, 'stale-result');
        continue;
      }
      const part = job.meshes[job.nextPart];
      if (!part) {
        this.commitQueue.shift();
        this.attachAfterCommit(job);
        continue;
      }
      const span = this.telemetryRecorder.beginSpan('render', 'MeshCommit', 'main', job.task.traceId);
      const mesh = new pc.Mesh(this.app.graphicsDevice);
      mesh.setPositions(part.positions);
      mesh.setNormals(part.normals);
      mesh.setUvs(0, part.uvs);
      mesh.setColors32(part.colors);
      mesh.setIndices(part.indices);
      mesh.update();
      const instance = new pc.MeshInstance(mesh, this.materials.get(part.material)!, job.entity);
      if (part.renderLayer === 'water') {
        instance.drawOrder = 1000;
        instance.castShadow = false;
      }
      job.gpuMeshes.push(mesh);
      job.instances.push(instance);
      job.nextPart += 1;
      this.frameParts += 1;
      this.telemetryRecorder.endSpan(span);
      this.telemetryRecorder.markTrace(job.task.traceId, 'mesh-part-commit', 'main');
    }
    this.maxMeshCommitsInFrame = Math.max(this.maxMeshCommitsInFrame, this.frameCommits);
    this.maxMeshPartsInFrame = Math.max(this.maxMeshPartsInFrame, this.frameParts);
  }
  private request(cx: number, cy: number, cz: number, forceRemesh = false) {
    if (cy < 0 || cy > 1) return;
    const key = chunkKey(cx, cy, cz);
    if (!forceRemesh && (this.chunks.has(key) || this.requested.has(key))) return;
    const traceId = this.telemetryRecorder.beginTrace('chunk-request', key, 'main');
    this.scenarioTraceIds.add(traceId);
    this.requested.add(key);
    this.latestTasks.delete(key);
    this.queued.delete(key);
    this.queued.set(key, {
      traceId,
      epoch: this.scenarioEpoch,
      chunkKey: key,
      cx,
      cy,
      cz,
      queuedAt: performance.now(),
    });
    this.telemetryRecorder.markTrace(traceId, 'queued', 'main');
    this.drainWorker();
  }
  private drainWorker() {
    while (this.inFlight < this.profile.maxWorkerTasksInFlight) {
      const next = this.queued.entries().next().value as [string, PendingMeshRequest] | undefined;
      if (!next) return;
      const [key, request] = next;
      this.queued.delete(key);
      if (!this.requested.has(key) || request.epoch !== this.scenarioEpoch) {
        this.telemetryRecorder.markTrace(request.traceId, 'stale-request', 'main');
        continue;
      }
      this.telemetryRecorder.recordCompletedSpan({
        category: 'worker',
        name: 'WorkerQueueWait',
        lane: 'main',
        durationMs: performance.now() - request.queuedAt,
        traceId: request.traceId,
      });
      if (this.streamingVariant === 'main-snapshot') {
        const snapshotSpan = this.telemetryRecorder.beginSpan('streaming', 'HaloSnapshot', 'main', request.traceId);
        const snapshot = this.server.createDerivedMeshSnapshot(request.cx, request.cy, request.cz);
        this.telemetryRecorder.endSpan(snapshotSpan);
        const snapshotTask = createMeshTaskSnapshot({
          taskId: ++this.taskSequence,
          epoch: request.epoch,
          chunkKey: key,
          chunkRevision: snapshot.chunkRevision,
          haloRevision: snapshot.haloRevision,
          canonical: snapshot.canonical,
          halo: snapshot.halo,
        });
        const task: PendingMeshTask = {
          ...snapshotTask,
          traceId: request.traceId,
          seed: this.seed,
          cx: request.cx,
          cy: request.cy,
          cz: request.cz,
          generatorVersion: GENERATOR_VERSION,
          variant: 'main-snapshot',
        };
        this.latestTasks.set(key, task);
        this.inFlight += 1;
        this.telemetryRecorder.markTrace(task.traceId, 'worker-start', 'worker-derived');
        this.worker.postMessage(
          {
            kind: 'mesh',
            taskId: task.taskId,
            traceId: task.traceId,
            epoch: task.epoch,
            chunkKey: task.chunkKey,
            seed: task.seed,
            cx: task.cx,
            cy: task.cy,
            cz: task.cz,
            chunkRevision: task.chunkRevision,
            haloRevision: task.haloRevision,
            canonical: snapshotTask.canonical.buffer,
            halo: snapshotTask.halo.buffer,
          },
          [snapshotTask.canonical.buffer, snapshotTask.halo.buffer],
        );
        continue;
      }
      const overlaySpan = this.telemetryRecorder.beginSpan(
        'streaming',
        'AuthorityOverlayCopy',
        'main',
        request.traceId,
      );
      const prepared = this.server.prepareWorkerMeshInput(request.cx, request.cy, request.cz);
      this.telemetryRecorder.endSpan(overlaySpan);
      const task: PendingMeshTask = {
        taskId: ++this.taskSequence,
        epoch: request.epoch,
        chunkKey: key,
        chunkRevision: prepared.chunkRevision,
        haloRevision: `worker-input-${this.taskSequence}`,
        traceId: request.traceId,
        seed: this.seed,
        cx: request.cx,
        cy: request.cy,
        cz: request.cz,
        generatorVersion: prepared.generatorVersion,
        variant: 'worker-first',
      };
      this.latestTasks.set(key, task);
      this.inFlight += 1;
      this.telemetryRecorder.markTrace(task.traceId, 'worker-start', 'worker-derived');
      const transfers: Transferable[] = [];
      if (prepared.canonical) transfers.push(prepared.canonical.buffer);
      prepared.overlays.forEach((overlay) => transfers.push(overlay.voxels.buffer));
      this.worker.postMessage(
        {
          kind: 'generate-mesh',
          taskId: task.taskId,
          traceId: task.traceId,
          epoch: task.epoch,
          chunkKey: task.chunkKey,
          seed: task.seed,
          cx: task.cx,
          cy: task.cy,
          cz: task.cz,
          chunkRevision: task.chunkRevision,
          haloRevision: task.haloRevision,
          generatorVersion: task.generatorVersion,
          ...(prepared.canonical ? { canonical: prepared.canonical.buffer } : {}),
          overlays: prepared.overlays.map((overlay) => ({
            cx: overlay.cx,
            cy: overlay.cy,
            cz: overlay.cz,
            voxels: overlay.voxels.buffer,
          })),
        },
        transfers,
      );
    }
  }
  private receiveWorker(result: WorkerResult) {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const task = this.latestTasks.get(result.chunkKey);
    if (!task || !isCurrentMeshTask(result, task)) {
      this.telemetryRecorder.counter(
        'stale_worker_results',
        (this.telemetryRecorder.snapshot().gauges.stale_worker_results ?? 0) + 1,
      );
      this.drainWorker();
      return;
    }
    if (task.variant === 'worker-first') {
      if (!result.canonical || result.generatorVersion !== task.generatorVersion) {
        this.discard(task, 'invalid-worker-canonical');
        this.drainWorker();
        return;
      }
      const accepted = this.server.acceptWorkerCanonical({
        key: task.chunkKey,
        cx: task.cx,
        cy: task.cy,
        cz: task.cz,
        chunkRevision: task.chunkRevision,
        generatorVersion: task.generatorVersion,
        canonical: new Uint16Array(result.canonical),
      });
      if (!accepted) {
        this.discard(task, 'stale-worker-canonical');
        this.drainWorker();
        return;
      }
      if (result.workerGenerationMs !== undefined)
        this.telemetryRecorder.recordCompletedSpan({
          category: 'worldgen',
          name: 'WorkerGeneration',
          lane: 'worker-derived',
          durationMs: result.workerGenerationMs,
          traceId: task.traceId,
        });
      if (result.workerHaloMs !== undefined)
        this.telemetryRecorder.recordCompletedSpan({
          category: 'streaming',
          name: 'WorkerHaloSample',
          lane: 'worker-derived',
          durationMs: result.workerHaloMs,
          traceId: task.traceId,
        });
    }
    this.telemetryRecorder.recordCompletedSpan({
      category: 'meshing',
      name: 'WorkerMesh',
      lane: 'worker-derived',
      durationMs: result.workerMeshingMs,
      traceId: task.traceId,
    });
    this.telemetryRecorder.markTrace(task.traceId, 'worker-complete', 'worker-derived');
    this.commitQueue.push({
      task,
      meshes: result.meshes,
      nextPart: 0,
      entity: new pc.Entity(`Chunk ${result.chunkKey}`),
      gpuMeshes: [],
      instances: [],
    });
    this.telemetryRecorder.markTrace(task.traceId, 'commit-queued', 'main');
    this.drainWorker();
  }
  private attachAfterCommit(job: MeshCommitJob) {
    if (!this.isTaskCurrent(job.task)) {
      this.discard(job, 'stale-result');
      return;
    }
    const span = this.telemetryRecorder.beginSpan('render', 'SceneAttach', 'main', job.task.traceId);
    job.entity.addComponent('render');
    job.entity.render!.meshInstances = job.instances;
    job.entity.setPosition(job.task.cx * CHUNK_SIZE, job.task.cy * CHUNK_SIZE, job.task.cz * CHUNK_SIZE);
    this.app.root.addChild(job.entity);
    this.frameCommits += 1;
    this.maxMeshCommitsInFrame = Math.max(this.maxMeshCommitsInFrame, this.frameCommits);
    this.telemetryRecorder.endSpan(span);
    this.telemetryRecorder.markTrace(job.task.traceId, 'scene-attached', 'main');
    this.app.once('postrender', () => {
      if (!this.isTaskCurrent(job.task)) {
        this.discard(job, 'stale-result');
        return;
      }
      const previous = this.chunks.get(job.task.chunkKey);
      if (previous) this.destroyChunk(previous);
      const meshBytes = job.meshes.reduce(
        (sum, part) =>
          sum +
          part.positions.byteLength +
          part.normals.byteLength +
          part.uvs.byteLength +
          part.colors.byteLength +
          part.indices.byteLength,
        0,
      );
      this.chunks.set(job.task.chunkKey, {
        cx: job.task.cx,
        cy: job.task.cy,
        cz: job.task.cz,
        entity: job.entity,
        meshes: job.gpuMeshes,
        triangles: job.meshes.reduce((sum, part) => sum + part.indices.length / 3, 0),
        drawCalls: job.meshes.length,
        meshBytes,
      });
      this.requested.delete(job.task.chunkKey);
      this.latestTasks.delete(job.task.chunkKey);
      this.visibleAfterPostrender = true;
      this.telemetryRecorder.completeTrace(job.task.traceId, 'visible-postrender', 'main');
    });
  }
  private isTaskCurrent(task: MeshTaskIdentity & { chunkKey: string }) {
    const current = this.latestTasks.get(task.chunkKey);
    return current ? isCurrentMeshTask(task, current) : false;
  }
  private unload(key: string, chunk: Chunk) {
    this.cancel(key);
    this.destroyChunk(chunk);
    this.chunks.delete(key);
  }
  private cancel(key: string) {
    const task = this.latestTasks.get(key);
    if (task) this.telemetryRecorder.markTrace(task.traceId, 'cancelled', 'main');
    this.latestTasks.delete(key);
    this.requested.delete(key);
    this.queued.delete(key);
    this.dirtyChunks.delete(key);
  }
  private discard(value: MeshCommitJob | PendingMeshTask, counter: string) {
    const task = 'task' in value ? value.task : value;
    if ('gpuMeshes' in value) this.destroyCommitJob(value);
    this.telemetryRecorder.markTrace(task.traceId, counter, 'main');
    this.telemetryRecorder.counter(counter, (this.telemetryRecorder.snapshot().gauges[counter] ?? 0) + 1);
  }
  private destroyCommitJob(job: MeshCommitJob) {
    job.gpuMeshes.forEach((mesh) => mesh.destroy());
    job.entity.destroy();
  }
  private destroyChunk(chunk: Chunk) {
    chunk.meshes.forEach((mesh) => mesh.destroy());
    chunk.entity.destroy();
  }
  private scheduleRemesh() {
    if (this.remeshTimer !== null || this.dirtyChunks.size === 0) return;
    this.remeshTimer = window.setTimeout(() => {
      this.remeshTimer = null;
      const keys = [...this.dirtyChunks];
      this.dirtyChunks.clear();
      for (const key of keys) {
        const chunk = this.chunks.get(key);
        if (chunk) this.request(chunk.cx, chunk.cy, chunk.cz, true);
      }
    }, 48);
  }
}

class Game {
  private app: pc.Application | null = null;
  private world: World | null = null;
  private environment: WorldEnvironment | null = null;
  private visualResources: VoxelMaterials | null = null;
  private camera!: pc.Entity;
  private velocity = new pc.Vec3();
  private yaw = 0;
  private pitch = -16;
  private onGround = false;
  private chosen: number = Voxel.Dirt;
  private keys = new Set<string>();
  private last = performance.now();
  private frames = 0;
  private fps = 0;
  private frameMs = 0;
  private lastFrameTimestamp = performance.now();
  private performanceProfile: PerformanceProfile = PERFORMANCE_PROFILES.balanced;
  private performanceTelemetry = new PerformanceTelemetry({ now: () => performance.now() });
  private interactionAttempts = 0;
  private harnessSpectator = false;
  private store = new Store();
  private persistence = new BrowserChunkPersistence();
  private serverPlayerId: string | null = null;
  private seedText = '';
  private qualityLevel: QualityLevel = 'medium';
  private saveTimer: number | null = null;
  private feedbackTimer: number | null = null;
  private onResize = () => this.app?.resizeCanvas();
  async start(seedText: string, restore: RestoredSession | null) {
    this.flushSave();
    this.seedText = seedText;
    this.qualityLevel = qualitySelect.value as QualityLevel;
    const quality = QUALITY_PROFILES[this.qualityLevel];
    const profileName = new URLSearchParams(location.search).get('performanceProfile');
    this.performanceProfile =
      profileName === 'diagnostic' || profileName === 'benchmark' || profileName === 'balanced'
        ? PERFORMANCE_PROFILES[profileName]
        : new URLSearchParams(location.search).has('harness')
          ? PERFORMANCE_PROFILES.benchmark
          : PERFORMANCE_PROFILES.balanced;
    this.performanceTelemetry = new PerformanceTelemetry({
      now: () => performance.now(),
      frameCapacity: this.performanceProfile.ringBufferFrames,
      eventCapacity: this.performanceProfile.ringBufferEvents,
      incidentThresholdMs: this.performanceProfile.longFrameMs,
      chunkLatencyIncidentMs: this.performanceProfile.chunkLatencyIncidentMs,
    });
    this.lastFrameTimestamp = performance.now();
    macroMapViewer.close();
    this.world?.dispose();
    this.world = null;
    this.environment = null;
    this.visualResources?.destroy();
    this.visualResources = null;
    this.app?.destroy();
    this.velocity.set(0, 0, 0);
    this.keys.clear();
    this.onGround = false;
    this.harnessSpectator = false;
    this.persistence = restore?.seed === seedText ? restore.persistence : new BrowserChunkPersistence();
    this.app = new pc.Application(canvas, {
      mouse: new pc.Mouse(canvas),
      keyboard: new pc.Keyboard(window),
      graphicsDeviceOptions: { alpha: true },
    });
    this.app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    this.app.setCanvasResolution(pc.RESOLUTION_AUTO);
    this.app.start();
    const light = new pc.Entity('Sun');
    light.addComponent('light', {
      type: 'directional',
      color: new pc.Color(1, 0.9, 0.72),
      intensity: 1,
      castShadows: quality.shadowQuality !== 'off',
      shadowResolution: 512,
    });
    this.app.root.addChild(light);
    this.camera = new pc.Entity('Player');
    this.camera.addComponent('camera', {
      clearColor: new pc.Color(0, 0, 0, 0),
      fov: 72,
      nearClip: 0.05,
      farClip: quality.fogEnd + 18,
    });
    this.app.root.addChild(this.camera);
    this.visualResources = await createVoxelMaterials(this.app, quality);
    this.environment = new WorldEnvironment(this.app, light, quality, this.visualResources.water);
    const server = new GameServer({ seedText, persistence: this.persistence });
    server.setWorldTime(this.environment.worldTime);
    const requestedVariant = new URLSearchParams(location.search).get('streamingVariant');
    this.world = new World(
      server,
      this.app,
      this.visualResources.materials,
      quality,
      this.performanceTelemetry,
      this.performanceProfile,
      requestedVariant === 'main-snapshot' ? 'main-snapshot' : 'worker-first',
    );
    if (restore?.changes.length) this.world.restoreLegacyChanges(restore.changes);
    const p = restore?.player ?? [0, 34, 0];
    this.camera.setPosition(...p);
    this.serverPlayerId = server.createEntity({ kind: 'player', position: p }).id;
    this.world.updateStreaming(this.camera.getPosition());
    this.installInput();
    mapToggle.onclick = () => this.toggleMap();
    mapClose.onclick = () => macroMapViewer.close();
    this.renderHotbar();
    debug.hidden = !new URLSearchParams(location.search).has('harness');
    this.app.on('update', (dt: number) => this.update(Math.min(dt, 0.05)));
    window.addEventListener('resize', this.onResize);
    window.onpagehide = () => this.flushSave();
    if (new URLSearchParams(location.search).has('harness')) {
      window.__seedlandsHarness = {
        snapshot: () => this.harnessSnapshot(),
        moveTo: (x, z) => this.moveHarnessPlayer(x, z),
        burstEdits: () => this.burstHarnessEdits(),
        fillWorld: (command) => this.world?.fill('harness-fill', command),
        removeVoxelAt: (x, y, z) => this.removeVoxelForHarness(x, y, z),
        movePlayerTo: (x, y, z) => this.movePlayerForHarness(x, y, z),
        prepareFlatMovement: () => this.prepareFlatMovementFixture(),
        prepareCenterExcavation: () => this.prepareCenterExcavationFixture(),
        prepareStepDown: () => this.prepareStepDownFixture(),
        setWorldTime: (hour) => {
          if (!this.world || !this.environment) return;
          this.world.server.setWorldTime(hour);
          this.environment.setTime(this.world.server.worldTime);
        },
        setTimePaused: (paused) => this.environment?.setPaused(paused),
        setTimeSpeed: (speed) => {
          if (this.environment) this.environment.speed = Math.max(0, speed);
        },
        setView: (yaw, pitch) => {
          this.yaw = yaw;
          this.pitch = Math.max(-88, Math.min(88, pitch));
          this.camera.setEulerAngles(this.pitch, this.yaw, 0);
        },
        setSpectatorPosition: (x, y, z) => {
          this.harnessSpectator = true;
          this.velocity.set(0, 0, 0);
          this.camera.setPosition(x, y, z);
          this.world?.updateStreaming(this.camera.getPosition());
        },
        beginPerformanceScenario: (name) => this.world?.beginScenario(name) ?? '',
        setStreamingVariant: (variant) => this.world?.setStreamingVariant(variant),
        exportPerformanceTrace: () => this.world?.exportTrace() ?? { traceEvents: [] },
      };
    }
  }
  private installInput() {
    window.onkeydown = (event) => {
      if (event.code === 'F3') {
        event.preventDefault();
        debug.hidden = !debug.hidden;
        return;
      }
      if (event.code === 'KeyM') {
        this.toggleMap();
        return;
      }
      if (event.code === 'KeyP') {
        if (this.environment) this.environment.setPaused(!this.environment.paused);
        return;
      }
      if (event.code === 'KeyT') {
        this.environment?.cycleSpeed();
        return;
      }
      if (event.code === 'BracketLeft') {
        if (this.environment && this.world) {
          this.world.server.setWorldTime(this.world.server.worldTime - 1);
          this.environment.setTime(this.world.server.worldTime);
        }
        return;
      }
      if (event.code === 'BracketRight') {
        if (this.environment && this.world) {
          this.world.server.setWorldTime(this.world.server.worldTime + 1);
          this.environment.setTime(this.world.server.worldTime);
        }
        return;
      }
      this.keys.add(event.code);
      if (/^Digit[1-4]$/.test(event.code)) {
        this.chosen = [Voxel.Dirt, Voxel.Stone, Voxel.Wood, Voxel.Sand][Number(event.code[5]) - 1];
        this.renderHotbar();
      }
    };
    window.onkeyup = (event) => this.keys.delete(event.code);
    canvas.oncontextmenu = (event) => event.preventDefault();
    canvas.onclick = () => canvas.requestPointerLock();
    document.onmousemove = (event) => {
      if (document.pointerLockElement === canvas) {
        this.yaw -= event.movementX * 0.13;
        this.pitch = Math.max(-88, Math.min(88, this.pitch - event.movementY * 0.13));
      }
    };
    document.onmousedown = (event) => {
      if (document.pointerLockElement !== canvas) return;
      if (event.button === 0)
        this.performanceTelemetry.withSpan('input', 'PointerInteraction', () => this.interact(false));
      if (event.button === 2)
        this.performanceTelemetry.withSpan('input', 'PointerInteraction', () => this.interact(true));
    };
  }
  private update(dt: number) {
    if (!this.world) return;
    const now = performance.now();
    const actualFrameMs = now - this.lastFrameTimestamp;
    this.lastFrameTimestamp = now;
    this.performanceTelemetry.beginFrame();
    this.world.beginFrame();
    if (this.environment) {
      if (!this.environment.paused) this.world.server.advanceClock(dt * 0.04 * this.environment.speed);
      this.environment.update(dt, this.world.server.worldTime);
    }
    this.frameMs = actualFrameMs;
    this.frames += 1;
    if (now - this.last > 500) {
      this.fps = (this.frames * 1000) / (now - this.last);
      this.frames = 0;
      this.last = now;
    }
    // Let the engine be the sole source of truth for camera orientation and movement axes.
    this.camera.setEulerAngles(this.pitch, this.yaw, 0);
    const playerSpan = this.performanceTelemetry.beginSpan('player', 'PlayerMovement');
    if (!this.harnessSpectator) {
      const forward = new pc.Vec3().copy(this.camera.forward);
      forward.y = 0;
      forward.normalize();
      const right = new pc.Vec3().copy(this.camera.right);
      right.y = 0;
      right.normalize();
      const wish = new pc.Vec3();
      if (this.keys.has('KeyW')) wish.add(forward);
      if (this.keys.has('KeyS')) wish.sub(forward);
      if (this.keys.has('KeyD')) wish.add(right);
      if (this.keys.has('KeyA')) wish.sub(right);
      if (wish.lengthSq() > 0) wish.normalize().mulScalar(5.5);
      this.velocity.x += (wish.x - this.velocity.x) * Math.min(1, dt * 12);
      this.velocity.z += (wish.z - this.velocity.z) * Math.min(1, dt * 12);
      this.velocity.y -= 20 * dt;
      if (this.keys.has('Space') && this.onGround) {
        this.velocity.y = 7.5;
        this.onGround = false;
      }
      this.moveAxis('x', this.velocity.x * dt);
      this.moveAxis('z', this.velocity.z * dt);
      this.onGround = false;
      this.moveAxis('y', this.velocity.y * dt);
    }
    this.performanceTelemetry.endSpan(playerSpan);
    this.world.updateStreaming(this.camera.getPosition());
    this.world.drainCommits();
    if (this.serverPlayerId)
      this.world.server.updateEntity(this.serverPlayerId, {
        position: [this.camera.getPosition().x, this.camera.getPosition().y, this.camera.getPosition().z],
      });
    const feetY = this.camera.getPosition().y - PLAYER_FEET_OFFSET;
    const telemetry = this.world.telemetry;
    const macro = macroAt(this.world.seed, this.camera.getPosition().x, this.camera.getPosition().z);
    const water =
      macro.hydrology.kind === 'dry'
        ? 'dry'
        : `${macro.hydrology.kind}${macro.hydrology.water ? ' water' : ' bank'} (${macro.hydrology.id})`;
    const worldTime = this.world.server.worldTime;
    const hours = Math.floor(worldTime);
    const minutes = Math.floor((worldTime - hours) * 60);
    worldClock.textContent = `${this.environment?.phase ?? 'Day'} · ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    const perfSummary = this.world.performanceSummary;
    const hudSpan = this.performanceTelemetry.beginSpan('hud', 'DebugHud');
    debug.textContent = `FPS  ${this.fps.toFixed(0)} · Frame  ${this.frameMs.toFixed(1)} ms\nBackend  ${this.app?.graphicsDevice.deviceType ?? 'WebGL2'}\nQuality  ${QUALITY_PROFILES[this.qualityLevel].label} · 性能档位  ${this.performanceProfile.name}\n帧分位  p50 ${perfSummary.frame.p50Ms.toFixed(1)} · p95 ${perfSummary.frame.p95Ms.toFixed(1)} · 最近长帧 ${perfSummary.frame.lastLongFrameMs.toFixed(1)} ms\n区块可见 p95  ${perfSummary.chunkVisible.p95Ms.toFixed(1)} ms · Worker 忙碌 ${telemetry.meshingQueue}\n提交预算  ${perfSummary.maxMeshCommitsInFrame} 区块 / ${perfSummary.maxMeshPartsInFrame} 部件 · 上传队列 ${perfSummary.uploadQueueDepth}\n估算网格内存  ${(perfSummary.estimatedMeshBytes / 1024 / 1024).toFixed(1)} MiB · 事件丢弃 ${perfSummary.droppedEvents}\nTime  ${worldTime.toFixed(2)}h ${this.environment?.paused ? '(paused)' : `${this.environment?.speed ?? 1}×`}\nSeed  ${this.seedText}\nGenerator  v${GENERATOR_VERSION}\nPlayer  ${this.camera.getPosition().x.toFixed(1)}, ${feetY.toFixed(1)}, ${this.camera.getPosition().z.toFixed(1)}\nChunk  ${floorDiv(this.camera.getPosition().x, 32)}, ${floorDiv(feetY, 32)}, ${floorDiv(this.camera.getPosition().z, 32)}\nMacro Region  ${macro.region.join(',')} · ${macro.biome}\nElevation  ${macro.terrainHeight} · Relief  ${macro.relief.toFixed(2)}\nTemperature  ${macro.temperature.toFixed(2)} · Humidity  ${macro.humidity.toFixed(2)}\nHydrology  ${water}\nLoaded  ${telemetry.loadedChunks} · Rendered  ${telemetry.renderedChunks}\nGeneration Queue  ${telemetry.generationQueue} · Meshing Queue  ${telemetry.meshingQueue}\nTriangles  ${telemetry.triangles.toLocaleString()} · Draw Calls  ${telemetry.drawCalls}\nDeferred Remeshes  ${telemetry.deferredRemeshes}\nMaterialized Chunks  ${this.world.mutationCount}`;
    this.performanceTelemetry.endSpan(hudSpan);
    this.performanceTelemetry.endFrame(actualFrameMs);
    if (Math.floor(now / 2000) !== Math.floor((now - dt * 1000) / 2000)) this.queueSave();
  }
  private moveAxis(axis: 'x' | 'y' | 'z', amount: number) {
    if (!this.world || amount === 0) return;
    const p = this.camera.getPosition();
    const previousOverlap = axis === 'y' ? 0 : this.collisionOverlap(p);
    (p as unknown as Record<string, number>)[axis] += amount;
    if (axis === 'y') {
      const collisionY =
        amount < 0 ? Math.floor(p.y - PLAYER_FEET_OFFSET) : Math.floor(p.y + PLAYER_HEAD_OFFSET - COLLISION_EPSILON);
      const blocked = amount < 0 ? this.hasGroundSupport(p, collisionY) : this.collidesAtY(p, collisionY);
      if (blocked) {
        p.set(p.x, amount < 0 ? collisionY + 1 + PLAYER_FEET_OFFSET : collisionY - PLAYER_HEAD_OFFSET, p.z);
        if (amount < 0) this.onGround = true;
        this.velocity.y = 0;
        if (amount < 0) this.depenetrateHorizontally(p);
      }
    } else {
      const nextOverlap = this.collisionOverlap(p);
      if (nextOverlap > 0 && nextOverlap >= previousOverlap) (p as unknown as Record<string, number>)[axis] -= amount;
    }
    this.camera.setPosition(p);
  }
  private collides(p: pc.Vec3): boolean {
    return this.collisionOverlap(p) > 0;
  }
  private collisionOverlap(p: pc.Vec3): number {
    if (!this.world) return 0;
    const minX = p.x - PLAYER_HALF_WIDTH;
    const maxX = p.x + PLAYER_HALF_WIDTH;
    const minY = p.y - PLAYER_FEET_OFFSET + COLLISION_EPSILON;
    const maxY = p.y + PLAYER_HEAD_OFFSET - COLLISION_EPSILON;
    const minZ = p.z - PLAYER_HALF_WIDTH;
    const maxZ = p.z + PLAYER_HALF_WIDTH;
    let overlap = 0;
    for (let x = Math.floor(minX); x <= Math.floor(maxX - COLLISION_EPSILON); x += 1) {
      const overlapX = Math.min(maxX, x + 1) - Math.max(minX, x);
      for (let y = Math.floor(minY); y <= Math.floor(maxY - COLLISION_EPSILON); y += 1) {
        const overlapY = Math.min(maxY, y + 1) - Math.max(minY, y);
        for (let z = Math.floor(minZ); z <= Math.floor(maxZ - COLLISION_EPSILON); z += 1) {
          if (isSolid(this.world.getVoxel(x, y, z))) {
            overlap += overlapX * overlapY * (Math.min(maxZ, z + 1) - Math.max(minZ, z));
          }
        }
      }
    }
    return overlap;
  }
  private depenetrateHorizontally(p: pc.Vec3) {
    if (!this.world || this.collisionOverlap(p) === 0) return;
    const minX = p.x - PLAYER_HALF_WIDTH;
    const maxX = p.x + PLAYER_HALF_WIDTH;
    const minY = p.y - PLAYER_FEET_OFFSET + COLLISION_EPSILON;
    const maxY = p.y + PLAYER_HEAD_OFFSET - COLLISION_EPSILON;
    const minZ = p.z - PLAYER_HALF_WIDTH;
    const maxZ = p.z + PLAYER_HALF_WIDTH;
    let left = Infinity;
    let right = -Infinity;
    let backward = Infinity;
    let forward = -Infinity;
    for (let x = Math.floor(minX); x <= Math.floor(maxX - COLLISION_EPSILON); x += 1) {
      for (let y = Math.floor(minY); y <= Math.floor(maxY - COLLISION_EPSILON); y += 1) {
        for (let z = Math.floor(minZ); z <= Math.floor(maxZ - COLLISION_EPSILON); z += 1) {
          if (!isSolid(this.world.getVoxel(x, y, z))) continue;
          left = Math.min(left, x - maxX - COLLISION_EPSILON);
          right = Math.max(right, x + 1 - minX + COLLISION_EPSILON);
          backward = Math.min(backward, z - maxZ - COLLISION_EPSILON);
          forward = Math.max(forward, z + 1 - minZ + COLLISION_EPSILON);
        }
      }
    }
    const candidates: Array<readonly [number, number]> = [
      [left, 0],
      [right, 0],
      [0, backward],
      [0, forward],
    ];
    const resolved = candidates
      .filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z))
      .map(([x, z]) => ({ x, z, distance: Math.abs(x) + Math.abs(z) }))
      .sort((a, b) => a.distance - b.distance)
      .find((candidate) => {
        const resolvedPosition = new pc.Vec3(p.x + candidate.x, p.y, p.z + candidate.z);
        return this.collisionOverlap(resolvedPosition) === 0;
      });
    if (resolved) p.set(p.x + resolved.x, p.y, p.z + resolved.z);
  }
  private collidesAtY(p: pc.Vec3, y: number): boolean {
    if (!this.world) return false;
    for (const x of [p.x - PLAYER_HALF_WIDTH, p.x + PLAYER_HALF_WIDTH])
      for (const z of [p.z - PLAYER_HALF_WIDTH, p.z + PLAYER_HALF_WIDTH])
        if (isSolid(this.world.getVoxel(Math.floor(x), y, Math.floor(z)))) return true;
    return false;
  }
  private hasGroundSupport(p: pc.Vec3, y: number): boolean {
    return !!this.world && isSolid(this.world.getVoxel(Math.floor(p.x), y, Math.floor(p.z)));
  }
  private interact(place: boolean) {
    this.interactionAttempts += 1;
    if (!this.world) return;
    const p = this.camera.getPosition();
    const dir = this.camera.forward;
    let last: [number, number, number] | null = null;
    let hit: [number, number, number] | null = null;
    for (let t = 0.15; t < 7; t += 0.08) {
      const cell: [number, number, number] = [
        Math.floor(p.x + dir.x * t),
        Math.floor(p.y + dir.y * t),
        Math.floor(p.z + dir.z * t),
      ];
      if (isSolid(this.world.getVoxel(...cell))) {
        hit = cell;
        break;
      }
      last = cell;
    }
    const target = place ? last : hit;
    if (!target) {
      this.showInteractionFeedback('距离过远');
      return;
    }
    if (place && this.playerOccupies(target)) {
      this.showInteractionFeedback('无法在玩家位置放置');
      return;
    }
    const previous = this.world.getVoxel(...target);
    this.world.edit(...target, place ? this.chosen : Voxel.Air);
    this.showInteractionFeedback(
      place ? `放置 · ${voxelNames[this.chosen]}` : `采集 · ${voxelNames[previous] ?? '体素'}`,
    );
    this.queueSave();
  }
  private showInteractionFeedback(message: string) {
    interactionFeedback.textContent = message;
    interactionFeedback.dataset.visible = 'true';
    if (this.feedbackTimer !== null) window.clearTimeout(this.feedbackTimer);
    this.feedbackTimer = window.setTimeout(() => {
      interactionFeedback.dataset.visible = 'false';
      this.feedbackTimer = null;
    }, 900);
  }
  private playerOccupies([x, y, z]: [number, number, number]) {
    const p = this.camera.getPosition();
    return (
      x + 1 > p.x - PLAYER_HALF_WIDTH &&
      x < p.x + PLAYER_HALF_WIDTH &&
      z + 1 > p.z - PLAYER_HALF_WIDTH &&
      z < p.z + PLAYER_HALF_WIDTH &&
      y + 1 > p.y - PLAYER_FEET_OFFSET &&
      y < p.y + PLAYER_HEAD_OFFSET
    );
  }
  private toggleMap() {
    if (!this.world) return;
    if (macroMapViewer.isOpen) {
      macroMapViewer.close();
      return;
    }
    const p = this.camera.getPosition();
    macroMapViewer.open(this.world.seed, [p.x, p.z]);
  }
  private harnessSnapshot(): HarnessSnapshot {
    const p = this.camera.getPosition();
    const telemetry = this.world?.telemetry;
    const transactions = this.world?.transactionDiagnostics;
    return {
      frameMs: this.frameMs,
      player: [p.x, p.y, p.z],
      streamCenter: this.world?.streamCenter ?? [0, 0],
      loadedChunks: telemetry?.loadedChunks ?? 0,
      renderedChunks: telemetry?.renderedChunks ?? 0,
      generationQueue: telemetry?.generationQueue ?? 0,
      meshingQueue: telemetry?.meshingQueue ?? 0,
      deferredRemeshes: telemetry?.deferredRemeshes ?? 0,
      onGround: this.onGround,
      colliding: this.collides(p),
      interactionAttempts: this.interactionAttempts,
      mutationCount: this.world?.mutationCount ?? 0,
      worldRevision: transactions?.worldRevision ?? 0,
      structuralEventCount: transactions?.structuralEventCount ?? 0,
      remeshSchedulingCount: transactions?.remeshSchedulingCount ?? 0,
      lastCommitMutationCount: transactions?.lastCommitMutationCount ?? 0,
      lastCommitMeshChunkCount: transactions?.lastCommitMeshChunkCount ?? 0,
      storageBytes: new TextEncoder().encode(localStorage.getItem('seedlands-world-v2') ?? '').byteLength,
      worldTime: this.environment?.worldTime ?? 0,
      timePaused: this.environment?.paused ?? false,
      quality: this.qualityLevel,
      triangles: telemetry?.triangles ?? 0,
      drawCalls: telemetry?.drawCalls ?? 0,
      runtime: 'integrated-server',
      serverRevision: this.world?.server.getChunk(0, 0, 0).revision ?? 0,
      voxelAtOrigin: this.world?.getVoxel(0, 0, 0) ?? Voxel.Air,
      serverPlayerPosition: this.serverPlayerId
        ? (this.world?.server.getEntity(this.serverPlayerId)?.position ?? [0, 0, 0])
        : [0, 0, 0],
      serverWorldTime: this.world?.server.worldTime ?? 0,
      performance: this.world?.performanceSummary ?? {
        scenarioId: 'unavailable',
        frame: { count: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0, longFrameCount: 0, lastLongFrameMs: 0 },
        chunkVisible: { count: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 },
        completedChunkTraces: 0,
        traceEventCount: 0,
        maxMeshCommitsInFrame: 0,
        maxMeshPartsInFrame: 0,
        visibleAfterPostrender: false,
        incidents: 0,
        droppedEvents: 0,
        uploadQueueDepth: 0,
        estimatedMeshBytes: 0,
      },
    };
  }
  private moveHarnessPlayer(x: number, z: number) {
    if (!this.world) return;
    const p = this.camera.getPosition();
    this.camera.setPosition(x, p.y, z);
    this.world.updateStreaming(this.camera.getPosition());
  }
  private burstHarnessEdits() {
    if (!this.world) return;
    const p = this.camera.getPosition(),
      y = Math.floor(p.y - 4),
      x = Math.floor(p.x) + 4,
      z = Math.floor(p.z) + 4;
    this.world.editBatch({
      actorId: 'harness-burst',
      edits: Array.from({ length: 6 }, (_, index) => ({
        x: x + index,
        y,
        z,
        value: index % 2 ? Voxel.Dirt : Voxel.Air,
      })),
    });
    this.queueSave();
  }
  private removeVoxelForHarness(x: number, y: number, z: number) {
    if (!this.world) return;
    this.world.edit(x, y, z, Voxel.Air);
    // Harness needs a deterministic readback boundary; ordinary player edits remain debounced.
    this.flushSave();
  }
  private movePlayerForHarness(x: number, y: number, z: number) {
    if (!this.world) return;
    this.camera.setPosition(x, y, z);
    this.world.updateStreaming(this.camera.getPosition());
  }
  private prepareFlatMovementFixture() {
    if (!this.world) return;
    const edits = [];
    for (let x = -2; x <= 2; x += 1) for (let z = -8; z <= 2; z += 1) edits.push({ x, y: 56, z, value: Voxel.Stone });
    this.world.editBatch({ actorId: 'harness-flat-movement', edits });
    this.keys.clear();
    this.velocity.set(0, 0, 0);
    this.onGround = true;
    this.camera.setPosition(0.5, 58.6, 0.5);
    this.world.updateStreaming(this.camera.getPosition());
  }
  private prepareCenterExcavationFixture() {
    if (!this.world) return;
    const edits = [];
    for (let x = -2; x <= 2; x += 1) for (let z = -2; z <= 2; z += 1) edits.push({ x, y: 56, z, value: Voxel.Stone });
    edits.push({ x: 0, y: 56, z: 0, value: Voxel.Air });
    this.world.editBatch({ actorId: 'harness-center-excavation', edits });
    this.keys.clear();
    this.velocity.set(0, 0, 0);
    this.onGround = false;
    this.camera.setPosition(0, 58.6, 0);
    this.world.updateStreaming(this.camera.getPosition());
  }
  private prepareStepDownFixture() {
    if (!this.world) return;
    const edits = [];
    for (let x = -2; x <= 2; x += 1) {
      for (let z = -8; z <= 2; z += 1) {
        edits.push({ x, y: 55, z, value: Voxel.Stone });
        edits.push({ x, y: 56, z, value: z >= 0 ? Voxel.Stone : Voxel.Air });
      }
    }
    this.world.editBatch({ actorId: 'harness-step-down', edits });
    this.keys.clear();
    this.velocity.set(0, 0, 0);
    this.onGround = true;
    this.camera.setPosition(0.5, 58.6, 0.5);
    this.world.updateStreaming(this.camera.getPosition());
  }
  private queueSave() {
    if (this.saveTimer !== null) return;
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      this.flushSave();
    }, 48);
  }
  private flushSave() {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.world) {
      this.performanceTelemetry.withSpan('persistence', 'FlushWorldSave', () => {
        this.world?.server.flushDirtyChunks();
        this.store.save(this.seedText, this.camera.getPosition(), this.persistence);
      });
    }
  }
  private renderHotbar() {
    const ids = [Voxel.Dirt, Voxel.Stone, Voxel.Wood, Voxel.Sand];
    const atlasTiles: Record<number, readonly [number, number]> = {
      [Voxel.Dirt]: [2, 0],
      [Voxel.Stone]: [0, 1],
      [Voxel.Wood]: [2, 1],
      [Voxel.Sand]: [1, 1],
    };
    hotbar.innerHTML = ids
      .map((id, index) => {
        const [column, row] = atlasTiles[id];
        return `<div class="slot ${id === this.chosen ? 'active' : ''}" data-material="${voxelNames[id]}"><span class="slot-key">${index + 1}</span><span class="slot-swatch" style="--tile-x:${column};--tile-y:${row}"></span><span class="slot-name">${voxelNames[id]}</span></div>`;
      })
      .join('');
  }
}

const game = new Game();
const saved = new Store().load();
if (saved) seedInput.value = saved.seed;
enterButton.onclick = async () => {
  const seed = seedInput.value.trim() || `world-${Math.random().toString(36).slice(2, 10)}`;
  const restore = saved?.seed === seed ? saved : null;
  enterButton.disabled = true;
  enterButton.textContent = '正在唤醒世界…';
  try {
    await game.start(seed, restore);
  } catch (error) {
    startCard.hidden = false;
    hud.hidden = true;
    enterButton.disabled = false;
    enterButton.textContent = '重试进入';
    throw error;
  }
  startCard.hidden = true;
  hud.hidden = false;
  enterButton.disabled = false;
  enterButton.textContent = '进入世界';
};
