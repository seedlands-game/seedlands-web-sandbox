import { expect, it } from 'vitest';
import { HeadlessSession } from '../../../../../../../packages/stdlib/src/server/headless/headless-session';
import { createClassicComposition } from '../../../../fixtures/classic/content';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';

it('Classic 的正式操作恢复生命，玩家饥饿关闭，保存后不复制食物', async () => {
  const session = await HeadlessSession.create({
    seedText: 'classic-health-food',
    platform: testCorePlatform,
    createComposition: createClassicComposition,
  });
  try {
    await session.world.clock({ kind: 'pause' });
    const player = session.runtime.playerId;
    const server = session.runtime.server;
    expect((await session.executeLine('/give berry 2')).result.success).toBe(true);
    const full = await session.runtime.performAction({ type: 'use-inventory', slot: 0 });
    expect(full.result).toMatchObject({ success: false });
    expect(server.getInventory(player).slots[0]?.count).toBe(2);
    expect(await session.world.command({ type: 'apply-damage', amount: 7 })).toMatchObject({
      ok: true,
      data: { success: true },
    });
    expect((await session.runtime.performAction({ type: 'use-inventory', slot: 0 })).result).toMatchObject({
      success: true,
    });
    expect(server.getPlayerState(player).health).toBe(17);
    expect(server.getPlayerState(player).hunger).toBe(20);
    expect(server.getInventory(player).slots[0]?.count).toBe(1);
    expect(await session.world.command({ type: 'set-mode', mode: 'creative' })).toMatchObject({
      ok: true,
      data: { success: true },
    });
    expect((await session.executeLine('/creative-slot 8 plank')).result.success).toBe(true);
    expect((await session.runtime.performAction({ type: 'select-hotbar', slot: 8 })).result).toMatchObject({
      success: true,
    });
    expect(await session.world.command({ type: 'select-slot', slot: 8 })).toMatchObject({
      ok: true,
      data: { success: true },
    });
    expect(server.getActorModeState(player)?.creativeCatalog.selectedSlot).toBe(8);
    expect(await session.world.command({ type: 'set-mode', mode: 'survival' })).toMatchObject({
      ok: true,
      data: { success: true },
    });
    const saved = await session.world.checkpoint({ kind: 'export' });
    if (!saved.ok || !saved.data.snapshot) throw new Error('Missing saved state');
    expect(await session.world.checkpoint({ kind: 'restore', snapshot: saved.data.snapshot })).toMatchObject({
      ok: true,
    });
    expect(session.runtime.server.getPlayerState(player).health).toBe(17);
    expect(session.runtime.server.getInventory(player).slots[0]?.count).toBe(1);
  } finally {
    await session.dispose();
  }
}, 30_000);
