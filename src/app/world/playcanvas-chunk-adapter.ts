import * as pc from 'playcanvas';
import { CHUNK_SIZE } from '../../world/voxel';
import type { PerformanceTelemetry } from '../../client/presentation/performance-telemetry';
import type { MeshPart, PendingMeshTask } from '../app-contracts';
import type { ChunkResourceAdapter, ChunkSummary } from './chunk-resource-repository';
import {
  createPlayCanvasWaterTransition,
  type PlayCanvasWaterTransition,
  type PlayCanvasWaterTransitionFactory,
} from '../scene/playcanvas-water-transition';
import { buildWaterSurfaceTransition } from '../scene/water-surface-transition';
import { WaterMeshTransitionTracker } from '../scene/water-mesh-transition';

export const WATER_MESH_TRANSITION_MS = 180;
export const MAX_ACTIVE_WATER_TRANSITIONS = 8;

export type PlayCanvasChunkResource = {
  entity: pc.Entity;
  categoryEntities: Map<MeshPart['renderCategory'], pc.Entity>;
  meshes: pc.Mesh[];
  instances: pc.MeshInstance[];
  waterInstances: pc.MeshInstance[];
  waterParts: MeshPart[];
  waterTransition: PlayCanvasWaterTransition | null;
  waterTransitionLayer?: pc.Layer;
  transitionCancel: (() => void) | null;
};

const setWaterVisible = (resource: PlayCanvasChunkResource, visible: boolean) => {
  for (const instance of resource.waterInstances) instance.visible = visible;
};

const clearWaterTransition = (resource: PlayCanvasChunkResource) => {
  const transition = resource.waterTransition;
  if (!transition) return;
  resource.waterTransition = null;
  resource.waterTransitionLayer?.removeMeshInstances([transition.instance]);
  resource.waterTransitionLayer = undefined;
  transition.destroy();
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
  createWaterTransition: PlayCanvasWaterTransitionFactory = createPlayCanvasWaterTransition,
): ChunkResourceAdapter<PendingMeshTask, MeshPart, PlayCanvasChunkResource> => ({
  create: (task) => ({
    entity: new pc.Entity(`Chunk ${task.chunkKey}`),
    categoryEntities: new Map(),
    meshes: [],
    instances: [],
    waterInstances: [],
    waterParts: [],
    waterTransition: null,
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
      resource.waterParts.push(part);
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
    if (resource.waterTransition) {
      // RenderComponent owns its static instances and destroys them on reassignment.
      // The temporary morph keeps separate ownership and only borrows the Water layer.
      const layer = app.scene.layers.getLayerById(waterLayerId ?? pc.LAYERID_WORLD);
      if (layer) {
        layer.addMeshInstances([resource.waterTransition.instance]);
        resource.waterTransitionLayer = layer;
      } else resource.transitionCancel?.();
    }
    resource.entity.setPosition(task.cx * CHUNK_SIZE, task.cy * CHUNK_SIZE, task.cz * CHUNK_SIZE);
    app.root.addChild(resource.entity);
    telemetry.endSpan(span);
    telemetry.markTrace(task.traceId, 'scene-attached', 'main');
    app.once('postrender', onPostrender);
  },
  prepareReplacement: (previous, current, task) => {
    if (!previous.waterParts.length && !current.waterParts.length) return false;
    previous.transitionCancel?.();
    current.transitionCancel?.();
    if (transitions.activeCount >= MAX_ACTIVE_WATER_TRANSITIONS) {
      telemetry.markTrace(task.traceId, 'water-transition-skipped-active-budget', 'main');
      return false;
    }
    const plan = buildWaterSurfaceTransition(previous.waterParts, current.waterParts);
    if (plan.kind !== 'transition') {
      if (plan.kind === 'budget-exceeded') telemetry.markTrace(task.traceId, 'water-transition-skipped-budget', 'main');
      return false;
    }
    let transparent = current.categoryEntities.get('transparent');
    if (!transparent) {
      transparent = new pc.Entity(`${current.entity.name} transparent`);
      current.categoryEntities.set('transparent', transparent);
      current.entity.addChild(transparent);
    }
    const material = current.waterInstances[0]?.material ?? previous.waterInstances[0]?.material;
    if (!material) return false;
    try {
      current.waterTransition = createWaterTransition(app, plan.geometry, material, transparent);
    } catch {
      clearWaterTransition(current);
      telemetry.markTrace(task.traceId, 'water-transition-skipped-renderer', 'main');
      return false;
    }
    setWaterVisible(previous, false);
    setWaterVisible(current, false);
    transitions.begin(
      {
        chunkKey: task.chunkKey,
        targetRevision: task.chunkRevision,
        traceId: task.traceId,
        geometry: {
          mode: 'surface-morph',
          patchCount: plan.patchCount,
          retainedPatchCount: plan.retainedPatchCount,
          addedPatchCount: plan.addedPatchCount,
          removedPatchCount: plan.removedPatchCount,
          visibleWaterMeshCount: 1,
          opacityCrossfade: false,
        },
      },
      0,
    );
    const preparedTransition = current.waterTransition;
    const cancelPrepared = () => {
      if (current.waterTransition !== preparedTransition) return;
      previous.transitionCancel = null;
      current.transitionCancel = null;
      clearWaterTransition(current);
      setWaterVisible(previous, true);
      setWaterVisible(current, true);
      transitions.cancel(task.traceId);
    };
    previous.transitionCancel = cancelPrepared;
    current.transitionCancel = cancelPrepared;
    telemetry.markTrace(task.traceId, 'water-transition-prepared', 'main');
    return true;
  },
  transitionReplacement: (previous, current, task, onComplete, onTransitionVisible) => {
    const transition = current.waterTransition;
    if (!transition) {
      onComplete();
      return false;
    }
    previous.transitionCancel = null;
    current.transitionCancel = null;
    let previousFrameAt = performance.now();
    let elapsed = 0;
    let finished = false;
    let cancelled = false;
    let visiblePostrenderPending = false;
    let visibleReported = false;
    const reportTransitionVisible = () => {
      visiblePostrenderPending = false;
      if (cancelled || visibleReported) return;
      visibleReported = true;
      if (finished && current.transitionCancel === cancelPendingVisible) current.transitionCancel = null;
      telemetry.markTrace(task.traceId, 'water-transition-progress-visible', 'main');
      onTransitionVisible?.();
    };
    const cancelPendingVisible = () => {
      if (visiblePostrenderPending) app.off('postrender', reportTransitionVisible);
      visiblePostrenderPending = false;
      if (finished && current.transitionCancel === cancelPendingVisible) current.transitionCancel = null;
    };
    const scheduleTransitionVisible = () => {
      if (!onTransitionVisible || cancelled || visibleReported || visiblePostrenderPending) return;
      visiblePostrenderPending = true;
      app.once('postrender', reportTransitionVisible);
    };
    const finish = (cancelled: boolean) => {
      if (finished) return;
      finished = true;
      if (cancelled) cancelPendingVisible();
      app.off('prerender', update);
      previous.transitionCancel = null;
      current.transitionCancel = null;
      if (cancelled) transitions.cancel(task.traceId);
      else {
        transition.setProgress(1);
        transitions.complete(task.traceId);
        telemetry.markTrace(task.traceId, 'water-transition-complete', 'main');
      }
      clearWaterTransition(current);
      setWaterVisible(current, true);
      if (!cancelled) {
        scheduleTransitionVisible();
        if (visiblePostrenderPending) current.transitionCancel = cancelPendingVisible;
      }
      onComplete();
    };
    const update = () => {
      const now = performance.now();
      if (transitions.held) {
        previousFrameAt = now;
        return;
      }
      elapsed += Math.max(0, now - previousFrameAt);
      previousFrameAt = now;
      const progress = Math.min(1, elapsed / WATER_MESH_TRANSITION_MS);
      transition.setProgress(progress);
      transitions.advance(task.traceId, progress);
      if (progress > 0) scheduleTransitionVisible();
      if (progress >= 1) finish(false);
    };
    const cancel = () => {
      cancelled = true;
      finish(true);
    };
    previous.transitionCancel = cancel;
    current.transitionCancel = cancel;
    app.on('prerender', update);
    return true;
  },
  destroy: (resource) => {
    resource.transitionCancel?.();
    clearWaterTransition(resource);
    resource.meshes.forEach((mesh) => mesh.destroy());
    resource.entity.destroy();
  },
});
