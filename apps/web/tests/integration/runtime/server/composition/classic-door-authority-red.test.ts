import { describe, expect, it } from 'vitest';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { classicWoodenDoorDefinition } from '../../../../../../../playbooks/classic/src/structures';
import { CLASSIC_WOODEN_DOOR_LEGACY_STORAGE_ID } from '../../../../../../../playbooks/classic/src/structures';
import { MemoryGamePersistence } from '../../../../../../../packages/stdlib/src/server/persistence/memory-game-persistence';
import {
  acceptClassicDoorChunk as acceptChunk,
  classicDoorKernelOwner as kernelOwner,
  createClassicDoorAuthority as create,
  createClassicDoorAuthorityWithUnavailableChunks as createWithUnavailableChunks,
  interactWithClassicDoor as interact,
  loadClassicDoorCells as load,
} from './classic-door-authority-fixture';

describe('V1.4 final Authority RED for the Classic two-part door', () => {
  it('places the initial door as one authoritative two-cell structure commit', async () => {
    const runtime = await create();
    await load(runtime, [
      { x: 1, y: 30, z: 0, value: Voxel.Stone },
      { x: 1, y: 31, z: 0, value: Voxel.Air },
      { x: 1, y: 32, z: 0, value: Voxel.Air },
    ]);
    runtime.server.giveItem(runtime.playerId, { itemId: 'wooden-door', count: 1 });
    const response = await runtime.performAction(interact(runtime, [1, 30, 0], [1, 31, 0]));

    expect(response.result).toMatchObject({ success: true });
    expect(response.commits).toHaveLength(1);
    expect(response.commits[0]?.structuralChange?.mutationCount).toBe(2);
    const east = classicWoodenDoorDefinition.states.find(({ id }) => id === 'east-closed')!;
    expect(runtime.server.getVoxel(1, 31, 0)).toBe(east.variants.lower);
    expect(runtime.server.getVoxel(1, 32, 0)).toBe(east.variants.upper);
    expect(runtime.server.getInventory(runtime.playerId).slots.every((slot) => slot?.itemId !== 'wooden-door')).toBe(
      true,
    );
  });

  it.each([
    ['east', [3.5, 31, 0.5] as [number, number, number], [0, 31, 0] as [number, number, number]],
    ['west', [-0.5, 31, 0.5] as [number, number, number], [2, 31, 0] as [number, number, number]],
    ['south', [1.5, 31, 2.5] as [number, number, number], [1, 31, -1] as [number, number, number]],
    ['north', [1.5, 31, -1.5] as [number, number, number], [1, 31, 1] as [number, number, number]],
  ] as const)('places the %s closed state from an authoritative horizontal face', async (bearing, actor, hit) => {
    const runtime = await create(undefined, actor);
    await load(runtime, [
      { x: hit[0], y: hit[1], z: hit[2], value: Voxel.Stone },
      { x: 1, y: 30, z: 0, value: Voxel.Stone },
      { x: 1, y: 31, z: 0, value: Voxel.Air },
      { x: 1, y: 32, z: 0, value: Voxel.Air },
    ]);
    runtime.server.giveItem(runtime.playerId, { itemId: 'wooden-door', count: 1 });

    expect((await runtime.performAction(interact(runtime, hit, [1, 31, 0]))).result).toMatchObject({ success: true });

    const expected = classicWoodenDoorDefinition.states.find(({ id }) => id === `${bearing}-closed`)!;
    expect([runtime.server.getVoxel(1, 31, 0), runtime.server.getVoxel(1, 32, 0)]).toEqual([
      expected.variants.lower,
      expected.variants.upper,
    ]);
  });

  it.each([
    [[-0.5, 31, 0.5] as [number, number, number], [0, 31, 0] as [number, number, number]],
    [[3.5, 31, 0.5] as [number, number, number], [2, 31, 0] as [number, number, number]],
    [[1.5, 31, -1.5] as [number, number, number], [1, 31, -1] as [number, number, number]],
    [[1.5, 31, 2.5] as [number, number, number], [1, 31, 1] as [number, number, number]],
  ] as const)('rejects a forged placement from the back of the selected face', async (actor, hit) => {
    const runtime = await create(undefined, actor);
    await load(runtime, [
      { x: hit[0], y: hit[1], z: hit[2], value: Voxel.Stone },
      { x: 1, y: 30, z: 0, value: Voxel.Stone },
      { x: 1, y: 31, z: 0, value: Voxel.Air },
      { x: 1, y: 32, z: 0, value: Voxel.Air },
    ]);
    runtime.server.giveItem(runtime.playerId, { itemId: 'wooden-door', count: 1 });
    const before = {
      inventory: runtime.server.getInventory(runtime.playerId),
      entities: runtime.server.queryEntities(),
      worldRevision: runtime.server.worldRevision,
      gameplayRevision: runtime.server.gameplayRevision,
      commitSequence: runtime.server.commitSequence,
      lower: runtime.server.getVoxel(1, 31, 0),
      upper: runtime.server.getVoxel(1, 32, 0),
    };

    expect((await runtime.performAction(interact(runtime, hit, [1, 31, 0]))).result).toEqual({
      success: false,
      reason: 'blocked',
    });
    expect({
      inventory: runtime.server.getInventory(runtime.playerId),
      entities: runtime.server.queryEntities(),
      worldRevision: runtime.server.worldRevision,
      gameplayRevision: runtime.server.gameplayRevision,
      commitSequence: runtime.server.commitSequence,
      lower: runtime.server.getVoxel(1, 31, 0),
      upper: runtime.server.getVoxel(1, 32, 0),
    }).toEqual(before);
  });

  it('accepts a top-face placement using actor bearing and rejects bottom-face occupancy without writes', async () => {
    const top = await create(undefined, [1.5, 31, 2.5]);
    await load(top, [
      { x: 1, y: 30, z: 0, value: Voxel.Stone },
      { x: 1, y: 31, z: 0, value: Voxel.Air },
      { x: 1, y: 32, z: 0, value: Voxel.Air },
    ]);
    top.server.giveItem(top.playerId, { itemId: 'wooden-door', count: 1 });
    expect((await top.performAction(interact(top, [1, 30, 0], [1, 31, 0]))).result).toMatchObject({ success: true });
    const north = classicWoodenDoorDefinition.states.find(({ id }) => id === 'north-closed')!;
    expect([top.server.getVoxel(1, 31, 0), top.server.getVoxel(1, 32, 0)]).toEqual([
      north.variants.lower,
      north.variants.upper,
    ]);

    const bottom = await create(undefined, [1.5, 31, 2.5]);
    await load(bottom, [
      { x: 1, y: 30, z: 0, value: Voxel.Stone },
      { x: 1, y: 31, z: 0, value: Voxel.Air },
      { x: 1, y: 32, z: 0, value: Voxel.Stone },
    ]);
    bottom.server.giveItem(bottom.playerId, { itemId: 'wooden-door', count: 1 });
    const before = bottom.server.freezePortableSaveSnapshot();
    expect((await bottom.performAction(interact(bottom, [1, 32, 0], [1, 31, 0]))).result).toMatchObject({
      success: false,
    });
    expect(bottom.server.freezePortableSaveSnapshot()).toEqual(before);
  });

  it('rejects a forged air hit and stale selection before any Structure owner changes', async () => {
    const runtime = await create();
    await load(runtime, [
      { x: 0, y: 31, z: 0, value: Voxel.Air },
      { x: 1, y: 30, z: 0, value: Voxel.Stone },
      { x: 1, y: 31, z: 0, value: Voxel.Air },
      { x: 1, y: 32, z: 0, value: Voxel.Air },
    ]);
    runtime.server.giveItem(runtime.playerId, { itemId: 'wooden-door', count: 2 });
    let before = runtime.server.freezePortableSaveSnapshot();
    expect((await runtime.performAction(interact(runtime, [0, 31, 0], [1, 31, 0]))).result).toMatchObject({
      success: false,
    });
    expect(runtime.server.freezePortableSaveSnapshot()).toEqual(before);

    const stale = interact(runtime, [1, 30, 0], [1, 31, 0]);
    runtime.server.giveItem(runtime.playerId, { itemId: 'stone-block', count: 1 });
    before = runtime.server.freezePortableSaveSnapshot();
    expect((await runtime.performAction(stale)).result).toEqual({ success: false, reason: 'stale-selection' });
    expect(runtime.server.freezePortableSaveSnapshot()).toEqual(before);
  });

  it('routes an existing door before the held water bucket fallback', async () => {
    const runtime = await create();
    const closed = classicWoodenDoorDefinition.states.find(({ id }) => id === 'north-closed')!;
    const open = classicWoodenDoorDefinition.states.find(({ id }) => id === 'north-open')!;
    await load(runtime, [
      { x: 1, y: 30, z: 0, value: Voxel.Stone },
      { x: 1, y: 31, z: 0, value: closed.variants.lower },
      { x: 1, y: 32, z: 0, value: closed.variants.upper },
    ]);
    runtime.server.giveItem(runtime.playerId, { itemId: 'water-bucket', count: 1 });

    expect((await runtime.performAction(interact(runtime, [1, 31, 0], [0, 31, 0]))).result).toMatchObject({
      success: true,
    });
    expect([runtime.server.getVoxel(1, 31, 0), runtime.server.getVoxel(1, 32, 0)]).toEqual([
      open.variants.lower,
      open.variants.upper,
    ]);
    expect(runtime.server.getInventory(runtime.playerId).slots[0]).toEqual({ itemId: 'water-bucket', count: 1 });
  });

  it.each([
    ['valid pair', [CLASSIC_WOODEN_DOOR_LEGACY_STORAGE_ID, CLASSIC_WOODEN_DOOR_LEGACY_STORAGE_ID], true],
    ['isolated lower', [CLASSIC_WOODEN_DOOR_LEGACY_STORAGE_ID, Voxel.Air], false],
    ['three-cell run', [CLASSIC_WOODEN_DOOR_LEGACY_STORAGE_ID, CLASSIC_WOODEN_DOOR_LEGACY_STORAGE_ID], false],
  ] as const)('handles the %s legacy footprint without partial writes', async (label, pair, succeeds) => {
    const runtime = await create();
    await load(runtime, [
      ...(label === 'three-cell run'
        ? [{ x: 1, y: 30, z: 0, value: CLASSIC_WOODEN_DOOR_LEGACY_STORAGE_ID }]
        : [{ x: 1, y: 30, z: 0, value: Voxel.Stone }]),
      { x: 1, y: 31, z: 0, value: pair[0] },
      { x: 1, y: 32, z: 0, value: pair[1] },
    ]);
    const before = runtime.server.freezePortableSaveSnapshot();
    const response = await runtime.performAction(interact(runtime, [1, 31, 0], [0, 31, 0]));

    expect((response.result as { success?: boolean }).success).toBe(succeeds);
    if (!succeeds) expect(runtime.server.freezePortableSaveSnapshot()).toEqual(before);
    else {
      const open = classicWoodenDoorDefinition.states.find(({ id }) => id === 'north-open')!;
      expect([runtime.server.getVoxel(1, 31, 0), runtime.server.getVoxel(1, 32, 0)]).toEqual([
        open.variants.lower,
        open.variants.upper,
      ]);
    }
  });

  it.each([
    ['lower half', [1, 31, 0] as [number, number, number], [0, 31, 0] as [number, number, number]],
    ['upper half', [1, 32, 0] as [number, number, number], [0, 32, 0] as [number, number, number]],
  ])('toggles both parts from the %s through the formal interact action', async (_label, hit, adjacent) => {
    const runtime = await create();
    const closed = classicWoodenDoorDefinition.states.find(({ id }) => id === 'north-closed')!;
    const open = classicWoodenDoorDefinition.states.find(({ id }) => id === 'north-open')!;
    await load(runtime, [
      { x: 1, y: 30, z: 0, value: Voxel.Stone },
      { x: 1, y: 31, z: 0, value: closed.variants.lower },
      { x: 1, y: 32, z: 0, value: closed.variants.upper },
      { x: 0, y: 31, z: 0, value: Voxel.Air },
      { x: 0, y: 32, z: 0, value: Voxel.Air },
    ]);
    const player = runtime.server.getPlayerState(runtime.playerId);
    expect(runtime.server.getInventory(runtime.playerId).slots[player.selectedSlot]).toBeNull();
    const response = await runtime.performAction(interact(runtime, hit, adjacent));

    const result = response.result as { success?: boolean; reason?: string };
    if (result.success === false) {
      if (result.reason === 'no-selected-item' || result.reason === 'item-no-interaction')
        throw new Error(`Structure target-first operation is unavailable: ${result.reason}`);
      throw new Error(`Door toggle fixture failed before the missing structure operation: ${JSON.stringify(result)}`);
    }
    expect(response.result).toMatchObject({ success: true, handled: true });
    expect(response.commits).toHaveLength(1);
    expect(response.commits[0]?.structuralChange?.mutationCount).toBe(2);
    expect(runtime.server.getVoxel(1, 31, 0)).toBe(open.variants.lower);
    expect(runtime.server.getVoxel(1, 32, 0)).toBe(open.variants.upper);
  });

  it('fails a cross-Chunk placement atomically when the upper Chunk is unavailable', async () => {
    const requests: string[] = [];
    const runtime = await createWithUnavailableChunks(requests);
    acceptChunk(runtime, 0, 0, 0);
    await load(runtime, [
      { x: 1, y: 30, z: 0, value: Voxel.Stone },
      { x: 1, y: 31, z: 0, value: Voxel.Air },
    ]);
    runtime.server.giveItem(runtime.playerId, { itemId: 'wooden-door', count: 1 });
    const before = {
      inventory: runtime.server.getInventory(runtime.playerId),
      inventoryRevision: runtime.server.getInventoryPointerView(runtime.playerId).revision,
      worldRevision: runtime.server.worldRevision,
      gameplayRevision: runtime.server.gameplayRevision,
      receiptSequence: runtime.server.commitSequence,
      lowerVoxel: runtime.server.peekLoadedVoxel(1, 31, 0)?.voxel,
      lowerChunkRevision: runtime.server.peekLoadedVoxel(1, 31, 0)?.revision,
      upperVoxel: runtime.server.peekLoadedVoxel(1, 32, 0)?.voxel ?? null,
      upperChunkRevision: runtime.server.peekLoadedVoxel(1, 32, 0)?.revision ?? null,
      drops: runtime.server.queryEntities({ type: 'world-item' }),
    };
    expect(before.lowerChunkRevision).not.toBeUndefined();
    expect(before.upperVoxel).toBeNull();
    expect(before.upperChunkRevision).toBeNull();

    const response = await runtime.performAction(interact(runtime, [1, 30, 0], [1, 31, 0]));

    expect.soft(requests).toEqual(['0,1,0']);
    expect.soft(response.result).toEqual({ success: false, reason: 'chunk-unavailable' });
    expect.soft(response.commits).toEqual([]);
    expect.soft(runtime.server.getInventory(runtime.playerId)).toEqual(before.inventory);
    expect.soft(runtime.server.getInventoryPointerView(runtime.playerId).revision).toBe(before.inventoryRevision);
    expect.soft(runtime.server.worldRevision).toBe(before.worldRevision);
    expect.soft(runtime.server.gameplayRevision).toBe(before.gameplayRevision);
    expect.soft(runtime.server.commitSequence).toBe(before.receiptSequence);
    expect.soft(runtime.server.peekLoadedVoxel(1, 31, 0)?.voxel).toBe(before.lowerVoxel);
    expect.soft(runtime.server.peekLoadedVoxel(1, 31, 0)?.revision).toBe(before.lowerChunkRevision);
    expect.soft(runtime.server.peekLoadedVoxel(1, 32, 0)?.voxel ?? null).toBe(before.upperVoxel);
    expect.soft(runtime.server.peekLoadedVoxel(1, 32, 0)?.revision ?? null).toBe(before.upperChunkRevision);
    expect.soft(runtime.server.queryEntities({ type: 'world-item' })).toEqual(before.drops);
  });

  it.each([
    ['lower', [1, 31, 0] as [number, number, number]],
    ['upper', [1, 32, 0] as [number, number, number]],
  ])('breaks the complete door from the %s half through normal timed mining', async (_label, target) => {
    const runtime = await create();
    const closed = classicWoodenDoorDefinition.states.find(({ id }) => id === 'north-closed')!;
    await load(runtime, [
      { x: 0, y: 30, z: 0, value: Voxel.Stone },
      { x: 1, y: 30, z: 0, value: Voxel.Stone },
      { x: 1, y: 31, z: 0, value: closed.variants.lower },
      { x: 1, y: 32, z: 0, value: closed.variants.upper },
    ]);
    runtime.server.giveItem(runtime.playerId, { itemId: 'wood-axe', count: 1, instance: { durability: 60 } });

    const started = await runtime.performAction({ type: 'begin-break', position: target });
    expect(started.result).toMatchObject({ success: true, requiredSeconds: 0.7 });
    expect(runtime.server.getPlayerState(runtime.playerId).breakAction?.position).toEqual(target);
    const completed = runtime.advanceSession(700);

    expect(completed.commits).toHaveLength(1);
    expect(completed.commits[0]?.structuralChange?.mutationCount).toBe(2);
    expect(runtime.server.getVoxel(1, 31, 0)).toBe(Voxel.Air);
    expect(runtime.server.getVoxel(1, 32, 0)).toBe(Voxel.Air);
    expect(runtime.server.getPlayerState(runtime.playerId).breakAction).toBeNull();
    expect(runtime.server.getInventory(runtime.playerId).slots[0]).toEqual({
      itemId: 'wood-axe',
      count: 1,
      instance: { durability: 59 },
    });
    expect(runtime.server.queryEntities({ type: 'world-item' }).map(({ stack }) => stack)).toEqual([
      { itemId: 'wooden-door', count: 1 },
    ]);
    expect(runtime.advanceSession(1_000).commits).toEqual([]);
  });

  it('breaks both parts immediately in creative without a drop or tool wear', async () => {
    const runtime = await create();
    const closed = classicWoodenDoorDefinition.states.find(({ id }) => id === 'north-closed')!;
    await load(runtime, [
      { x: 1, y: 30, z: 0, value: Voxel.Stone },
      { x: 1, y: 31, z: 0, value: closed.variants.lower },
      { x: 1, y: 32, z: 0, value: closed.variants.upper },
    ]);
    runtime.server.giveItem(runtime.playerId, { itemId: 'wood-axe', count: 1, instance: { durability: 60 } });
    expect(
      runtime.server.invokeActorModuleOperation(runtime.playerId, {
        operationId: 'seedlands:set-mode',
        target: { kind: 'entity', entityId: runtime.playerId },
        input: { mode: 'creative' },
      }),
    ).toMatchObject({ ok: true });

    const response = await runtime.performAction({ type: 'begin-break', position: [1, 32, 0] });

    expect(response.result).toMatchObject({ success: true });
    expect(response.commits).toHaveLength(1);
    expect(runtime.server.getVoxel(1, 31, 0)).toBe(Voxel.Air);
    expect(runtime.server.getVoxel(1, 32, 0)).toBe(Voxel.Air);
    expect(runtime.server.getInventory(runtime.playerId).slots[0]).toEqual({
      itemId: 'wood-axe',
      count: 1,
      instance: { durability: 60 },
    });
    expect(runtime.server.queryEntities({ type: 'world-item' })).toEqual([]);
  });

  it('places in creative from the authoritative catalog without consuming survival inventory', async () => {
    const runtime = await create(undefined, [0.5, 31, 0.5]);
    await load(runtime, [
      { x: 1, y: 30, z: 0, value: Voxel.Stone },
      { x: 1, y: 31, z: 0, value: Voxel.Air },
      { x: 1, y: 32, z: 0, value: Voxel.Air },
    ]);
    runtime.server.giveItem(runtime.playerId, { itemId: 'wooden-door', count: 1 });
    expect(
      runtime.server.invokeActorModuleOperation(runtime.playerId, {
        operationId: 'seedlands:set-mode',
        target: { kind: 'entity', entityId: runtime.playerId },
        input: { mode: 'creative' },
      }),
    ).toMatchObject({ ok: true });
    expect(
      runtime.server.invokeActorModuleOperation(runtime.playerId, {
        operationId: 'seedlands:set-creative-catalog',
        target: { kind: 'entity', entityId: runtime.playerId },
        input: { slot: 0, itemId: 'wooden-door' },
      }),
    ).toMatchObject({ ok: true });
    const before = runtime.server.getInventory(runtime.playerId);

    expect((await runtime.performAction(interact(runtime, [1, 30, 0], [1, 31, 0]))).result).toMatchObject({
      success: true,
    });
    expect(runtime.server.getInventory(runtime.playerId)).toEqual(before);
  });

  it('preserves both parts and tool state after normal mining is explicitly cancelled', async () => {
    const runtime = await create();
    const closed = classicWoodenDoorDefinition.states.find(({ id }) => id === 'north-closed')!;
    await load(runtime, [
      { x: 1, y: 30, z: 0, value: Voxel.Stone },
      { x: 1, y: 31, z: 0, value: closed.variants.lower },
      { x: 1, y: 32, z: 0, value: closed.variants.upper },
    ]);
    runtime.server.giveItem(runtime.playerId, { itemId: 'wood-axe', count: 1, instance: { durability: 60 } });
    expect((await runtime.performAction({ type: 'begin-break', position: [1, 31, 0] })).result).toMatchObject({
      success: true,
    });
    expect((await runtime.performAction({ type: 'cancel-break' })).result).toEqual({ success: true });

    expect(runtime.advanceSession(1_000).commits).toEqual([]);
    expect([runtime.server.getVoxel(1, 31, 0), runtime.server.getVoxel(1, 32, 0)]).toEqual([
      closed.variants.lower,
      closed.variants.upper,
    ]);
    expect(runtime.server.getInventory(runtime.playerId).slots[0]).toEqual({
      itemId: 'wood-axe',
      count: 1,
      instance: { durability: 60 },
    });
    expect(runtime.server.queryEntities({ type: 'world-item' })).toEqual([]);
  });

  it('preflights the normal-mining commit frontier before advancing the accepted break', async () => {
    const runtime = await create();
    const closed = classicWoodenDoorDefinition.states.find(({ id }) => id === 'north-closed')!;
    await load(runtime, [
      { x: 1, y: 30, z: 0, value: Voxel.Stone },
      { x: 1, y: 31, z: 0, value: closed.variants.lower },
      { x: 1, y: 32, z: 0, value: closed.variants.upper },
    ]);
    runtime.server.giveItem(runtime.playerId, { itemId: 'wood-axe', count: 1, instance: { durability: 60 } });
    expect(await runtime.performAction({ type: 'begin-break', position: [1, 31, 0] })).toMatchObject({
      result: { success: true, requiredSeconds: 0.7 },
    });
    const before = {
      lower: runtime.server.getVoxel(1, 31, 0),
      upper: runtime.server.getVoxel(1, 32, 0),
      player: runtime.server.getPlayerState(runtime.playerId),
      inventory: runtime.server.getInventory(runtime.playerId),
      entities: runtime.server.queryEntities(),
      worldRevision: runtime.server.worldRevision,
      gameplayRevision: runtime.server.gameplayRevision,
    };
    kernelOwner(runtime).restoreCommitFrontier(Number.MAX_SAFE_INTEGER, before.worldRevision);

    expect(() => runtime.advanceSession(700)).toThrow(/commit sequence.*exhausted/i);

    expect(runtime.server.getVoxel(1, 31, 0)).toBe(before.lower);
    expect(runtime.server.getVoxel(1, 32, 0)).toBe(before.upper);
    expect(runtime.server.getPlayerState(runtime.playerId)).toEqual(before.player);
    expect(runtime.server.getInventory(runtime.playerId)).toEqual(before.inventory);
    expect(runtime.server.queryEntities()).toEqual(before.entities);
    expect(runtime.server.worldRevision).toBe(before.worldRevision);
    expect(runtime.server.gameplayRevision).toBe(before.gameplayRevision);
    expect(runtime.server.commitSequence).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('restores canonical door variants and the same geometry through the formal save path', async () => {
    const persistence = new MemoryGamePersistence({ clone: structuredClone });
    const source = await create(persistence);
    await load(source, [
      { x: 1, y: 30, z: 0, value: Voxel.Stone },
      { x: 1, y: 31, z: 0, value: Voxel.Air },
      { x: 1, y: 32, z: 0, value: Voxel.Air },
    ]);
    source.server.giveItem(source.playerId, { itemId: 'wooden-door', count: 1 });
    expect((await source.performAction(interact(source, [1, 30, 0], [1, 31, 0]))).result).toMatchObject({
      success: true,
    });
    const before = [source.server.getVoxel(1, 31, 0), source.server.getVoxel(1, 32, 0)];
    await source.save();

    const restored = await create(persistence);
    expect([restored.server.getVoxel(1, 31, 0), restored.server.getVoxel(1, 32, 0)]).toEqual(before);
    expect(restored.server.voxelGeometry?.require(before[0]!).collision).toHaveLength(1);
  });
});
