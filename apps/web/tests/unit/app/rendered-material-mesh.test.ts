import { describe, expect, it } from 'vitest';
import { createVoxelGeometryRegistryV1 } from '@seedlands/stdlib/mod-api';
import { batchCompactMeshData } from '@seedlands/stdlib/world/mesh-batching';
import { meshChunk, type MeshData } from '@seedlands/stdlib/world/mesh';
import { createMeshSemanticsLookup } from '@seedlands/stdlib/world/mesh-semantics';
import { CHUNK_SIZE, FaceMaterial, voxelIndex } from '@seedlands/stdlib/world/voxel';
import { classicWoodenDoorGeometryDescriptors } from '../../../../../playbooks/classic/src/structure-descriptors';
import { overworldVoxelSemantics } from '../../../../../playbooks/classic/src/blocks';
import { ChunkResourceRepository, type ChunkResourceAdapter } from '../../../src/app/world/chunk-resource-repository';
import {
  getRenderedMaterialMeshFromChunks,
  recordRenderedMaterialMeshPart,
  type RenderedMaterialMeshResource,
} from '../../../src/app/world/rendered-material-mesh';

const part = (material: FaceMaterial, x: number): MeshData => ({
  material,
  renderCategory: 'opaque',
  layout: 'float32',
  positions: new Float32Array([x, 0, 0, x + 0.25, 0, 0, x, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
  colors: new Uint8Array(12).fill(255),
  indices: new Uint32Array([0, 1, 2]),
});

describe('rendered material mesh observation', () => {
  it('isolates indexed vertices from a mixed compact mesh by encoded material', () => {
    const compact = batchCompactMeshData([part(FaceMaterial.WoodenDoor, 1), part(FaceMaterial.Stone, 8)])[0]!;
    const resource: RenderedMaterialMeshResource = { renderedMaterialMeshes: new Map() };

    recordRenderedMaterialMeshPart(resource, compact);

    expect(resource.renderedMaterialMeshes?.get(FaceMaterial.WoodenDoor)).toEqual({
      material: FaceMaterial.WoodenDoor,
      vertexCount: 3,
      indexCount: 3,
      min: [1, 0, 0],
      max: [1.25, 1, 0],
    });
    expect(resource.renderedMaterialMeshes?.get(FaceMaterial.Stone)).toEqual({
      material: FaceMaterial.Stone,
      vertexCount: 3,
      indexCount: 3,
      min: [8, 0, 0],
      max: [8.25, 1, 0],
    });
  });

  it('observes thin 89/91 door meshes with vertices and rotated principal axes', () => {
    const geometry = createVoxelGeometryRegistryV1(classicWoodenDoorGeometryDescriptors);
    const semantics = createMeshSemanticsLookup(overworldVoxelSemantics);
    const observe = (voxel: number) => {
      const data = new Uint16Array(CHUNK_SIZE ** 3);
      data[voxelIndex(4, 5, 6)] = voxel;
      const source = meshChunk({
        seed: 1,
        cx: 0,
        cy: 0,
        cz: 0,
        data,
        changes: [],
        outside: () => 0,
        semantics,
        geometry,
      })[FaceMaterial.WoodenDoor]!;
      const resource: RenderedMaterialMeshResource = { renderedMaterialMeshes: new Map() };
      for (const compact of batchCompactMeshData([source])) recordRenderedMaterialMeshPart(resource, compact);
      const summary = resource.renderedMaterialMeshes?.get(FaceMaterial.WoodenDoor);
      if (!summary) throw new Error('Rendered wooden-door material summary is unavailable.');
      return summary;
    };

    const closed = observe(89);
    const open = observe(91);

    expect(closed.vertexCount).toBeGreaterThan(0);
    expect(open.vertexCount).toBeGreaterThan(0);
    expect(closed.indexCount).toBe(36);
    expect(open.indexCount).toBe(36);
    expect(closed.max[2] - closed.min[2]).toBeCloseTo(3 / 16);
    expect(open.max[0] - open.min[0]).toBeCloseTo(3 / 16);
    expect(closed.max[0] - closed.min[0]).toBe(1);
    expect(open.max[2] - open.min[2]).toBe(1);
  });

  it('publishes only the current postrender resource and clears replacement/unload state', () => {
    type Task = { chunkKey: string; cx: number; cy: number; cz: number; chunkRevision: number };
    type Resource = RenderedMaterialMeshResource & { postrender: (() => void) | null };
    const adapter: ChunkResourceAdapter<Task, MeshData, Resource> = {
      create: () => ({ renderedMaterialMeshes: new Map(), postrender: null }),
      commitPart: (resource, _task, mesh) => recordRenderedMaterialMeshPart(resource, mesh),
      attach: (resource, _task, postrender) => (resource.postrender = postrender),
      destroy: () => undefined,
    };
    const repository = new ChunkResourceRepository({
      adapter,
      isCurrent: () => true,
      profile: { maxMeshCommitsPerFrame: 1, maxMeshPartsPerFrame: 2, maxCommitMs: 10 },
      now: () => 0,
      summarize: () => ({ triangles: 1, drawCalls: 1, meshBytes: 1 }),
      onVisible: () => undefined,
      onTransitionVisible: () => undefined,
      onDiscard: () => undefined,
    });
    const task = (revision: number): Task => ({ chunkKey: '2,1,-1', cx: 2, cy: 1, cz: -1, chunkRevision: revision });

    const first = repository.enqueue(task(4), [part(FaceMaterial.WoodenDoor, 1)]);
    repository.beginFrame();
    repository.drain();
    expect(getRenderedMaterialMeshFromChunks(repository.chunks, 2, 1, -1, FaceMaterial.WoodenDoor)).toBeNull();
    first.postrender?.();
    expect(getRenderedMaterialMeshFromChunks(repository.chunks, 2, 1, -1, FaceMaterial.WoodenDoor)).toEqual({
      chunkKey: '2,1,-1',
      chunkRevision: 4,
      material: FaceMaterial.WoodenDoor,
      vertexCount: 3,
      indexCount: 3,
      min: [65, 32, -32],
      max: [65.25, 33, -32],
    });

    const replacement = repository.enqueue(task(5), [part(FaceMaterial.Stone, 2)]);
    repository.beginFrame();
    repository.drain();
    replacement.postrender?.();
    expect(getRenderedMaterialMeshFromChunks(repository.chunks, 2, 1, -1, FaceMaterial.WoodenDoor)).toBeNull();
    repository.unload('2,1,-1');
    expect(getRenderedMaterialMeshFromChunks(repository.chunks, 2, 1, -1, FaceMaterial.Stone)).toBeNull();
  });
});
