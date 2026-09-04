import * as pc from 'playcanvas';
import { CHUNK_SIZE } from '../world/voxel';
import type { PerformanceTelemetry } from '../client/performance-telemetry';
import type { MeshPart, PendingMeshTask } from './app-contracts';
import type { ChunkResourceAdapter, ChunkSummary } from './chunk-resource-repository';

export type PlayCanvasChunkResource = {
  entity: pc.Entity;
  categoryEntities: Map<MeshPart['renderCategory'], pc.Entity>;
  meshes: pc.Mesh[];
  instances: pc.MeshInstance[];
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
): ChunkResourceAdapter<PendingMeshTask, MeshPart, PlayCanvasChunkResource> => ({
  create: (task) => ({
    entity: new pc.Entity(`Chunk ${task.chunkKey}`),
    categoryEntities: new Map(),
    meshes: [],
    instances: [],
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
    if (part.renderCategory === 'transparent') {
      instance.drawOrder = 1000;
      instance.castShadow = false;
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
  destroy: (resource) => {
    resource.meshes.forEach((mesh) => mesh.destroy());
    resource.entity.destroy();
  },
});
