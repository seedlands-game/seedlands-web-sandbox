import { describe, expect, it } from 'vitest';
import { assembleOverworldPacks } from '@seedlands/game-core/server/composition/host-api';
import { pack } from '../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';
import { GameplayRuntime, type GameplayResult } from '../../packages/game-core/src/server/gameplay/gameplay-runtime';
import type { WorldCommitResult } from '../../packages/game-core/src/server/game-server-types';
import { WorldResourceAuthorizer } from '../../packages/game-core/src/server/harness/world-authorization';
import { ItemIds } from '../../packages/game-core/src/server/gameplay/item-registry';
import { Voxel } from '../../packages/game-core/src/world/voxel';
import { testCorePlatform } from '../support/core-platform';

type Position = [number, number, number];

const key = (position: Position) => position.join(',');

const commit = (worldRevision: number, committed: boolean): WorldCommitResult => ({
  committed,
  worldRevision,
  structuralChange: null,
  semanticEvents: [],
  metrics: {
    timingStatus: 'not-collected-hot-path',
    inputMutationCount: 1,
    canonicalWriteCount: Number(committed),
    dirtyChunkCount: Number(committed),
    meshInvalidationCount: Number(committed),
    structuralEventCount: committed ? 1 : 0,
    semanticEventCount: 0,
    mutationPayloadBytes: 0,
    mutationCapacityBytes: 0,
    validationMs: 0,
    resolveMs: 0,
    applyMs: 0,
    commitMs: 0,
  },
});

class FakeVoxelWorld {
  readonly cells = new Map<string, number>();
  readonly unavailable = new Set<string>();
  readonly edits: Array<{ actorId: string; position: Position; voxel: number }> = [];
  lastCommit: WorldCommitResult | null = null;
  denyEdits = false;
  revision = 0;

  getVoxel = (position: Position): number | undefined =>
    this.unavailable.has(key(position)) ? undefined : (this.cells.get(key(position)) ?? Voxel.Air);

  editVoxel = (actorId: string, position: Position, voxel: number): WorldCommitResult => {
    this.edits.push({ actorId, position: [...position], voxel });
    if (this.denyEdits) return (this.lastCommit = commit(this.revision, false));
    const cell = key(position);
    if (this.getVoxel(position) === voxel) return (this.lastCommit = commit(this.revision, false));
    this.cells.set(cell, voxel);
    this.revision += 1;
    return (this.lastCommit = commit(this.revision, true));
  };
}

const verifiedPack = {
  ...pack,
  integrity: {
    algorithm: 'sha256' as const,
    manifestDigest: 'a'.repeat(64),
    entryDigest: 'b'.repeat(64),
    resources: [],
  },
};

const createRuntime = () => {
  const world = new FakeVoxelWorld();
  const composition = assembleOverworldPacks([verifiedPack]);
  const gameplay = new GameplayRuntime({
    composition,
    platform: testCorePlatform,
    getWorldTime: () => 9,
    getVoxel: world.getVoxel,
    editVoxel: world.editVoxel,
  });
  gameplay.spawnPlayer({ id: 'player', position: [0.5, 1, 0.5] });
  const authorizer = new WorldResourceAuthorizer(
    {
      principals: [{ id: 'human', boundEntityId: 'player' }],
      rules: [
        {
          effect: 'allow',
          principal: { ids: ['human'] },
          resources: ['seedlands.ruleset'],
          operations: ['read'],
          scope: 'any',
        },
        {
          effect: 'allow',
          principal: { ids: ['human'] },
          resources: ['seedlands.mode'],
          operations: ['read', 'write', 'execute'],
          scope: 'self',
        },
      ],
    },
    composition.resources,
  );
  const mode = gameplay.bindModuleOperations(authorizer, {
    moduleId: 'seedlands:mode-module',
    principalId: 'human',
    originalActorId: 'player',
  });
  const enterCreative = () =>
    mode.invoke({
      operationId: 'seedlands:set-mode',
      target: { kind: 'entity', entityId: 'player' },
      input: { mode: 'creative' },
    });
  return { gameplay, world, enterCreative };
};

const expectCommit = (
  result: GameplayResult<{ requiredSeconds: number; commit?: WorldCommitResult }>,
): WorldCommitResult => {
  expect(result).toMatchObject({ success: true, requiredSeconds: 0, commit: { committed: true } });
  if (!result.success || !result.commit) throw new Error('Expected an immediate creative world commit.');
  return result.commit;
};

describe('creative block interactions through GameplayRuntime', () => {
  it('places from the creative catalog without selecting or consuming survival inventory', () => {
    const { gameplay, world, enterCreative } = createRuntime();
    gameplay.giveItem('player', { itemId: ItemIds.DirtBlock, count: 2 });
    const survivalInventory = gameplay.getInventory('player');
    expect(enterCreative()).toMatchObject({ ok: true });

    expect(gameplay.selectHotbarSlot('player', 3)).toMatchObject({ success: true });
    expect(gameplay.getActorModeState('player')?.creativeCatalog.selectedSlot).toBe(3);
    expect(gameplay.placeVoxel('player', [2, 1, 0])).toMatchObject({ success: true, commit: { committed: true } });

    expect(world.getVoxel([2, 1, 0])).toBe(Voxel.Stone);
    expect(gameplay.getInventory('player')).toEqual(survivalInventory);
  });

  it('breaks immediately, returns the actual commit and creates no survival drop', () => {
    const { gameplay, world, enterCreative } = createRuntime();
    gameplay.giveItem('player', { itemId: ItemIds.DirtBlock, count: 2 });
    world.cells.set(key([1, 1, 0]), Voxel.Wood);
    expect(enterCreative()).toMatchObject({ ok: true });
    const beforeInventory = gameplay.getInventory('player');

    const returned = expectCommit(gameplay.beginBreak('player', [1, 1, 0]));

    expect(returned).toBe(world.lastCommit);
    expect(world.getVoxel([1, 1, 0])).toBe(Voxel.Air);
    expect(gameplay.getPlayerState('player').breakAction).toBeNull();
    expect(gameplay.queryEntities({ type: 'world-item' })).toEqual([]);
    expect(gameplay.getInventory('player')).toEqual(beforeInventory);
  });

  it('keeps unavailable, distant, collision and rejected edits atomic', () => {
    const { gameplay, world, enterCreative } = createRuntime();
    gameplay.giveItem('player', { itemId: ItemIds.DirtBlock, count: 2 });
    expect(enterCreative()).toMatchObject({ ok: true });
    gameplay.selectHotbarSlot('player', 2);
    world.unavailable.add(key([1, 1, 0]));

    let before = gameplay.createSnapshot();
    expect(gameplay.beginBreak('player', [1, 1, 0])).toEqual({ success: false, reason: 'chunk-unavailable' });
    expect(gameplay.createSnapshot()).toEqual(before);
    expect(gameplay.beginBreak('player', [20, 1, 0])).toEqual({ success: false, reason: 'out-of-range' });
    expect(world.edits).toHaveLength(0);

    world.unavailable.delete(key([1, 1, 0]));
    world.cells.set(key([1, 1, 0]), Voxel.Wood);
    world.denyEdits = true;
    before = gameplay.createSnapshot();
    expect(gameplay.beginBreak('player', [1, 1, 0])).toEqual({ success: false, reason: 'world-not-changed' });
    expect(gameplay.createSnapshot()).toEqual(before);
    expect(world.getVoxel([1, 1, 0])).toBe(Voxel.Wood);

    expect(gameplay.placeVoxel('player', [0, 1, 0])).toEqual({ success: false, reason: 'player-collision' });
    expect(world.edits).toHaveLength(1);

    before = gameplay.createSnapshot();
    expect(gameplay.placeVoxel('player', [2, 1, 0])).toEqual({ success: false, reason: 'world-not-changed' });
    expect(gameplay.createSnapshot()).toEqual(before);
    expect(gameplay.getInventory('player').slots[0]).toEqual({ itemId: ItemIds.DirtBlock, count: 2 });
  });

  it('retains survival break timing, tool multiplier, drops and placement consumption', () => {
    const { gameplay, world } = createRuntime();
    gameplay.giveItem('player', { itemId: ItemIds.WoodAxe, count: 1 });
    gameplay.giveItem('player', { itemId: ItemIds.WoodBlock, count: 2 });
    world.cells.set(key([1, 1, 0]), Voxel.Wood);

    expect(gameplay.beginBreak('player', [1, 1, 0])).toMatchObject({ success: true, requiredSeconds: 0.4 });
    expect(gameplay.advanceRules(0.39).commits).toEqual([]);
    expect(world.getVoxel([1, 1, 0])).toBe(Voxel.Wood);
    expect(gameplay.advanceRules(0.01).commits).toHaveLength(1);
    expect(world.getVoxel([1, 1, 0])).toBe(Voxel.Air);
    expect(gameplay.queryEntities({ type: 'world-item' })).toContainEqual(
      expect.objectContaining({ stack: { itemId: ItemIds.WoodBlock, count: 1 } }),
    );

    expect(gameplay.selectHotbarSlot('player', 1)).toEqual({ success: true });
    expect(gameplay.placeVoxel('player', [2, 1, 0])).toMatchObject({ success: true });
    expect(world.getVoxel([2, 1, 0])).toBe(Voxel.Wood);
    expect(gameplay.getInventory('player').slots[1]).toEqual({ itemId: ItemIds.WoodBlock, count: 1 });
  });
});
