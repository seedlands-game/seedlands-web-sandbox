import { expect, it, vi } from 'vitest';
import { defineTransportRelationModule, type ModModule, type ModuleInvocationValue } from '@seedlands/stdlib/mod-api';
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
  type Runtime,
} from './transport-authority-test-fixture';

const relations = defineTransportRelationModule({
  moduleId: 'sample:transport-relations',
  operationId: 'sample:relate-transport',
});

type RelationRuleMode = 'veto' | 'forge';
const relationRule = (mode: RelationRuleMode): ModModule => ({
  descriptor: {
    id: `test:transport-relation-${mode}`,
    version: '1.0.0',
    permissions: [{ resource: 'seedlands.transport', operations: ['read', 'write', 'execute'] }],
  },
  register(api) {
    api.registerRule({
      id: `test:transport-relation-${mode}`,
      operationId: 'sample:relate-transport',
      stage: 'after',
      apply(context, _input, candidateState, candidate) {
        if (context.kind !== 'actor') throw new TypeError('Expected an actor relation rule context.');
        if (mode === 'veto') return { reject: 'transport-relation-test-veto' };
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
          throw new TypeError('Expected the registered transport relation candidate.');
        candidateState.write(
          {
            componentId: 'seedlands:transport-relation',
            target: { kind: 'entity', entityId: context.originalActorId },
          },
          { ...(candidate as Readonly<Record<string, ModuleInvocationValue>>), position: [20, 60, 0] },
        );
      },
    });
  },
});

async function deployedSurfaceCart(
  obstacles: readonly (readonly [number, number, number])[] = [],
  unsupportedExits: readonly (readonly [number, number, number])[] = [],
  persistence?: MemoryGamePersistence,
) {
  const runtime = await create(undefined, persistence, [relations]);
  await putVoxel(runtime, [3, 59, 0], 5);
  for (const position of obstacles) await putVoxel(runtime, position, 3);
  for (const position of unsupportedExits) await putVoxel(runtime, position, 0);
  runtime.server.giveItem(runtime.playerId, { itemId: 'sample:surface-cart-kit', count: 1 });
  runtime.takeCommits();
  const result = await runtime.performAction(deploy(runtime, [3, 59, 0], [3, 60, 0]));
  expect(result.result).toMatchObject({ success: true, handled: true });
  const transport = runtime.view().transports?.[0];
  expect(transport).toBeDefined();
  return { runtime, transport: transport! };
}

async function deployedRouteCart() {
  const runtime = await create(undefined, undefined, [relations]);
  await addRoute(runtime);
  for (let x = 0; x <= 3; x += 1) for (let z = -1; z <= 1; z += 1) await putVoxel(runtime, [x, 58, z], 0);
  runtime.server.giveItem(runtime.playerId, { itemId: 'sample:route-cart-kit', count: 1 });
  runtime.takeCommits();
  const result = await runtime.performAction(deploy(runtime, [1, 59, 0], [1, 60, 0]));
  expect(result.result).toMatchObject({ success: true, handled: true });
  const transport = runtime.view().transports?.[0];
  expect(transport).toBeDefined();
  return { runtime, transport: transport! };
}

const mount = (
  runtime: Runtime,
  reference: NonNullable<ReturnType<Runtime['view']>['transports']>[number]['reference'],
) =>
  runtime.performAction({
    type: 'interact',
    intent: 'use',
    target: { kind: 'entity', reference },
    expectedSelection: selection(runtime),
  });

const dismount = (runtime: Runtime) =>
  runtime.performAction({
    type: 'interact',
    intent: 'alternate',
    target: { kind: 'self' },
    expectedSelection: selection(runtime),
  });

it('mounts and dismounts through normal Authority use and alternate actions', async () => {
  const { runtime, transport } = await deployedSurfaceCart();
  const beforeMount = state(runtime);
  const operationSpy = vi.spyOn(runtime.server, 'invokeActorModuleOperation');

  const mounted = await mount(runtime, transport.reference);

  const registeredResult = operationSpy.mock.results.at(-1)?.value;
  expect(mounted.result, `registered=${JSON.stringify(registeredResult)}`).toMatchObject({
    success: true,
    handled: true,
  });
  expect(mounted.commits).toEqual([]);
  expect(runtime.view().transports?.[0]?.rider).toEqual(runtime.server.createEntityReference(runtime.playerId));
  expect(runtime.server.getEntity(runtime.playerId)?.position).toEqual([3.5, 60.55, 0.5]);
  expect(runtime.server.mountedSeatConstraints()).toMatchObject([
    {
      rider: runtime.server.createEntityReference(runtime.playerId),
      walkingEnabled: false,
      pose: { position: [3.5, 60.55, 0.5] },
    },
  ]);
  expect(state(runtime).gameplayRevision).toBe(beforeMount.gameplayRevision + 1);

  const beforeDismount = state(runtime);
  const dismounted = await dismount(runtime);
  expect(dismounted.result).toMatchObject({ success: true, handled: true });
  expect(dismounted.commits).toEqual([]);
  expect(runtime.view().transports?.[0]?.rider).toBeNull();
  expect(runtime.server.getEntity(runtime.playerId)?.position).toEqual([2.73, 60, 0.5]);
  expect(runtime.server.mountedSeatConstraints()).toEqual([]);
  expect(state(runtime).gameplayRevision).toBe(beforeDismount.gameplayRevision + 1);
});

it('rejects every stale selection field and a second mount without changing owners', async () => {
  const { runtime, transport } = await deployedSurfaceCart();
  const before = state(runtime);
  for (const field of ['inventoryRevision', 'modeRevision', 'creativeCatalogRevision', 'selectedSlot'] as const) {
    const current = selection(runtime);
    const expectedSelection = { ...current, [field]: current[field] + 1 };
    const rejected = await runtime.performAction({
      type: 'interact',
      intent: 'use',
      target: { kind: 'entity', reference: transport.reference },
      expectedSelection,
    });
    expect(rejected.result, `${field}: ${JSON.stringify(rejected.result)}`).toMatchObject({ success: false });
    expect(rejected.commits).toEqual([]);
    expect(state(runtime)).toEqual(before);
  }

  const mounted = await mount(runtime, transport.reference);
  expect(mounted.result).toMatchObject({ success: true, handled: true });
  const beforeDuplicate = state(runtime);
  const duplicate = await mount(runtime, transport.reference);
  expect(duplicate.result).toMatchObject({ success: false });
  expect(duplicate.commits).toEqual([]);
  expect(state(runtime)).toEqual(beforeDuplicate);
});

it('rejects mounting when the actual seat body overlaps a loaded solid voxel', async () => {
  const { runtime, transport } = await deployedSurfaceCart();
  await putVoxel(runtime, [3, 61, 0], 3);
  runtime.takeCommits();
  const before = state(runtime);
  const operationSpy = vi.spyOn(runtime.server, 'invokeActorModuleOperation');

  const rejected = await mount(runtime, transport.reference);

  const registeredResult = operationSpy.mock.results.at(-1)?.value;
  expect(registeredResult).toMatchObject({ ok: false, message: 'target-occupied' });
  expect(rejected.result, `registered=${JSON.stringify(registeredResult)}`).toMatchObject({ success: false });
  expect(rejected.commits).toEqual([]);
  expect(state(runtime)).toEqual(before);
});

it('rejects dismount when every route-cart exit has unknown or unsupported ground', async () => {
  const { runtime, transport } = await deployedRouteCart();
  for (let x = 0; x <= 3; x += 1) for (let z = -1; z <= 1; z += 1) expect(runtime.server.getVoxel(x, 58, z)).toBe(0);
  const mounted = await mount(runtime, transport.reference);
  expect(mounted.result).toMatchObject({ success: true, handled: true });
  const before = state(runtime);
  const operationSpy = vi.spyOn(runtime.server, 'invokeActorModuleOperation');

  const rejected = await dismount(runtime);

  const registeredResult = operationSpy.mock.results.at(-1)?.value;
  expect(registeredResult).toMatchObject({ ok: false, message: 'no-safe-exit' });
  expect(rejected.result, `registered=${JSON.stringify(registeredResult)}`).toMatchObject({ success: false });
  expect(rejected.commits).toEqual([]);
  expect(state(runtime)).toEqual(before);
});

for (const mode of ['veto', 'forge'] as const) {
  it(`rejects registered ${mode} rules without changing relation or transport owners`, async () => {
    const runtime = await create(undefined, undefined, [relations, relationRule(mode)]);
    await putVoxel(runtime, [3, 59, 0], 5);
    runtime.server.giveItem(runtime.playerId, { itemId: 'sample:surface-cart-kit', count: 1 });
    runtime.takeCommits();
    const deployed = await runtime.performAction(deploy(runtime, [3, 59, 0], [3, 60, 0]));
    expect(deployed.result).toMatchObject({ success: true, handled: true });
    const transport = runtime.view().transports?.[0];
    expect(transport).toBeDefined();
    const before = state(runtime);
    const operationSpy = vi.spyOn(runtime.server, 'invokeActorModuleOperation');

    const rejected = await mount(runtime, transport!.reference);
    const registeredResult = operationSpy.mock.results.at(-1)?.value;

    if (mode === 'veto') {
      expect(registeredResult).toMatchObject({
        ok: false,
        code: 'RULE_REJECTED',
        message: 'transport-relation-test-veto',
      });
    } else {
      expect(registeredResult).toMatchObject({
        ok: false,
        code: 'OPERATION_FAILED',
        message: 'transport-candidate-stale',
      });
    }
    expect(rejected.result).toMatchObject({ success: false });
    expect(rejected.commits).toEqual([]);
    expect(state(runtime)).toEqual(before);
  });
}

it('keeps an actual flight, walking and jump input at the registered mounted seat', async () => {
  const runtime = await create(undefined, undefined, [relations]);
  const command = await runtime.executeCommand(
    {
      actorId: runtime.playerId,
      entityId: runtime.playerId,
      sourceType: 'test-player',
      capabilities: ['mutation'],
    },
    { type: 'set-mode', mode: 'creative' },
    runtime.commandBinding,
  );
  expect(command).toMatchObject({ success: true, data: { mode: 'creative' } });
  const catalog = await runtime.executeCommand(
    {
      actorId: runtime.playerId,
      entityId: runtime.playerId,
      sourceType: 'test-player',
      capabilities: ['mutation'],
    },
    { type: 'set-creative-slot', slot: 0, itemId: 'sample:surface-cart-kit' },
    runtime.commandBinding,
  );
  expect(catalog).toMatchObject({ success: true });
  await putVoxel(runtime, [3, 59, 0], 5);
  runtime.takeCommits();
  const deployed = await runtime.performAction(deploy(runtime, [3, 59, 0], [3, 60, 0]));
  expect(deployed.result, JSON.stringify(deployed.result)).toMatchObject({ success: true, handled: true });
  const transport = runtime.view().transports?.[0];
  expect(transport).toBeDefined();
  const mounted = await mount(runtime, transport!.reference);
  expect(mounted.result).toMatchObject({ success: true, handled: true });

  const snapshot = runtime.snapshot();
  const movement = snapshot.player.movement;
  expect(movement).toBeDefined();
  const playerPosition = runtime.server.getEntity(runtime.playerId)!.position;
  const transportState = runtime.view().transports?.[0];
  const input = {
    kind: 'input' as const,
    protocolVersion: 1 as const,
    epoch: snapshot.epoch,
    stream: 'player-input',
    sequence: 0,
    targetPhysicsTick: snapshot.physicsTick + 1,
    issuedAtMs: 1,
    movementRevision: movement!.revision,
    state: { moveX: 1, moveZ: 0, verticalIntent: 1 as const, jumpHeld: true },
    edges: { jumpPressed: true },
  };
  expect(runtime.receiveInput(input)).toBe('accepted');
  runtime.advanceSession(500);

  expect(runtime.server.getEntity(runtime.playerId)!.position).toEqual(playerPosition);
  expect(runtime.view().transports?.[0]).toEqual(transportState);
  expect(runtime.server.mountedSeatConstraints()).toMatchObject([
    {
      rider: runtime.server.createEntityReference(runtime.playerId),
      walkingEnabled: false,
      pose: { position: [3.5, 60.55, 0.5] },
    },
  ]);
});

it('restores a mounted rider from a portable checkpoint and reprojects the current seat', async () => {
  const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
  const { runtime: source, transport } = await deployedSurfaceCart([], [], persistence);
  const mounted = await mount(source, transport.reference);
  expect(mounted.result).toMatchObject({ success: true, handled: true });
  const portable = source.exportPortableCheckpoint();
  if (!isPortableTransportCheckpoint(portable)) throw new TypeError('Invalid mounted transport checkpoint.');
  const savedTransport = portable.gameplay.entityStore.transports?.[0];
  const savedRider = source.server.createEntityReference(source.playerId)!;
  expect(savedTransport?.rider).toEqual({ entityId: savedRider.entityId, lifetime: savedRider.lifetime });
  await source.persistPortableCheckpoint(portable);

  const restored = await create(undefined, persistence, [relations]);
  const currentTransport = restored.view().transports?.[0];
  expect(currentTransport?.reference).toEqual(restored.server.createEntityReference(transport.reference.entityId));
  expect(currentTransport?.rider).toEqual(restored.server.createEntityReference(restored.playerId));
  expect(currentTransport?.pose.position).toEqual([3.5, 60, 0.5]);
  expect(restored.server.getEntity(restored.playerId)?.position).toEqual([3.5, 60.55, 0.5]);
  expect(restored.server.mountedSeatConstraints()).toMatchObject([
    { rider: restored.server.createEntityReference(restored.playerId), walkingEnabled: false },
  ]);
});

it('rejects a malformed mounted-rider checkpoint without mutating the active owner', async () => {
  const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
  const { runtime: source, transport } = await deployedSurfaceCart([], [], persistence);
  const mounted = await mount(source, transport.reference);
  expect(mounted.result).toMatchObject({ success: true, handled: true });
  const portable = source.exportPortableCheckpoint();
  if (!isPortableTransportCheckpoint(portable)) throw new TypeError('Invalid mounted transport checkpoint.');
  const savedTransport = portable.gameplay.entityStore.transports?.[0];
  if (!savedTransport) throw new TypeError('Missing saved transport component.');
  await source.persistPortableCheckpoint(portable);
  persistence.saveFrozenSnapshot({
    ...portable,
    gameplay: {
      ...portable.gameplay,
      entityStore: {
        ...portable.gameplay.entityStore,
        transports: [{ ...savedTransport, rider: { entityId: 'missing-rider', lifetime: 999 } }],
      },
    },
  });
  const persistenceBefore = [persistence.loadGameCheckpoint(), persistence.loadGameplaySnapshot()];
  const sourceBefore = state(source);

  await expect(source.server.restore()).rejects.toThrow(/transport|rider|entity|checkpoint/i);

  expect([persistence.loadGameCheckpoint(), persistence.loadGameplaySnapshot()]).toEqual(persistenceBefore);
  expect(state(source)).toEqual(sourceBefore);
});

it('updates terrain around a mounted vehicle and rejects a dismount with blocked exits', async () => {
  const { runtime, transport } = await deployedSurfaceCart();
  const mounted = await mount(runtime, transport.reference);
  expect(mounted.result).toMatchObject({ success: true, handled: true });
  for (const position of [
    [2, 61, 0],
    [4, 61, 0],
    [3, 61, -1],
    [3, 61, 1],
  ] as const)
    await putVoxel(runtime, position, 3);
  runtime.takeCommits();
  const before = state(runtime);
  const operationSpy = vi.spyOn(runtime.server, 'invokeActorModuleOperation');

  const rejected = await dismount(runtime);

  const registeredResult = operationSpy.mock.results.at(-1)?.value;
  expect(registeredResult).toMatchObject({ ok: false, message: 'no-safe-exit' });
  expect(rejected.result, `registered=${JSON.stringify(registeredResult)}`).toMatchObject({ success: false });
  expect(rejected.commits).toEqual([]);
  expect(state(runtime)).toEqual(before);
});

it('rejects relation changes when another player occupies the seat or every exit', async () => {
  const seatCase = await deployedSurfaceCart();
  seatCase.runtime.server.spawnPlayer({ id: 'seat-blocker', position: [3.5, 60.55, 0.5] });
  const seatBefore = state(seatCase.runtime);
  const seatMount = await mount(seatCase.runtime, seatCase.transport.reference);
  expect(seatMount.result).toMatchObject({ success: false });
  expect(seatMount.commits).toEqual([]);
  expect(state(seatCase.runtime)).toEqual(seatBefore);

  const exitCase = await deployedSurfaceCart();
  const mounted = await mount(exitCase.runtime, exitCase.transport.reference);
  expect(mounted.result).toMatchObject({ success: true, handled: true });
  for (const [id, position] of [
    ['left-exit-blocker', [2.73, 60, 0.5]],
    ['right-exit-blocker', [4.27, 60, 0.5]],
    ['north-exit-blocker', [3.5, 60, -0.27]],
    ['south-exit-blocker', [3.5, 60, 1.27]],
  ] as const)
    exitCase.runtime.server.spawnPlayer({ id, position: [...position] });
  const exitBefore = state(exitCase.runtime);
  const dismounted = await dismount(exitCase.runtime);
  expect(dismounted.result).toMatchObject({ success: false });
  expect(dismounted.commits).toEqual([]);
  expect(state(exitCase.runtime)).toEqual(exitBefore);
});

it('uses another safe exit when a live player occupies only the west exit', async () => {
  const { runtime, transport } = await deployedSurfaceCart();
  const mounted = await mount(runtime, transport.reference);
  expect(mounted.result).toMatchObject({ success: true, handled: true });
  runtime.server.spawnPlayer({ id: 'west-exit-blocker', position: [2.73, 60, 0.5] });
  const before = state(runtime);
  const operationSpy = vi.spyOn(runtime.server, 'invokeActorModuleOperation');

  const dismounted = await dismount(runtime);

  const registeredResult = operationSpy.mock.results.at(-1)?.value;
  expect(dismounted.result, `registered=${JSON.stringify(registeredResult)}`).toMatchObject({
    success: true,
    handled: true,
  });
  expect(dismounted.commits).toEqual([]);
  expect(runtime.view().transports?.[0]?.rider).toBeNull();
  expect(runtime.server.getEntity(runtime.playerId)?.position).not.toEqual([2.73, 60, 0.5]);
  expect(state(runtime).gameplayRevision).toBe(before.gameplayRevision + 1);
});

it('rejects dismount when the only unobstructed exit is in a genuinely unloaded chunk', async () => {
  const { runtime, transport } = await deployedSurfaceCart();
  expect(runtime.server.peekLoadedVoxel(3, 60, -1)).toBeNull();
  expect(runtime.server.peekLoadedVoxel(3, 59, -1)).toBeNull();
  const mounted = await mount(runtime, transport.reference);
  expect(mounted.result).toMatchObject({ success: true, handled: true });
  for (const position of [
    [2, 61, 0],
    [4, 61, 0],
    [3, 61, 1],
  ] as const)
    await putVoxel(runtime, position, 3);
  runtime.takeCommits();
  expect(runtime.server.peekLoadedVoxel(3, 60, -1)).toBeNull();
  const before = state(runtime);
  const operationSpy = vi.spyOn(runtime.server, 'invokeActorModuleOperation');

  const rejected = await dismount(runtime);

  const registeredResult = operationSpy.mock.results.at(-1)?.value;
  expect(registeredResult).toMatchObject({ ok: false, message: 'no-safe-exit' });
  expect(rejected.result, `registered=${JSON.stringify(registeredResult)}`).toMatchObject({ success: false });
  expect(rejected.commits).toEqual([]);
  expect(state(runtime)).toEqual(before);
});
