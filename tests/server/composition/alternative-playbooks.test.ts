import { expect, it } from 'vitest';
import { assembleProductPacks, type VerifiedPackArtifact } from '@seedlands/game-core/server/composition/host-api';
import { HeadlessSession } from '../../../packages/game-core/src/server/headless/headless-session';
import { pack as clicked } from '../../../changes/2026-09-09-composable-overworld-playbook/examples/click-conversion';
import { pack as builder } from '../../../changes/2026-09-09-composable-overworld-playbook/examples/builder';
import { testCorePlatform } from '../../support/core-platform';

const artifact = (pack: typeof clicked): VerifiedPackArtifact => ({
  ...pack,
  integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
});

it('独立点击转换 Pack 只匹配选中槽，真实正常输入消费与产出，不加载默认合成/Combat/Needs', async () => {
  const createComposition = () => assembleProductPacks([artifact(clicked)]);
  const composition = createComposition();
  expect(composition.definitionMap.modules.map((entry) => entry.id)).not.toContain('seedlands:recipe-crafting-module');
  expect(composition.definitionMap.modules.map((entry) => entry.id)).not.toContain('seedlands:combat-module');
  expect(composition.definitionMap.modules.map((entry) => entry.id)).not.toContain('seedlands:needs-module');
  const session = await HeadlessSession.create({
    seedText: 'alternative-click-playbook',
    platform: testCorePlatform,
    createComposition,
  });
  try {
    await session.world.clock({ kind: 'pause' });
    const server = session.runtime.server,
      actorId = session.runtime.playerId;
    expect(server.queryEntities().filter((entity) => entity.id !== actorId)).toHaveLength(0);
    expect(server.getInventory(actorId).slots.every((slot) => slot === null)).toBe(true);
    const edits = [];
    for (let x = -2; x <= 2; x++)
      for (let z = -2; z <= 2; z++) {
        edits.push({ x, y: 59, z, value: 3 });
        for (let y = 60; y < 64; y++) edits.push({ x, y, z, value: 0 });
      }
    edits.push({ x: 0, y: 60, z: 0, value: 4 });
    server.editBatch({ actorId: 'finite-source-fixture', edits });
    session.runtime.setPlayerPosition([0.5, 60, -1]);
    expect((await session.runtime.performAction({ type: 'begin-break', position: [0, 60, 0] })).result).toMatchObject({
      success: true,
    });
    expect(await session.world.clock({ kind: 'advance', elapsedMs: 300 })).toMatchObject({ ok: true });
    session.runtime.setPlayerPosition([0.5, 60, 0.5]);
    await session.world.clock({ kind: 'advance', elapsedMs: 400 });
    expect(server.getInventory(actorId).slots[0]).toEqual({ itemId: 'sample:wood', count: 1 });
    await session.runtime.performAction({ type: 'select-hotbar', slot: 1 });
    const before = server.getInventory(actorId);
    expect((await session.runtime.performAction({ type: 'craft', recipeId: 'click-convert' })).result).toMatchObject({
      success: false,
    });
    expect(server.getInventory(actorId)).toEqual(before);
    expect(session.runtime.view().craftableRecipeIds).toEqual([]);
    await session.runtime.performAction({ type: 'select-hotbar', slot: 0 });
    expect(session.runtime.view().craftableRecipeIds).toContain('click-convert');
    expect((await session.runtime.performAction({ type: 'craft', recipeId: 'click-convert' })).result).toMatchObject({
      success: true,
    });
    expect(server.getInventory(actorId).slots[0]).toEqual({ itemId: 'sample:stone', count: 2 });
    expect((await session.runtime.performAction({ type: 'place', position: [0, 60, 1] })).result).toMatchObject({
      success: true,
    });
    expect(server.getVoxel(0, 60, 1)).toBe(3);
  } finally {
    await session.dispose();
  }
});

it('无 Combat/Needs/合成/生态的建造 Playbook 可正常创建、拒绝合成并切换创造模式', async () => {
  const session = await HeadlessSession.create({
    seedText: 'alternative-builder-playbook',
    platform: testCorePlatform,
    createComposition: () => assembleProductPacks([artifact(builder)]),
  });
  try {
    await session.world.clock({ kind: 'pause' });
    const server = session.runtime.server,
      actorId = session.runtime.playerId;
    expect(server.queryEntities()).toHaveLength(1);
    const player = server.getEntity(actorId)!;
    const before = server.getInventory(actorId);
    expect(server.listRecipes()).toEqual([]);
    expect((await session.runtime.performAction({ type: 'craft', recipeId: 'planks' })).result).toMatchObject({
      success: false,
    });
    await session.world.clock({ kind: 'advance', elapsedMs: 30000 });
    expect(server.getInventory(actorId)).toEqual(before);
    expect(server.getEntity(actorId)?.health).toBe(player.health);
    expect(await session.world.command({ type: 'set-mode', mode: 'creative' })).toMatchObject({
      ok: true,
      data: { success: true },
    });
  } finally {
    await session.dispose();
  }
});
