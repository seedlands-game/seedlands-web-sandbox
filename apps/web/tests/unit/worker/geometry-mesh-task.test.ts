import { describe, expect, it } from 'vitest';
import { testCorePlatform } from '../../../../../packages/stdlib/tests/support/core-platform';
import { testWorldgenProvider, testWorldgenProviders } from '../../../../../packages/stdlib/tests/support/worldgen';
import { runWorldComputeTask } from '../../../../../packages/stdlib/src/server/compute/world-compute-task';
import { CHUNK_SIZE, FaceMaterial, Voxel, voxelIndex } from '../../../../../packages/stdlib/src/world/voxel';
import { createVoxelGeometryRegistryV1 } from '../../../../../packages/stdlib/src/world/voxel-geometry';
import type { VoxelSemanticsDefinition } from '../../../../../packages/stdlib/src/world/voxel-semantics';
import { createMeshSemanticsLookup } from '../../../../../packages/stdlib/src/world/mesh-semantics';
import { worldKernelAdapter } from '../../../src/worker/world-kernel-adapter';
import type { WorkerKernelState } from '../../../src/worker/wasm-kernel-loader';
import { classicWoodenDoorGeometryDescriptors } from '../../../../../playbooks/classic/src/structure-descriptors';
import { overworldVoxelSemantics } from '../../../../../playbooks/classic/src/blocks';
import { meshChunk } from '../../../../../packages/stdlib/src/world/mesh';

const storageId = 500;
const geometry = createVoxelGeometryRegistryV1([
  {
    version: 1,
    voxel: storageId,
    boxes: [{ min: [0.125, 0, 0], max: [0.25, 1, 1], material: FaceMaterial.WoodenDoor }],
    collision: [{ min: [0.125, 0, 0], max: [0.25, 1, 1] }],
    occludesFullFace: false,
  },
]);
const voxelSemantics: readonly VoxelSemanticsDefinition[] = [
  {
    id: 'sample:air',
    storageId: Voxel.Air,
    solid: false,
    targetable: false,
    renderable: false,
    meshKind: 'cube',
    emission: 0,
    lightCost: 1,
    faceMaterials: Array(6).fill(FaceMaterial.Stone) as VoxelSemanticsDefinition['faceMaterials'],
  },
  {
    id: 'sample:panel',
    storageId,
    solid: true,
    targetable: true,
    renderable: true,
    meshKind: 'cube',
    emission: 0,
    lightCost: 16,
    faceMaterials: Array(6).fill(FaceMaterial.WoodenDoor) as VoxelSemanticsDefinition['faceMaterials'],
  },
];

describe('geometry-aware worker mesh task', () => {
  it('rebuilds the projection and changes real worker mesh output', async () => {
    const canonical = new Uint16Array(CHUNK_SIZE ** 3);
    canonical[voxelIndex(4, 5, 6)] = storageId;
    const result = await runWorldComputeTask(
      {
        kind: 'mesh',
        traceId: 'geometry',
        epoch: 1,
        chunkKey: '0,0,0',
        seed: 1,
        cx: 0,
        cy: 0,
        cz: 0,
        chunkRevision: 1,
        haloRevision: 'one',
        generatorVersion: 3,
        provider: testWorldgenProvider,
        canonical: canonical.buffer,
        halo: new Uint16Array(34 ** 3).buffer,
        fluid: new Uint8Array(CHUNK_SIZE ** 3).buffer,
        fluidHalo: new Uint8Array(34 ** 3).buffer,
        voxelSemantics,
        voxelGeometry: geometry.list(),
      },
      undefined,
      undefined,
      { providers: testWorldgenProviders, now: testCorePlatform.now },
    );
    if (result.kind !== 'mesh-result') throw new Error('Unexpected compute result.');
    const positions = result.meshes.flatMap((part) => [...part.positions]);
    const xs = positions.filter((_value, index) => index % 3 === 0);
    expect(new Set(xs)).toEqual(new Set([4.125, 4.25]));
  });

  it('uses the existing TS mesher for only custom-geometry tasks without poisoning Wasm state', () => {
    const memory = { failed: false } as NonNullable<WorkerKernelState['memory']>;
    const adapter = worldKernelAdapter(
      {
        memory,
        selected: ['w04'],
        status: 'matched',
        requestedArtifact: 'scalar',
        effectiveArtifact: 'scalar',
      },
      testWorldgenProviders.resolve(testWorldgenProvider, 3),
    );
    const data = new Uint16Array(CHUNK_SIZE ** 3);
    data[voxelIndex(0, 0, 0)] = storageId;
    const meshes = adapter.meshChunk!({
      seed: 1,
      cx: 0,
      cy: 0,
      cz: 0,
      data,
      changes: [],
      outside: () => 0,
      semantics: createMeshSemanticsLookup(voxelSemantics),
      geometry,
    });

    expect(meshes[FaceMaterial.WoodenDoor]?.indices).toHaveLength(36);
    expect(memory.failed).toBe(false);
  });

  it('emits closed and open Classic door variants as differently oriented thin meshes', () => {
    const registry = createVoxelGeometryRegistryV1(classicWoodenDoorGeometryDescriptors);
    const classicSemantics = createMeshSemanticsLookup(overworldVoxelSemantics);
    const render = (voxel: number) => {
      const data = new Uint16Array(CHUNK_SIZE ** 3);
      data[voxelIndex(4, 5, 6)] = voxel;
      return meshChunk({
        seed: 1,
        cx: 0,
        cy: 0,
        cz: 0,
        data,
        changes: [],
        outside: () => 0,
        semantics: classicSemantics,
        geometry: registry,
      })[FaceMaterial.WoodenDoor]!;
    };
    const closed = render(89);
    const open = render(91);
    const axes = (values: Float32Array, axis: number) =>
      new Set([...values].filter((_value, index) => index % 3 === axis));

    expect(axes(closed.positions, 2)).toEqual(new Set([6, 6.1875]));
    expect(axes(open.positions, 0)).toEqual(new Set([4, 4.1875]));
    expect(closed.indices).toHaveLength(36);
    expect(open.indices).toHaveLength(36);
    expect(closed.normals).toHaveLength(closed.positions.length);
    expect(open.normals).toHaveLength(open.positions.length);
    expect(closed.uvs).toHaveLength((closed.positions.length / 3) * 2);
    expect(open.uvs).toHaveLength((open.positions.length / 3) * 2);
  });
});
