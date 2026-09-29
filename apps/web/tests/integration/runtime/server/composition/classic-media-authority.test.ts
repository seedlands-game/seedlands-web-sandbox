import { describe, expect, it } from 'vitest';
import type { AuthorityRuntime } from '../../../../../../../packages/stdlib/src/server/authority/authority-runtime';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { MemoryGamePersistence } from '../../../../../../../packages/stdlib/src/server/persistence/memory-game-persistence';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { MEDIA_ACTIVATE_OPERATION, MEDIA_STOP_OPERATION } from '@seedlands/stdlib/mod-api';
import { createClassicDoorAuthority as create, loadClassicDoorCells as load } from './classic-door-authority-fixture';

const position = [1, 30, 0] as [number, number, number];
const action = (runtime: AuthorityRuntime) => {
  const player = runtime.server.getPlayerState(runtime.playerId);
  const inventory = runtime.server.getInventoryPointerView(runtime.playerId);
  return {
    type: 'interact' as const,
    intent: 'use' as const,
    target: { kind: 'voxel' as const, hit: position, adjacent: [1, 30, 1] as [number, number, number] },
    expectedSelection: {
      inventoryRevision: inventory.revision,
      modeRevision: player.mode!.revision,
      creativeCatalogRevision: player.creativeCatalog!.revision,
      selectedSlot: player.selectedSlot,
    },
  };
};

describe('Classic Media Authority integration', () => {
  it('exposes the jukebox and record-13 through the formal creative catalog', async () => {
    const runtime = await create(undefined, [1.5, 30, 2.5]);
    const catalog = runtime.ready().gameplay.items!.map(({ id }) => id);
    expect(catalog).toEqual(expect.arrayContaining(['jukebox', 'record-13']));
  });

  it('inserts and starts in one interact, then ejects into inventory with one fact per transaction', async () => {
    const runtime = await create(undefined, [1.5, 30, 2.5]);
    await load(runtime, [{ x: position[0], y: position[1], z: position[2], value: Voxel.Jukebox }]);
    runtime.server.giveItem(runtime.playerId, { itemId: 'record-13', count: 1 });

    const inserted = await runtime.performAction(action(runtime));
    expect(inserted.result, JSON.stringify(inserted.result)).toMatchObject({
      success: true,
      handled: true,
      value: { kind: 'insert-and-activate', playing: true, revision: 1 },
    });
    expect(runtime.server.getInventory(runtime.playerId).slots.filter(Boolean)).toEqual([]);
    expect(inserted.gameplay.media).toMatchObject([{ revision: 1, playing: true, resumePending: false }]);
    expect(runtime.takeMediaFacts('classic-world')).toMatchObject([
      {
        facts: [
          {
            kind: 'insert-and-activate',
            device: { position, definitionId: 'seedlands:jukebox' },
            resource: {
              packId: 'seedlands:overworld',
              path: 'playbooks/classic/assets/audio/to-far-shores.mp3',
            },
          },
        ],
      },
    ]);
    expect(runtime.takeMediaFacts('classic-world')).toEqual([]);

    const ejected = await runtime.performAction(action(runtime));
    expect(ejected.result).toMatchObject({ success: true, handled: true, value: { kind: 'eject', playing: false } });
    expect(runtime.server.getInventory(runtime.playerId).slots.filter(Boolean)).toEqual([
      { itemId: 'record-13', count: 1 },
    ]);
    expect(ejected.gameplay.media).toMatchObject([{ revision: 2, slot: null, playing: false }]);
    expect(runtime.takeMediaFacts('classic-world')).toMatchObject([{ facts: [{ kind: 'eject', revision: 2 }] }]);
  });

  it('stops and ejects exactly one record when ordinary mining destroys a playing jukebox', async () => {
    const runtime = await create(undefined, [1.5, 30, 2.5]);
    await load(runtime, [{ x: position[0], y: position[1], z: position[2], value: Voxel.Jukebox }]);
    runtime.server.giveItem(runtime.playerId, { itemId: 'record-13', count: 1 });
    const inserted = await runtime.performAction(action(runtime));
    expect(inserted.result, JSON.stringify(inserted.result)).toMatchObject({ success: true });
    runtime.takeMediaFacts('classic-world');

    expect(runtime.server.beginBreak(runtime.playerId, position)).toMatchObject({ success: true });
    expect(runtime.server.advanceGameplayRules(2).commits).toHaveLength(1);
    expect(runtime.server.getVoxel(...position)).toBe(Voxel.Air);
    expect(runtime.view().media).toEqual([]);
    expect(
      runtime.server
        .queryEntities({ type: 'world-item' })
        .map(({ stack }) => stack?.itemId)
        .sort(),
    ).toEqual(['jukebox', 'record-13']);
    const removed = runtime.takeMediaFacts('classic-world');
    expect(removed).toMatchObject([
      { facts: [{ kind: 'eject', device: { position, definitionId: 'seedlands:jukebox' }, revision: 2 }] },
    ]);
    expect(runtime.server.advanceGameplayRules(2).commits).toHaveLength(0);
    expect(runtime.server.queryEntities({ type: 'world-item' })).toHaveLength(2);
    expect(runtime.takeMediaFacts('classic-world')).toEqual([]);

    await load(runtime, [{ x: position[0], y: position[1], z: position[2], value: Voxel.Jukebox }]);
    runtime.server.giveItem(runtime.playerId, { itemId: 'record-13', count: 1 });
    const rebuilt = await runtime.performAction(action(runtime));
    expect(rebuilt.result).toMatchObject({ success: true, value: { kind: 'insert-and-activate', playing: true } });
    const replay = runtime.takeMediaFacts('classic-world');
    expect(replay).toHaveLength(1);
    expect(replay[0]!.facts[0]!.revision).toBeGreaterThan(removed[0]!.facts[0]!.revision);
  });

  it('rejects mining before any removal owner applies when committed fact capacity is exhausted', async () => {
    const runtime = await create(undefined, [1.5, 30, 2.5]);
    await load(runtime, [{ x: position[0], y: position[1], z: position[2], value: Voxel.Jukebox }]);
    runtime.server.giveItem(runtime.playerId, { itemId: 'record-13', count: 1 });
    expect((await runtime.performAction(action(runtime))).result).toMatchObject({ success: true });
    for (let revision = 1; revision < 256; revision += 1) {
      const operationId = revision % 2 === 1 ? MEDIA_STOP_OPERATION : MEDIA_ACTIVATE_OPERATION;
      expect(
        runtime.server.invokeActorModuleOperation(runtime.playerId, {
          operationId,
          target: { kind: 'voxel', position },
          input: { expectedRevision: revision },
        }),
      ).toMatchObject({ ok: true });
    }
    expect(runtime.server.beginBreak(runtime.playerId, position)).toMatchObject({ success: true });
    const before = {
      voxel: runtime.server.getVoxel(...position),
      media: structuredClone(runtime.view().media),
      inventory: structuredClone(runtime.server.getInventory(runtime.playerId)),
      items: structuredClone(runtime.server.queryEntities({ type: 'world-item' })),
      worldRevision: runtime.server.worldRevision,
    };

    expect(() => runtime.server.advanceGameplayRules(2)).toThrow(/fact queue capacity/i);
    expect(runtime.server.getVoxel(...position)).toBe(before.voxel);
    expect(runtime.view().media).toEqual(before.media);
    expect(runtime.server.getInventory(runtime.playerId)).toEqual(before.inventory);
    expect(runtime.server.queryEntities({ type: 'world-item' })).toEqual(before.items);
    expect(runtime.server.worldRevision).toBe(before.worldRevision);
    expect(runtime.takeMediaFacts('classic-world')).toHaveLength(256);
  });

  it('pins an occupied media Chunk until ordinary removal commits', async () => {
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    const runtime = await create(persistence, [1.5, 30, 2.5]);
    await load(runtime, [{ x: position[0], y: position[1], z: position[2], value: Voxel.Jukebox }]);
    runtime.server.giveItem(runtime.playerId, { itemId: 'record-13', count: 1 });
    expect((await runtime.performAction(action(runtime))).result).toMatchObject({ success: true });
    await runtime.server.save();
    runtime.server.setPhysicsActiveChunks([]);
    runtime.server.setFluidActiveChunks([]);
    expect(await runtime.server.evictChunk(0, 0, 0)).toBe(false);

    expect(runtime.server.beginBreak(runtime.playerId, position)).toMatchObject({ success: true });
    expect(runtime.server.advanceGameplayRules(2).commits).toHaveLength(1);
    await runtime.server.save();
    runtime.server.setPhysicsActiveChunks([]);
    runtime.server.setFluidActiveChunks([]);
    expect(await runtime.server.evictChunk(0, 0, 0)).toBe(true);
  });
});
