import { expect, it, vi } from 'vitest';
import { MemoryGamePersistence } from '../../../../../../../packages/stdlib/src/server/persistence/memory-game-persistence';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import {
  addRoute,
  create,
  deploy,
  isPortableTransportCheckpoint,
  putVoxel,
  selection,
  state,
} from './transport-authority-test-fixture';

it('deploys route and surface transports through a selected item in the real Authority action path', async () => {
  const runtime = await create();
  await addRoute(runtime);
  await putVoxel(runtime, [3, 59, 0], 5);
  expect(runtime.server.getVoxel(1, 59, 0)).toBe(6);
  expect(runtime.server.getVoxel(1, 60, 0)).toBe(0);
  expect(runtime.server.getVoxel(3, 59, 0)).toBe(5);
  expect(runtime.server.getVoxel(3, 60, 0)).toBe(0);
  runtime.server.giveItem(runtime.playerId, { itemId: 'sample:route-cart-kit', count: 1 });
  runtime.takeCommits();
  const beforeRoute = runtime.server.getInventoryPointerView(runtime.playerId);
  const operationSpy = vi.spyOn(runtime.server, 'invokeActorModuleOperation');

  const routeResult = await runtime.performAction(deploy(runtime, [1, 59, 0], [1, 60, 0]));
  const registeredResult = operationSpy.mock.results[0]?.value;

  expect(operationSpy).toHaveBeenCalledTimes(1);
  expect(
    routeResult.result,
    `${JSON.stringify(routeResult.result)}; registered=${JSON.stringify(registeredResult)}`,
  ).toMatchObject({
    success: true,
    handled: true,
    bindingId: 'sample:route-cart-binding',
  });
  expect(runtime.server.getInventoryPointerView(runtime.playerId).slots[0]).toBeNull();
  expect(runtime.server.getInventoryPointerView(runtime.playerId).revision).toBe(beforeRoute.revision + 1);
  const routeView = runtime.view();
  const routeEntity = routeView.entities.find((entity) => entity.type === 'transport');
  expect(routeEntity).toBeDefined();
  expect(routeEntity).toMatchObject({ type: 'transport', position: [1.5, 59, 0.5] });
  expect(routeView.transports).toHaveLength(1);
  expect(routeView.transports?.[0]).toMatchObject({
    reference: runtime.server.createEntityReference(routeEntity!.id),
    definitionId: 'sample:route-cart',
    pose: { position: [1.5, 59, 0.5] },
  });

  runtime.server.giveItem(runtime.playerId, { itemId: 'sample:surface-cart-kit', count: 1 });
  await runtime.performAction({ type: 'select-hotbar', slot: 0 });
  const surfaceBefore = runtime.server.getInventoryPointerView(runtime.playerId);
  const surfaceResult = await runtime.performAction(deploy(runtime, [3, 59, 0], [3, 60, 0]));
  expect(surfaceResult.result, JSON.stringify(surfaceResult.result)).toMatchObject({
    success: true,
    handled: true,
    bindingId: 'sample:surface-cart-binding',
  });
  expect(runtime.server.getInventoryPointerView(runtime.playerId).revision).toBe(surfaceBefore.revision + 1);
  expect(runtime.view().entities.filter((entity) => entity.type === 'transport')).toHaveLength(2);
  const finalTransports = runtime.view().transports;
  expect(finalTransports).toHaveLength(2);
  expect(finalTransports?.find((transport) => transport.definitionId === 'sample:surface-cart')).toMatchObject({
    pose: { position: [3.5, 60, 0.5] },
  });

  const beforePhysics = runtime.view().transports;
  expect(() => runtime.advanceSession(100)).not.toThrow();
  expect(runtime.view().transports).toEqual(beforePhysics);
  expect(runtime.view().entities.filter((entity) => entity.type === 'transport')).toHaveLength(2);
});

it('rejects a different support provider and duplicate occupancy without partial owner changes', async () => {
  const runtime = await create();
  await addRoute(runtime);
  await putVoxel(runtime, [3, 59, 0], 5);
  runtime.server.giveItem(runtime.playerId, { itemId: 'sample:route-cart-kit', count: 2 });
  runtime.takeCommits();
  const first = await runtime.performAction(deploy(runtime, [1, 59, 0], [1, 60, 0]));
  expect(first.result).toMatchObject({ success: true, handled: true });

  const beforeWrongSurface = state(runtime);
  const wrongSurface = await runtime.performAction(deploy(runtime, [3, 59, 0], [3, 60, 0]));
  expect(wrongSurface.result).toMatchObject({ success: false });
  expect(wrongSurface.commits).toEqual([]);
  expect(state(runtime)).toEqual(beforeWrongSurface);

  const beforeOccupied = state(runtime);
  const duplicate = await runtime.performAction(deploy(runtime, [1, 59, 0], [1, 60, 0]));
  expect(duplicate.result).toMatchObject({ success: false });
  expect(duplicate.commits).toEqual([]);
  expect(state(runtime)).toEqual(beforeOccupied);
});

it('rejects stale selection fields atomically and leaves unconfigured voxels unchanged', async () => {
  const runtime = await create();
  await putVoxel(runtime, [3, 59, 0], 5);
  runtime.takeCommits();
  runtime.server.giveItem(runtime.playerId, { itemId: 'sample:route-cart-kit', count: 1 });
  const before = state(runtime);
  for (const field of ['inventoryRevision', 'modeRevision', 'creativeCatalogRevision', 'selectedSlot'] as const) {
    const current = selection(runtime);
    const expectedSelection = { ...current, [field]: current[field] + 1 };
    const rejected = await runtime.performAction(deploy(runtime, [1, 59, 0], [1, 60, 0], expectedSelection));
    expect(rejected.result, `${field}: ${JSON.stringify(rejected.result)}`).toMatchObject({ success: false });
    expect(rejected.commits).toEqual([]);
    expect(state(runtime)).toEqual(before);
  }

  const unsupported = await runtime.performAction(deploy(runtime, [3, 59, 0], [3, 60, 0]));
  expect(unsupported.result).toMatchObject({ success: false });
  expect(unsupported.commits).toEqual([]);
  expect(state(runtime)).toEqual(before);
});

for (const mode of ['veto', 'forge'] as const) {
  it(`rejects registered ${mode} rules without changing transport or inventory owners`, async () => {
    const runtime = await create(mode);
    await addRoute(runtime);
    runtime.server.giveItem(runtime.playerId, { itemId: 'sample:route-cart-kit', count: 1 });
    runtime.takeCommits();
    const before = state(runtime);
    const operationSpy = vi.spyOn(runtime.server, 'invokeActorModuleOperation');

    const rejected = await runtime.performAction(deploy(runtime, [1, 59, 0], [1, 60, 0]));
    const registeredResult = operationSpy.mock.results[0]?.value;

    const expectedFailure =
      mode === 'veto'
        ? { ok: false, code: 'RULE_REJECTED', message: 'transport-test-veto' }
        : { ok: false, code: 'OPERATION_FAILED', message: 'transport-candidate-stale' };
    expect(registeredResult, `registered=${JSON.stringify(registeredResult)}`).toMatchObject(expectedFailure);
    expect(rejected.result).toMatchObject({ success: false });
    expect(rejected.commits).toEqual([]);
    expect(state(runtime)).toEqual(before);
  });
}

it('restores a deployed transport from a portable Authority checkpoint with a current lifetime reference', async () => {
  const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
  const source = await create(undefined, persistence);
  await addRoute(source);
  source.server.giveItem(source.playerId, { itemId: 'sample:route-cart-kit', count: 1 });
  const deployed = await source.performAction(deploy(source, [1, 59, 0], [1, 60, 0]));
  expect(deployed.result).toMatchObject({ success: true, handled: true });

  const portable = source.exportPortableCheckpoint();
  if (!isPortableTransportCheckpoint(portable)) throw new TypeError('Invalid transport checkpoint.');
  const { transports, identities } = portable.gameplay.entityStore;
  const savedTransport = transports?.[0];
  const savedIdentity = identities.find(({ entityId }) => entityId === savedTransport?.entityId)!;
  await source.persistPortableCheckpoint(portable);

  const restored = await create(undefined, persistence);
  const restoredTransport = restored.view().transports![0]!;
  expect(restoredTransport.reference).toEqual(restored.server.createEntityReference(savedTransport!.entityId));
  expect(restoredTransport.reference.lifetime).toBe(savedIdentity!.lifetime);
  expect(restoredTransport).toMatchObject({
    definitionId: savedTransport!.definitionId,
    pose: { yaw: savedTransport!.yaw, position: [1.5, 59, 0.5] },
    routeCursor: savedTransport!.routeCursor,
    fuel: savedTransport!.fuel,
    inventory: savedTransport!.inventory,
  });
});

it('rejects a portable transport checkpoint with an unknown definition without changing saved or source state', async () => {
  const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
  const source = await create(undefined, persistence);
  await addRoute(source);
  source.server.giveItem(source.playerId, { itemId: 'sample:route-cart-kit', count: 1 });
  const deployed = await source.performAction(deploy(source, [1, 59, 0], [1, 60, 0]));
  expect(deployed.result).toMatchObject({ success: true, handled: true });
  const portable = source.exportPortableCheckpoint();
  if (!isPortableTransportCheckpoint(portable)) throw new TypeError('Invalid transport checkpoint.');
  const component = portable.gameplay.entityStore.transports?.[0];
  await source.persistPortableCheckpoint(portable);

  persistence.saveFrozenSnapshot({
    ...portable,
    gameplay: {
      ...portable.gameplay,
      entityStore: {
        ...portable.gameplay.entityStore,
        transports: [{ ...component!, definitionId: 'sample:unknown-transport-definition' }],
      },
    },
  });
  const persistenceBefore = [persistence.loadGameCheckpoint(), persistence.loadGameplaySnapshot()];
  const sourceBefore = state(source);

  await expect(source.server.restore()).rejects.toThrow(/transport|definition|checkpoint/i);
  expect([persistence.loadGameCheckpoint(), persistence.loadGameplaySnapshot()]).toEqual(persistenceBefore);
  expect(state(source)).toEqual(sourceBefore);
});
