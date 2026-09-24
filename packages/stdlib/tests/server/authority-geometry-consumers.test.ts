import { describe, expect, it, vi } from 'vitest';
import { queueBodyRecoveriesAfterCommit } from '../../src/server/authority/authority-geometry-recovery';
import { VoxelCollisionWorld } from '../../src/server/authority/voxel-collision-world';
import type { WorldCommitResult } from '../../src/server/game-server-types';
import type { GameplayEntity } from '../../src/server/gameplay/entity-store';
import { playerOccupiesVoxelShape } from '../../src/server/gameplay/player-occupancy';
import { createVoxelGeometryRegistryV1, type VoxelGeometryBoxV1 } from '../../src/world/voxel-geometry';
import { collisionBoxesForVoxel } from '../../src/world/voxel-model';
import { FaceMaterial, Voxel, voxelIndex } from '../../src/world/voxel';

const VOXEL = 500;
const westShape = { min: [0, 0, 0] as const, max: [0.1875, 1, 1] as const };
const eastShape = { min: [0.8125, 0, 0] as const, max: [1, 1, 1] as const };
const geometry = (collision: readonly VoxelGeometryBoxV1[], shape: VoxelGeometryBoxV1 = westShape) =>
  createVoxelGeometryRegistryV1([
    {
      version: 1,
      voxel: VOXEL,
      boxes: [{ ...shape, material: FaceMaterial.WoodenDoor }],
      collision,
      occludesFullFace: false,
    },
  ]);
const west = geometry([westShape]);
const east = geometry([eastShape], eastShape);
const open = geometry([]);

const source = {
  getLoadedVoxel: () => ({ voxel: VOXEL, chunkKey: '0,0,0', revision: 3 }),
};

const commit = (): WorldCommitResult => ({
  committed: true,
  worldRevision: 1,
  structuralChange: {
    type: 'voxel-region-changed',
    actorId: 'fixture',
    worldRevision: 1,
    mutationCount: 1,
    chunks: ['0,0,0'],
    chunkRevisions: [{ key: '0,0,0', revision: 1 }],
    meshChunks: ['0,0,0'],
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
  },
  semanticEvents: [],
  collisionDelta: [
    {
      key: '0,0,0',
      previousRevision: 0,
      revision: 1,
      cells: [{ index: voxelIndex(0, 0, 0), voxel: VOXEL, fluid: 0 }],
    },
  ],
  metrics: {
    timingStatus: 'not-collected-hot-path',
    inputMutationCount: 1,
    canonicalWriteCount: 1,
    dirtyChunkCount: 1,
    meshInvalidationCount: 1,
    structuralEventCount: 1,
    semanticEventCount: 0,
    mutationPayloadBytes: 14,
    mutationCapacityBytes: 14,
    validationMs: 0,
    resolveMs: 0,
    applyMs: 0,
    commitMs: 0,
  },
});
const player: GameplayEntity = {
  id: 'player',
  type: 'player',
  kind: 'player',
  lifecycle: 'active',
  position: [0.1, 0, 0.5],
  physicsVelocity: [0, 0, 0],
};

describe('Authority voxel geometry consumers', () => {
  it('isolates same-storage-id collision geometry per world instance', () => {
    const westWorld = new VoxelCollisionWorld(source, undefined, undefined, west);
    const eastWorld = new VoxelCollisionWorld(source, undefined, undefined, east);
    const openWorld = new VoxelCollisionWorld(source, undefined, undefined, open);
    const bounds = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } };

    expect(westWorld.querySolids(bounds)[0]?.aabb).toEqual({
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0.1875, y: 1, z: 1 },
    });
    expect(eastWorld.querySolids(bounds)[0]?.aabb).toEqual({
      min: { x: 0.8125, y: 0, z: 0 },
      max: { x: 1, y: 1, z: 1 },
    });
    expect(openWorld.querySolids(bounds)).toEqual([]);
    expect(westWorld.querySolids(bounds)[0]?.aabb).not.toEqual(eastWorld.querySolids(bounds)[0]?.aabb);
  });

  it('uses injected thin and empty collision for player placement occupancy', () => {
    expect(playerOccupiesVoxelShape(player.position, [0, 0, 0], VOXEL, west)).toBe(true);
    expect(playerOccupiesVoxelShape(player.position, [0, 0, 0], VOXEL, east)).toBe(false);
    expect(playerOccupiesVoxelShape(player.position, [0, 0, 0], VOXEL, open)).toBe(false);
  });

  it('requests recovery only when the injected descriptor adds collision', () => {
    const recoverWest = vi.fn();
    const recoverOpen = vi.fn();

    queueBodyRecoveriesAfterCommit(commit(), [player], recoverWest, west);
    queueBodyRecoveriesAfterCommit(commit(), [player], recoverOpen, open);

    expect(recoverWest).toHaveBeenCalledOnce();
    expect(recoverOpen).not.toHaveBeenCalled();
  });

  it('keeps unknown space blocking even when the registered voxel descriptor is nonblocking', () => {
    const request = vi.fn();
    const world = new VoxelCollisionWorld({ getLoadedVoxel: () => null }, request, undefined, open);
    const colliders = world.querySolids({ min: { x: 31.8, y: 2, z: 0 }, max: { x: 32.2, y: 3, z: 1 } });

    expect(colliders.length).toBeGreaterThan(0);
    expect(colliders.every(({ id }) => id?.startsWith('unknown:'))).toBe(true);
    expect(new Set(request.mock.calls.map(([key]) => key))).toEqual(new Set(['0,0,0', '1,0,0']));
  });

  it('preserves legacy static geometry when no per-world resolver is supplied', () => {
    expect(collisionBoxesForVoxel(Voxel.Lantern)).toEqual([{ min: [0.25, 0, 0.25], max: [0.75, 0.94, 0.75] }]);
    expect(playerOccupiesVoxelShape([0.82, 40, 0.5], [0, 40, 0], Voxel.Lantern)).toBe(true);
  });
});
