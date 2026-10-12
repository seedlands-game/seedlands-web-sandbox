import { expect, it, vi } from 'vitest';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { AuthorityRuntime } from '../../../../../../../packages/stdlib/src/server/authority/authority-runtime';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { classicWorldgenProvider } from '@seedlands/playbook-classic/worldgen';
import { classicOptions } from '../../../../fixtures/classic/content';
import { MemoryGamePersistence } from '../../../../../../../packages/stdlib/src/server/persistence/memory-game-persistence';
import predecessor from '../../../../fixtures/classic/pre-boat-production-v4.json';
import { itemInteractionSelection } from '../../../../../src/app/player/secondary-interaction';

const create = async () => {
  const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
  const options = {
    ...classicOptions(),
    worldgenProvider: classicWorldgenProvider,
    platform: testCorePlatform,
    seedText: 'classic-boat-production',
    initialWorldTime: 8,
    startTimeMs: 0,
    initialPlayerBodyPosition: [2.5, 32.6, 2.5] as [number, number, number],
    persistence,
  };
  const runtime = await AuthorityRuntime.create({ ...options, epoch: 'classic-boat-production' });
  const edits = [];
  for (let x = -3; x <= 8; x++)
    for (let z = -3; z <= 8; z++)
      for (let y = 30; y <= 36; y++)
        edits.push({ x, y, z, value: y === 30 ? Voxel.Stone : y === 31 ? Voxel.Water : Voxel.Air });
  edits.push({ x: 2, y: 31, z: 2, value: Voxel.Stone });
  expect((await runtime.editWorld('boat-water-site', edits)).committed).toBe(true);
  runtime.server.giveItem(runtime.playerId, { itemId: 'boat', count: 1 });
  return { runtime, options };
};
const deploy = async (runtime: AuthorityRuntime, hit: readonly [number, number, number] = [2, 31, 0]) => {
  const invocation = vi.spyOn(runtime.server, 'invokeActorModuleOperation');
  try {
    const deployed = await runtime.performAction({
      type: 'interact',
      intent: 'use',
      target: { kind: 'voxel', hit, adjacent: [hit[0], hit[1] + 1, hit[2]] },
      expectedSelection: itemInteractionSelection(runtime.view()),
    });
    const rejected = invocation.mock.results.flatMap(({ value }) =>
      value?.ok === false ? [{ code: value.code, message: value.message }] : [],
    );
    expect(rejected, JSON.stringify(rejected)).toEqual([]);
    return deployed;
  } finally {
    invocation.mockRestore();
  }
};

it('restores persisted terrain across the configured boat footprint before its first physics tick', async () => {
  const { runtime, options } = await create();
  await deploy(runtime);
  const saved = runtime.view().transports![0]!;
  expect(runtime.server.peekLoadedVoxel(2, 31, -1)?.voxel).toBe(Voxel.Water);
  await runtime.persistPortableCheckpoint(runtime.exportPortableCheckpoint());
  const restored = await AuthorityRuntime.create({ ...options, epoch: 'boat-footprint-ready' });
  expect(restored.view().transports![0]!.pose).toEqual(saved.pose);
  expect(restored.server.peekLoadedVoxel(2, 31, -1)?.voxel).toBe(Voxel.Water);
  expect(restored.server.peekLoadedVoxel(2, 31, 0)?.voxel).toBe(Voxel.Water);
});
const input = (runtime: AuthorityRuntime, moveX: number, moveZ: number, sequence: number) => {
  const snapshot = runtime.snapshot();
  expect(
    runtime.receiveInput({
      kind: 'input',
      protocolVersion: 1,
      epoch: snapshot.epoch,
      stream: 'player-input',
      sequence,
      targetPhysicsTick: snapshot.physicsTick + 1,
      issuedAtMs: snapshot.activeTimeMs + 1,
      movementRevision: snapshot.player.movement!.revision,
      state: { moveX, moveZ, verticalIntent: 0, jumpHeld: false },
      edges: { jumpPressed: false },
    }),
  ).toBe('accepted');
  runtime.advanceSession(500);
};
it('restores a moving boat before normal physics resumes across a chunk boundary', async () => {
  const { runtime, options } = await create();
  await deploy(runtime);
  const carrier = runtime.view().transports![0]!;
  expect(
    (
      await runtime.performAction({
        type: 'interact',
        intent: 'use',
        target: { kind: 'entity', reference: carrier.reference },
        expectedSelection: itemInteractionSelection(runtime.view()),
      })
    ).result,
  ).toMatchObject({ success: true });
  input(runtime, 0, 1, 0);
  const saved = runtime.view().transports![0]!;
  expect(Math.hypot(saved.velocity[0], saved.velocity[2])).toBeGreaterThan(0);
  await runtime.persistPortableCheckpoint(runtime.exportPortableCheckpoint());
  const restored = await AuthorityRuntime.create({ ...options, epoch: 'moving-boat-restored' });
  const before = restored.view().transports![0]!;
  expect(before.velocity).toEqual(saved.velocity);
  expect(before.pose).toEqual(saved.pose);
  const advanced = restored.advanceSession(100);
  expect(advanced.lanes.physicsSteps).toBeGreaterThan(0);
  const after = restored.view().transports![0]!;
  expect(after.pose.position[2], JSON.stringify({ before, after, paused: advanced.snapshot.paused })).toBeGreaterThan(
    before.pose.position[2],
  );
  expect(Math.hypot(after.velocity[0], after.velocity[2])).toBeGreaterThan(0);
});
it('正式 Classic 船仅在水面原子部署，地面拒绝保留库存与实体', async () => {
  const { runtime } = await create();
  expect(runtime.view().fluidTargetItems).toContainEqual({ itemId: 'boat', policy: 'fluid-surface' });
  const before = runtime.exportPortableCheckpoint().gameplay;
  expect(
    (
      await runtime.performAction({
        type: 'interact',
        intent: 'use',
        target: { kind: 'voxel', hit: [2, 31, 2], adjacent: [2, 32, 2] },
        expectedSelection: itemInteractionSelection(runtime.view()),
      })
    ).result,
  ).toMatchObject({ success: false });
  expect(runtime.exportPortableCheckpoint().gameplay).toEqual(before);
  const deployed = await deploy(runtime);
  expect(deployed.result, JSON.stringify(deployed.result)).toMatchObject({ success: true, handled: true });
  expect(runtime.view().transports).toHaveLength(1);
  expect(runtime.view().transports![0]).toMatchObject({
    definitionId: 'seedlands:boat',
    rider: null,
    pose: { position: [2.5, 31.8, 0.5], yaw: 0 },
  });
  const player = runtime.view().player;
  expect(runtime.server.getInventoryPointerView(runtime.playerId).slots[player.selectedSlot]).toBeNull();
});
it('正式船使用 Authority 输入前进和转向，安全下车及保存重开保持载具', async () => {
  const { runtime, options } = await create();
  const deployed = await deploy(runtime);
  expect(deployed.result, JSON.stringify(deployed.result)).toMatchObject({ success: true });
  const carrier = runtime.view().transports![0]!;
  expect(
    (
      await runtime.performAction({
        type: 'interact',
        intent: 'use',
        target: { kind: 'entity', reference: carrier.reference },
        expectedSelection: itemInteractionSelection(runtime.view()),
      })
    ).result,
  ).toMatchObject({ success: true });
  input(runtime, 0, 1, 0);
  const forward = runtime.view().transports![0]!;
  expect(forward.pose.position[2]).toBeGreaterThan(carrier.pose.position[2] + 0.05);
  input(runtime, 1, 1, 1);
  const steered = runtime.view().transports![0]!;
  expect(steered.pose.yaw).toBeGreaterThan(0);
  expect(runtime.server.getEntity(runtime.playerId)!.position).toEqual([
    steered.pose.position[0],
    steered.pose.position[1] + 0.45,
    steered.pose.position[2],
  ]);
  const shore = [0, 1, 2, 3].map((z) => ({ x: 4, y: 31, z, value: Voxel.Stone }));
  expect((await runtime.editWorld('boat-safe-shore', shore)).committed).toBe(true);
  const exit = await runtime.performAction({
    type: 'interact',
    intent: 'alternate',
    target: { kind: 'self' },
    expectedSelection: itemInteractionSelection(runtime.view()),
  });
  expect(exit.result, JSON.stringify(exit.result)).toMatchObject({ success: true });
  const saved = runtime.view().transports![0]!;
  expect(saved.rider).toBeNull();
  await runtime.persistPortableCheckpoint(runtime.exportPortableCheckpoint());
  const restored = await AuthorityRuntime.create({ ...options, epoch: 'classic-boat-restored' });
  expect(restored.view().transports![0]).toMatchObject({
    definitionId: 'seedlands:boat',
    pose: saved.pose,
    rider: null,
  });
  expect(restored.view().transports![0]!.reference).toEqual({ ...saved.reference, epoch: saved.reference.epoch + 1 });
});

it('正式前一组合的非空矿车存档在增加船定义后恢复且拒绝篡改身份', async () => {
  const options = {
    ...classicOptions(),
    worldgenProvider: classicWorldgenProvider,
    platform: testCorePlatform,
    seedText: predecessor.seedText,
    initialWorldTime: 8,
    startTimeMs: 0,
  };
  const previousCarrier = predecessor.gameplay.entityStore.transports[0];
  const restored = await AuthorityRuntime.create({
    ...options,
    epoch: 'pre-boat-restored',
    persistence: new MemoryGamePersistence({
      clone: structuredClone,
      rawGameplaySnapshot: structuredClone(predecessor.gameplay),
    }),
  });
  expect(restored.view().transports).toHaveLength(1);
  expect(restored.view().transports![0]!.definitionId).toBe('seedlands:minecart');
  expect(restored.view().transports![0]!.pose.position).toEqual([2.5, 31, 0.5]);
  expect(previousCarrier).toBeDefined();
  const tampered = structuredClone(predecessor.gameplay);
  tampered.composition.packLock[0]!.integrity.entryDigest = '0'.repeat(64);
  await expect(
    AuthorityRuntime.create({
      ...options,
      epoch: 'pre-boat-tampered',
      persistence: new MemoryGamePersistence({ clone: structuredClone, rawGameplaySnapshot: tampered }),
    }),
  ).rejects.toThrow(/composition|identity|predecessor/i);
});

it('正式船遇非水支撑停止，反向输入仍经过同一水面验证', async () => {
  const { runtime } = await create();
  expect((await deploy(runtime)).result).toMatchObject({ success: true });
  const carrier = runtime.view().transports![0]!;
  expect(
    (
      await runtime.performAction({
        type: 'interact',
        intent: 'use',
        target: { kind: 'entity', reference: carrier.reference },
        expectedSelection: itemInteractionSelection(runtime.view()),
      })
    ).result,
  ).toMatchObject({ success: true });
  input(runtime, 0, -1, 0);
  expect(runtime.view().transports![0]!.pose.position[2]).toBeLessThan(carrier.pose.position[2] - 0.05);
  const before = runtime.view().transports![0]!.pose;
  const edits = [];
  for (let x = -2; x <= 6; x++) for (let z = -3; z <= 4; z++) edits.push({ x, y: 31, z, value: Voxel.Air });
  expect((await runtime.editWorld('boat-support-removed', edits)).committed).toBe(true);
  input(runtime, 0, -1, 1);
  expect(runtime.view().transports![0]!.pose).toEqual(before);
  expect(runtime.view().transports![0]!.velocity).toEqual([0, 0, 0]);
});
it('正式船与骑乘者前进时由 Stone 墙共同阻挡而不穿墙', async () => {
  const { runtime } = await create();
  const edits: { x: number; y: number; z: number; value: number }[] = [{ x: 2, y: 31, z: 2, value: Voxel.Water }];
  for (let x = -1; x <= 5; x++) for (let y = 32; y <= 35; y++) edits.push({ x, y, z: 2, value: Voxel.Stone });
  expect((await deploy(runtime)).result).toMatchObject({ success: true });
  const carrier = runtime.view().transports![0]!;
  expect(
    (
      await runtime.performAction({
        type: 'interact',
        intent: 'use',
        target: { kind: 'entity', reference: carrier.reference },
        expectedSelection: itemInteractionSelection(runtime.view()),
      })
    ).result,
  ).toMatchObject({ success: true });
  expect((await runtime.editWorld('boat-wall', edits)).committed).toBe(true);
  for (let sequence = 0; sequence < 10; sequence++) input(runtime, 0, 1, sequence);
  const blocked = runtime.view().transports![0]!;
  expect(blocked.pose.position[2]).toBeGreaterThan(carrier.pose.position[2]);
  expect(blocked.pose.position[2] + 0.75).toBeLessThanOrEqual(2 + 1e-7);
  expect(runtime.server.getEntity(runtime.playerId)!.position[2] + 0.3).toBeLessThanOrEqual(2 + 1e-7);
});

it('正式船没有已加载安全出口时拒绝下车并保留骑乘关系', async () => {
  const { runtime } = await create();
  expect((await deploy(runtime)).result).toMatchObject({ success: true });
  const carrier = runtime.view().transports![0]!;
  expect(
    (
      await runtime.performAction({
        type: 'interact',
        intent: 'use',
        target: { kind: 'entity', reference: carrier.reference },
        expectedSelection: itemInteractionSelection(runtime.view()),
      })
    ).result,
  ).toMatchObject({ success: true });
  const before = runtime.exportPortableCheckpoint().gameplay;
  const result = await runtime.performAction({
    type: 'interact',
    intent: 'alternate',
    target: { kind: 'self' },
    expectedSelection: itemInteractionSelection(runtime.view()),
  });
  expect(result.result).toMatchObject({ success: false, message: 'no-safe-exit' });
  expect(runtime.exportPortableCheckpoint().gameplay).toEqual(before);
});
it('正式船拒绝已加载 Lava 表面且不消耗物品', async () => {
  const { runtime } = await create();
  expect((await runtime.editWorld('boat-lava-site', [{ x: 2, y: 31, z: 0, value: Voxel.Lava }])).committed).toBe(true);
  const before = runtime.exportPortableCheckpoint().gameplay;
  const result = await runtime.performAction({
    type: 'interact',
    intent: 'use',
    target: { kind: 'voxel', hit: [2, 31, 0], adjacent: [2, 32, 0] },
    expectedSelection: itemInteractionSelection(runtime.view()),
  });
  expect(result.result).toMatchObject({ success: false });
  expect(runtime.exportPortableCheckpoint().gameplay).toEqual(before);
});
