import { describe, expect, it, vi } from 'vitest';
import type { GameServer } from '../../src/server/game-server';
import type { AuthorityGameplayView } from '../../src/server/protocol/authority-worker-protocol';
import type { AuthoritySnapshot } from '../../src/server/authority/authority-session';
import type { AuthorityResidencyDiagnostics } from '../../src/server/authority/authority-residency-runtime';
import { projectAuthorityReady } from '../../src/server/authority/authority-ready';
import { prepareAuthorityMeshPayload } from '../../src/server/authority/authority-mesh-payload';
import { FaceMaterial, type FaceMaterialId } from '../../src/world/voxel';
import type { VoxelSemanticsDefinition } from '../../src/world/voxel-semantics';

type MutableGeometryInput = {
  version: 1;
  voxel: number;
  boxes: Array<{ min: [number, number, number]; max: [number, number, number]; material: FaceMaterialId }>;
  collision: Array<{ min: [number, number, number]; max: [number, number, number] }>;
  occludesFullFace: boolean;
};

const geometry = (): MutableGeometryInput[] => [
  {
    version: 1,
    voxel: 500,
    boxes: [{ min: [0.125, 0, 0], max: [0.25, 1, 1], material: FaceMaterial.WoodenDoor }],
    collision: [{ min: [0.125, 0, 0], max: [0.25, 1, 1] }],
    occludesFullFace: false,
  },
];
const semantics: VoxelSemanticsDefinition = {
  id: 'sample:panel',
  storageId: 500,
  solid: true,
  targetable: true,
  renderable: true,
  meshKind: 'cube',
  emission: 0,
  lightCost: 16,
  faceMaterials: [
    FaceMaterial.WoodenDoor,
    FaceMaterial.WoodenDoor,
    FaceMaterial.WoodenDoor,
    FaceMaterial.WoodenDoor,
    FaceMaterial.WoodenDoor,
    FaceMaterial.WoodenDoor,
  ],
};

const server = () =>
  ({
    seed: 7,
    generatorVersion: 3,
    worldgenProvider: undefined,
    worldTime: 9,
    voxelSemantics: {
      get: (storageId: number) => (storageId === 500 ? semantics : undefined),
      list: () => [semantics],
    },
    restoredSnapshotMigrationReports: [],
    queryPois: () => [],
    retainMeshChunk: vi.fn(),
    retainMeshPreparationNeighborhood: vi.fn(() => vi.fn()),
    ensureChunkNeighborhood: vi.fn(async () => undefined),
    prepareWorkerMeshInput: vi.fn(() => ({
      key: '0,0,0',
      chunkRevision: 2,
      canonical: new Uint16Array(32 ** 3),
      fluid: new Uint8Array(32 ** 3),
      overlays: [],
    })),
  }) as unknown as GameServer;

describe('Authority geometry projection', () => {
  it('copies validated geometry into ready without changing legacy calls', () => {
    const source = geometry();
    const input = {
      server: server(),
      playerId: 'player',
      playerBodyPosition: [0.5, 33, 0.5] as [number, number, number],
      isNew: true,
      seedText: 'geometry',
      frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 30 } as const,
      snapshot: {} as AuthoritySnapshot,
      residency: {} as AuthorityResidencyDiagnostics,
      gameplay: {} as AuthorityGameplayView,
    };

    const ready = projectAuthorityReady(input, source);
    expect(ready.voxelGeometry).toEqual(source);
    expect(ready.voxelGeometry).not.toBe(source);
    expect(Object.isFrozen(ready.voxelGeometry)).toBe(true);
    source[0]!.boxes[0]!.min[0] = 0.75;
    expect(ready.voxelGeometry?.[0]?.boxes[0]?.min[0]).toBe(0.125);
    expect(projectAuthorityReady(input)).not.toHaveProperty('voxelGeometry');
  });

  it('copies the same projection into prepared mesh payloads and rejects malformed input first', async () => {
    const source = geometry();
    const prepared = await prepareAuthorityMeshPayload(server(), () => 0, 0, 0, 0, source);
    expect(prepared.voxelGeometry).toEqual(source);
    expect(prepared.voxelGeometry).not.toBe(source);
    await expect(prepareAuthorityMeshPayload(server(), () => 0, 0, 0, 0)).resolves.not.toHaveProperty('voxelGeometry');
    await expect(
      prepareAuthorityMeshPayload(server(), () => 0, 0, 0, 0, [{ ...source[0]!, voxel: Number.NaN }]),
    ).rejects.toThrow(/voxel/i);
  });
});
