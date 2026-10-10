import { expect, it } from 'vitest';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { AuthorityRuntime } from '../../../../../../../packages/stdlib/src/server/authority/authority-runtime';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { classicWorldgenProvider } from '@seedlands/playbook-classic/worldgen';
import { classicOptions } from '../../../../fixtures/classic/content';
import { MemoryGamePersistence } from '../../../../../../../packages/stdlib/src/server/persistence/memory-game-persistence';
import baseline from '../../../../fixtures/classic/pre-transport-production-v4.json';
import activeBaseline from '../../../../fixtures/classic/pre-transport-production-active-v4.json';
import { itemInteractionSelection } from '../../../../../src/app/player/secondary-interaction';
import type { LogicObservation } from '../../../../../../../packages/stdlib/src/server/logic/logic-protocol';

it('正式Classic矿车物品use在普通轨道唯一部署，库存和entity同次提交', async () => {
  const observations: LogicObservation[] = [];
  const runtime = await AuthorityRuntime.create({
    ...classicOptions(),
    worldgenProvider: classicWorldgenProvider,
    platform: testCorePlatform,
    epoch: 'classic-minecart-production',
    seedText: 'classic-minecart-production',
    initialWorldTime: 8,
    startTimeMs: 0,
    initialPlayerBodyPosition: [2.5, 32.6, 2.5],
    onLogicObservation: (observation) => observations.push(observation),
  });
  const edits = [];
  for (let x = -1; x <= 5; x++)
    for (let z = -1; z <= 3; z++)
      for (let y = 30; y <= 34; y++) edits.push({ x, y, z, value: y === 30 ? Voxel.Stone : Voxel.Air });
  for (let x = 1; x <= 3; x++) edits.push({ x, y: 31, z: 0, value: Voxel.Rail });
  await expect(runtime.editWorld('classic-minecart-fixture', edits)).resolves.toMatchObject({ committed: true });
  runtime.server.giveItem(runtime.playerId, { itemId: 'minecart', count: 1 });
  const beforeInventory = runtime.server.getInventoryPointerView(runtime.playerId);
  const beforeWorldRevision = runtime.server.worldRevision;
  const beforeGameplayRevision = runtime.server.gameplayRevision;
  const player = runtime.server.getPlayerState(runtime.playerId);
  const untouched = runtime.exportPortableCheckpoint().gameplay;
  const rejectedSelection = await runtime.performAction({
    type: 'interact',
    intent: 'use',
    target: { kind: 'voxel', hit: [2, 31, 0], adjacent: [2, 32, 0] },
    expectedSelection: { ...itemInteractionSelection(runtime.view()), inventoryRevision: beforeInventory.revision + 1 },
  });
  expect(rejectedSelection.result).toMatchObject({ success: false });
  expect(runtime.exportPortableCheckpoint().gameplay).toEqual(untouched);
  const rejectedSite = await runtime.performAction({
    type: 'interact',
    intent: 'use',
    target: { kind: 'voxel', hit: [2, 30, 2], adjacent: [2, 31, 2] },
    expectedSelection: itemInteractionSelection(runtime.view()),
  });
  expect(rejectedSite.result).toMatchObject({ success: false });
  expect(runtime.exportPortableCheckpoint().gameplay).toEqual(untouched);
  const response = await runtime.performAction({
    type: 'interact',
    intent: 'use',
    target: { kind: 'voxel', hit: [2, 31, 0], adjacent: [2, 32, 0] },
    expectedSelection: {
      inventoryRevision: beforeInventory.revision,
      modeRevision: player.mode!.revision,
      creativeCatalogRevision: player.creativeCatalog!.revision,
      selectedSlot: player.selectedSlot,
    },
  });
  expect(response.result).toMatchObject({ success: true, handled: true });
  expect(runtime.view().transports).toHaveLength(1);
  expect(runtime.snapshot().entities.find(({ type }) => type === 'transport')?.bodyAabb).toEqual({
    min: { x: -0.45, y: 0, z: -0.45 },
    max: { x: 0.45, y: 0.7, z: 0.45 },
  });
  expect(runtime.view().transports![0]).toMatchObject({ definitionId: 'seedlands:minecart', rider: null });
  expect(runtime.server.getInventoryPointerView(runtime.playerId).slots[player.selectedSlot]).toBeNull();
  expect(runtime.server.getInventoryPointerView(runtime.playerId).revision).toBe(beforeInventory.revision + 1);
  expect(runtime.server.worldRevision).toBe(beforeWorldRevision);
  expect(runtime.server.gameplayRevision).toBe(beforeGameplayRevision + 1);

  runtime.server.giveItem(runtime.playerId, { itemId: 'minecart', count: 1 });
  const occupiedBefore = runtime.exportPortableCheckpoint().gameplay;
  const occupied = await runtime.performAction({
    type: 'interact',
    intent: 'use',
    target: { kind: 'voxel', hit: [2, 31, 0], adjacent: [2, 32, 0] },
    expectedSelection: itemInteractionSelection(runtime.view()),
  });
  expect(occupied.result).toMatchObject({ success: false });
  expect(runtime.exportPortableCheckpoint().gameplay).toEqual(occupiedBefore);

  const transport = runtime.view().transports![0]!;
  const staleBefore = runtime.exportPortableCheckpoint().gameplay;
  const stale = await runtime.performAction({
    type: 'interact',
    intent: 'use',
    target: { kind: 'entity', reference: { ...transport.reference, lifetime: transport.reference.lifetime + 1 } },
    expectedSelection: itemInteractionSelection(runtime.view()),
  });
  expect(stale.result).toMatchObject({ success: false, reason: 'stale-target-lifetime' });
  expect(runtime.exportPortableCheckpoint().gameplay).toEqual(staleBefore);
  const mounted = await runtime.performAction({
    type: 'interact',
    intent: 'use',
    target: { kind: 'entity', reference: transport.reference },
    expectedSelection: itemInteractionSelection(runtime.view()),
  });
  expect(mounted.result).toMatchObject({ success: true });
  expect(runtime.view().transports![0]!.rider).toEqual(runtime.server.createEntityReference(runtime.playerId));
  const initial = runtime.view().transports![0]!.pose.position;
  const snapshot = runtime.snapshot();
  expect(
    runtime.receiveInput({
      kind: 'input',
      protocolVersion: 1,
      epoch: snapshot.epoch,
      stream: 'player-input',
      sequence: 0,
      targetPhysicsTick: snapshot.physicsTick + 1,
      issuedAtMs: snapshot.activeTimeMs + 1,
      movementRevision: snapshot.player.movement!.revision,
      state: { moveX: 1, moveZ: 0, verticalIntent: 0, jumpHeld: false },
      edges: { jumpPressed: false },
    }),
  ).toBe('accepted');
  runtime.requestLogicObservation();
  runtime.advanceSession(500);
  const moved = runtime.view().transports![0]!;
  const observed = observations.at(-1)!;
  expect(observed.entities.find(({ id }) => id === transport.reference.entityId)).toMatchObject({
    bodyKind: null,
    bodyAabb: { min: { y: 0 }, max: { y: 0.7 } },
  });
  expect(observed.decisionContext.actors.some(({ state }) => state.entityId === transport.reference.entityId)).toBe(
    false,
  );
  expect(moved.pose.position[0]).toBeGreaterThan(initial[0] + 0.05);
  expect(runtime.server.getEntity(runtime.playerId)!.position).toEqual([
    moved.pose.position[0],
    moved.pose.position[1] + 0.55,
    moved.pose.position[2],
  ]);
  const dismounted = await runtime.performAction({
    type: 'interact',
    intent: 'alternate',
    target: { kind: 'self' },
    expectedSelection: itemInteractionSelection(runtime.view()),
  });
  expect(dismounted.result).toMatchObject({ success: true });
  expect(runtime.view().transports![0]!.rider).toBeNull();
});

it('恢复真实09f2803e生产Pack V4身份与空载具基线，保留玩家原lifetime与库存', async () => {
  expect(activeBaseline.checkpoint.gameplay.moduleSchedule.time).toBe(0.15);
  expect(
    activeBaseline.checkpoint.gameplay.moduleSchedule.systems.find(({ id }) => id === 'seedlands:forage-system')!
      .remainder,
  ).toBe(0.15);
  const before = structuredClone(activeBaseline.checkpoint.gameplay);
  const persistence = new MemoryGamePersistence({ clone: structuredClone, rawGameplaySnapshot: before });
  const runtime = await AuthorityRuntime.create({
    ...classicOptions(),
    worldgenProvider: classicWorldgenProvider,
    platform: testCorePlatform,
    persistence,
    epoch: 'classic-minecart-restore',
    seedText: 'pre-transport-production-75',
    initialWorldTime: 8,
    startTimeMs: 0,
  });
  expect(runtime.view().transports).toEqual([]);
  expect(runtime.server.getPlayerState(runtime.playerId).inventory).toEqual(
    activeBaseline.checkpoint.gameplay.entityStore.actors[0]!.inventory,
  );
  const restored = runtime.exportPortableCheckpoint().gameplay;
  if (restored.version !== 4 || restored.entityStore.version !== 2)
    throw new TypeError('Expected current ECS gameplay checkpoint.');
  expect(restored.entityStore.identities).toEqual(activeBaseline.checkpoint.gameplay.entityStore.identities);
  expect(restored.moduleSchedule?.time).toBe(activeBaseline.checkpoint.gameplay.moduleSchedule.time);
  expect(restored.moduleSchedule?.systems).toEqual(
    expect.arrayContaining([
      ...activeBaseline.checkpoint.gameplay.moduleSchedule.systems,
      { id: 'seedlands:minecart-motion', remainder: 0 },
    ]),
  );
  expect(before).toEqual(activeBaseline.checkpoint.gameplay);
});

it('未知Pack摘要不会借新增运输入口被批准为旧V4来源', async () => {
  const before = structuredClone(baseline.checkpoint.gameplay);
  before.composition.packLock[0]!.integrity.entryDigest = '0'.repeat(64);
  const persistence = new MemoryGamePersistence({ clone: structuredClone, rawGameplaySnapshot: before });
  await expect(
    AuthorityRuntime.create({
      ...classicOptions(),
      worldgenProvider: classicWorldgenProvider,
      platform: testCorePlatform,
      persistence,
      epoch: 'classic-minecart-invalid-source',
      seedText: 'pre-transport-production-75',
      initialWorldTime: 8,
      startTimeMs: 0,
    }),
  ).rejects.toThrow(/composition|identity|predecessor/i);
  expect(persistence.loadGameplaySnapshot()).toEqual(before);
});

it('真实旧Pack若含非空V1载具则明确拒绝，不将其隐藏在第二owner或丢弃原存档', async () => {
  const old = structuredClone(baseline.checkpoint.gameplay);
  const before = {
    ...old,
    vehicles: {
      ...old.vehicles,
      vehicles: [
        {
          id: 'legacy-cart',
          kind: 'minecart',
          position: [2.5, 31, 0.5],
          velocity: 0,
          heading: [1, 0],
          riderId: null,
          fuelSeconds: 0,
          inventory: [],
        },
      ],
    },
  };
  const persistence = new MemoryGamePersistence({ clone: structuredClone, rawGameplaySnapshot: before });
  await expect(
    AuthorityRuntime.create({
      ...classicOptions(),
      worldgenProvider: classicWorldgenProvider,
      platform: testCorePlatform,
      persistence,
      epoch: 'classic-minecart-nonempty-legacy',
      seedText: 'pre-transport-production-75',
      initialWorldTime: 8,
      startTimeMs: 0,
    }),
  ).rejects.toThrow(/nonempty legacy transport/i);
  expect(persistence.loadGameplaySnapshot()).toEqual(before);
});

it('已批准的旧身份仍不能补造缺失的旧system时钟', async () => {
  const before = structuredClone(baseline.checkpoint.gameplay);
  before.moduleSchedule.systems.pop();
  const persistence = new MemoryGamePersistence({ clone: structuredClone, rawGameplaySnapshot: before });
  await expect(
    AuthorityRuntime.create({
      ...classicOptions(),
      worldgenProvider: classicWorldgenProvider,
      platform: testCorePlatform,
      persistence,
      epoch: 'classic-minecart-missing-schedule',
      seedText: 'pre-transport-production-75',
      initialWorldTime: 8,
      startTimeMs: 0,
    }),
  ).rejects.toThrow(/schedule.*(incomplete|unknown)/i);
  expect(persistence.loadGameplaySnapshot()).toEqual(before);
});
