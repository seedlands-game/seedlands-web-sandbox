import { expect, it } from 'vitest';
import { HeadlessSession } from '@seedlands/stdlib/server/headless/headless-session';
import { createClassicComposition } from '../../../../fixtures/classic/content';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';

it('Browser19 建造前必须离开玩家身体占据的目标格，正式 Authority 拒绝时不扣木板', async () => {
  const session = await HeadlessSession.create({
    seedText: 'browser19-building-clearance',
    platform: testCorePlatform,
    createComposition: createClassicComposition,
  });
  try {
    const runtime = session.runtime;
    expect(
      runtime.server.editBatch({
        actorId: 'building-clearance-fixture',
        edits: [
          { x: 51, y: 30, z: 0, value: 3 },
          { x: 52, y: 30, z: 0, value: 3 },
          { x: 52, y: 31, z: 0, value: 0 },
        ],
      }).committed,
    ).toBe(true);
    expect((await session.executeLine('/give plank 2')).result.success).toBe(true);
    runtime.setPlayerPosition([51.855608088313126, 31.00000041036468, 0.4994040795348187]);
    const before = {
      inventory: runtime.server.getInventoryPointerView(runtime.playerId),
      world: runtime.server.worldRevision,
    };
    expect((await runtime.performAction({ type: 'place', position: [52, 31, 0] })).result).toMatchObject({
      success: false,
      reason: 'player-collision',
    });
    expect(runtime.server.getInventoryPointerView(runtime.playerId)).toEqual(before.inventory);
    expect(runtime.server.worldRevision).toBe(before.world);
    expect(runtime.server.getVoxel(52, 31, 0)).toBe(0);
    // Headless fixture placement mirrors the browser route endpoint; this is an Authority boundary test, not real-input evidence.
    runtime.setPlayerPosition([50.5, 31, 0.5]);
    expect((await runtime.performAction({ type: 'place', position: [52, 31, 0] })).result).toMatchObject({
      success: true,
    });
    expect(runtime.server.getVoxel(52, 31, 0)).toBe(16);
    expect(runtime.server.getInventoryPointerView(runtime.playerId).slots[0]).toMatchObject({
      itemId: 'plank',
      count: 1,
    });
  } finally {
    session.dispose();
  }
});

it('木板由原木合成后可放置，保存重开再挖回时物品守恒', async () => {
  let session = await HeadlessSession.create({
    seedText: 'plank-building',
    platform: testCorePlatform,
    createComposition: createClassicComposition,
  });
  const count = () =>
    session.runtime.server
      .getInventory(session.runtime.playerId)
      .slots.reduce((total, item) => total + (item?.itemId === 'plank' ? item.count : 0), 0);
  try {
    await session.world.clock({ kind: 'pause' });
    await session.world.logic({ kind: 'mode', mode: 'scripted' });
    const edits = [];
    for (let x = -2; x <= 3; x++)
      for (let z = -2; z <= 2; z++) {
        edits.push({ x, y: 59, z, value: 3 });
        for (let y = 60; y < 64; y++) edits.push({ x, y, z, value: 0 });
      }
    expect(session.runtime.server.editBatch({ actorId: 'plank-fixture', edits }).committed).toBe(true);
    session.runtime.setPlayerPosition([0.5, 60, 0.5]);
    expect((await session.executeLine('/give wood-block 1')).result.success).toBe(true);
    expect((await session.runtime.performAction({ type: 'craft', recipeId: 'planks' })).result).toMatchObject({
      success: true,
    });
    expect(count()).toBe(4);
    expect((await session.runtime.performAction({ type: 'select-hotbar', slot: 0 })).result).toMatchObject({
      success: true,
    });
    expect((await session.runtime.performAction({ type: 'place', position: [2, 60, 0] })).result).toMatchObject({
      success: true,
    });
    expect(count()).toBe(3);
    expect(session.runtime.server.getVoxel(2, 60, 0)).toBe(16);
    const saved = await session.world.checkpoint({ kind: 'export' });
    if (!saved.ok || !saved.data.snapshot) throw new Error('Missing checkpoint');
    const previous = session;
    session = await HeadlessSession.create({
      seedText: 'restore-target',
      platform: testCorePlatform,
      createComposition: createClassicComposition,
    });
    expect(await session.world.checkpoint({ kind: 'restore', snapshot: saved.data.snapshot })).toMatchObject({
      ok: true,
    });
    previous.dispose();
    expect(session.runtime.server.getVoxel(2, 60, 0)).toBe(16);
    expect(count()).toBe(3);
    const started = await session.runtime.performAction({ type: 'begin-break', position: [2, 60, 0] });
    expect(started.result).toMatchObject({ success: true });
    const required = (started.result as { requiredSeconds: number }).requiredSeconds;
    expect(await session.world.clock({ kind: 'advance', elapsedMs: (required + 0.2) * 1000 })).toMatchObject({
      ok: true,
    });
    expect(session.runtime.server.getVoxel(2, 60, 0)).toBe(0);
    session.runtime.setPlayerPosition([2.5, 60, 0.5]);
    await session.world.clock({ kind: 'advance', elapsedMs: 300 });
    expect(count()).toBe(4);
  } finally {
    session.dispose();
  }
}, 30_000);
