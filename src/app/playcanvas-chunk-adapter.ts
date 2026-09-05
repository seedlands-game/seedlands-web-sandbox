import * as pc from 'playcanvas';
import { CHUNK_SIZE } from '../world/voxel';
import type { PerformanceTelemetry } from '../client/performance-telemetry';
import type { MeshPart, PendingMeshTask } from './app-contracts';
import type { ChunkResourceAdapter, ChunkSummary } from './chunk-resource-repository';
import { WaterMeshTransitionTracker } from './water-mesh-transition';

export const WATER_MESH_TRANSITION_MS = 180;
const INITIAL_WATER_AUTHORITY_BLEND = 0.12;

export type PlayCanvasChunkResource = {
  entity: pc.Entity;
  categoryEntities: Map<MeshPart['renderCategory'], pc.Entity>;
  meshes: pc.Mesh[];
  instances: pc.MeshInstance[];
  waterInstances: pc.MeshInstance[];
  waterBlend: number;
  transitionCancel: (() => void) | null;
};

const setWaterBlend = (resource: PlayCanvasChunkResource, blend: number) => {
  resource.waterBlend = Math.max(0, Math.min(1, blend));
  for (const instance of resource.waterInstances)
    instance.setParameter('material_opacity', (instance.material as pc.StandardMaterial).opacity * resource.waterBlend);
};

export const summarizeMeshParts = (parts: MeshPart[]): ChunkSummary => ({
  triangles: parts.reduce((sum, part) => sum + part.indices.length / 3, 0),
  drawCalls: parts.length,
  meshBytes: parts.reduce(
    (sum, part) =>
      sum +
      part.positions.byteLength +
      part.normals.byteLength +
      part.uvs.byteLength +
      part.colors.byteLength +
      part.indices.byteLength,
    0,
  ),
});

export const createPlayCanvasChunkAdapter = (
  app: pc.Application,
  resolveMaterial: (part: MeshPart) => pc.StandardMaterial,
  telemetry: PerformanceTelemetry,
  waterLayerId?: number,
  transitions = new WaterMeshTransitionTracker(),
): ChunkResourceAdapter<PendingMeshTask, MeshPart, PlayCanvasChunkResource> => ({
  create: (task) => ({
    entity: new pc.Entity(`Chunk ${task.chunkKey}`),
    categoryEntities: new Map(),
    meshes: [],
    instances: [],
    waterInstances: [],
    waterBlend: 1,
    transitionCancel: null,
  }),
  commitPart: (resource, task, part) => {
    const span = telemetry.beginSpan('render', 'MeshCommit', 'main', task.traceId);
    const mesh = new pc.Mesh(app.graphicsDevice);
    if (part.layout === 'compact') {
      mesh.setPositions(part.positions);
      mesh.setNormals(part.normals);
      mesh.setVertexStream(pc.SEMANTIC_TEXCOORD0, part.uvs, 2, undefined, pc.TYPE_FLOAT16);
    } else {
      mesh.setPositions(part.positions);
      mesh.setNormals(part.normals);
      mesh.setUvs(0, part.uvs);
    }
    mesh.setColors32(part.colors);
    mesh.setIndices(part.indices);
    mesh.update();
    let categoryEntity = resource.categoryEntities.get(part.renderCategory);
    if (!categoryEntity) {
      categoryEntity = new pc.Entity(`${resource.entity.name} ${part.renderCategory}`);
      resource.categoryEntities.set(part.renderCategory, categoryEntity);
      resource.entity.addChild(categoryEntity);
    }
    const instance = new pc.MeshInstance(mesh, resolveMaterial(part), categoryEntity);
    if (part.renderCategory === 'emissive') instance.castShadow = false;
    if (part.renderCategory === 'transparent') {
      instance.drawOrder = 1000;
      instance.castShadow = false;
      resource.waterInstances.push(instance);
    }
    resource.meshes.push(mesh);
    resource.instances.push(instance);
    telemetry.endSpan(span);
    telemetry.markTrace(task.traceId, 'mesh-part-commit', 'main');
  },
  attach: (resource, task, onPostrender) => {
    const span = telemetry.beginSpan('render', 'SceneAttach', 'main', task.traceId);
    for (const [category, entity] of resource.categoryEntities) {
      entity.addComponent('render');
      entity.render!.meshInstances = resource.instances.filter((instance) => instance.node === entity);
      if (category === 'transparent' && waterLayerId !== undefined) entity.render!.layers = [waterLayerId];
    }
    resource.entity.setPosition(task.cx * CHUNK_SIZE, task.cy * CHUNK_SIZE, task.cz * CHUNK_SIZE);
    app.root.addChild(resource.entity);
    telemetry.endSpan(span);
    telemetry.markTrace(task.traceId, 'scene-attached', 'main');
    app.once('postrender', onPostrender);
  },
  prepareReplacement: (previous, current, task) => {
    if (!previous.waterInstances.length && !current.waterInstances.length) return false;
    previous.transitionCancel?.();
    current.transitionCancel?.();
    setWaterBlend(previous, 1 - INITIAL_WATER_AUTHORITY_BLEND);
    setWaterBlend(current, INITIAL_WATER_AUTHORITY_BLEND);
    transitions.begin(
      { chunkKey: task.chunkKey, targetRevision: task.chunkRevision, traceId: task.traceId },
      INITIAL_WATER_AUTHORITY_BLEND,
    );
    telemetry.markTrace(task.traceId, 'water-transition-first-visible', 'main');
    return true;
  },
  transitionReplacement: (previous, current, task, onComplete) => {
    let previousFrameAt = performance.now();
    let elapsed = 0;
    const previousBlend = previous.waterBlend;
    let animationFrame = 0;
    let finished = false;
    const finish = (cancelled: boolean) => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(animationFrame);
      previous.transitionCancel = null;
      current.transitionCancel = null;
      if (cancelled) transitions.cancel(task.traceId);
      else {
        setWaterBlend(previous, 0);
        setWaterBlend(current, 1);
        transitions.complete(task.traceId);
        telemetry.markTrace(task.traceId, 'water-transition-complete', 'main');
      }
      onComplete();
    };
    const update = (now: number) => {
      if (transitions.held) {
        previousFrameAt = now;
        animationFrame = requestAnimationFrame(update);
        return;
      }
      elapsed += Math.max(0, now - previousFrameAt);
      previousFrameAt = now;
      const progress =
        INITIAL_WATER_AUTHORITY_BLEND +
        (1 - INITIAL_WATER_AUTHORITY_BLEND) * Math.min(1, elapsed / WATER_MESH_TRANSITION_MS);
      setWaterBlend(previous, previousBlend * (1 - progress));
      setWaterBlend(current, progress);
      transitions.advance(task.traceId, progress);
      if (progress >= 1) finish(false);
      else animationFrame = requestAnimationFrame(update);
    };
    const cancel = () => finish(true);
    previous.transitionCancel = cancel;
    current.transitionCancel = cancel;
    animationFrame = requestAnimationFrame(update);
  },
  destroy: (resource) => {
    resource.transitionCancel?.();
    resource.meshes.forEach((mesh) => mesh.destroy());
    resource.entity.destroy();
  },
});
