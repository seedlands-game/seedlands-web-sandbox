import { expect, it } from 'vitest';
import {
  defineDeathInventoryPolicyModuleV1,
  defineTransportRelationModule,
  type ModModule,
  type DeathInventoryPolicyDefinitionV1,
} from '@seedlands/stdlib/mod-api';
import { MemoryGamePersistence } from '../../../../../../../packages/stdlib/src/server/persistence/memory-game-persistence';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { create, deploy, isPortableTransportCheckpoint, putVoxel, selection } from './transport-authority-test-fixture';

const retainedActorDropContainers = {
  inventory: 'drop',
  cursor: 'drop',
  crafting: 'drop',
  armor: 'drop',
  actor: 'retain',
} as const;
const deathPolicy = defineDeathInventoryPolicyModuleV1({
  moduleId: 'sample:transport-death-inventory-policy',
  definition: {
    version: 1,
    actors: {
      player: retainedActorDropContainers,
      creature: { ...retainedActorDropContainers, actor: 'despawn' },
      npc: { ...retainedActorDropContainers, actor: 'despawn' },
    },
  } satisfies DeathInventoryPolicyDefinitionV1,
});
const relations = defineTransportRelationModule({
  moduleId: 'sample:transport-death-relations',
  operationId: 'sample:relate-death-transport',
});

async function mountedRuntime(extraModules: readonly ModModule[], persistence?: MemoryGamePersistence) {
  const runtime = await create(undefined, persistence, [relations, ...extraModules]);
  await putVoxel(runtime, [3, 59, 0], 5);
  runtime.server.giveItem(runtime.playerId, { itemId: 'sample:surface-cart-kit', count: 1 });
  runtime.takeCommits();
  const deployed = await runtime.performAction(deploy(runtime, [3, 59, 0], [3, 60, 0]));
  expect(deployed.result).toMatchObject({ success: true, handled: true });
  const transport = runtime.view().transports?.[0];
  expect(transport).toBeDefined();
  const mounted = await runtime.performAction({
    type: 'interact',
    intent: 'use',
    target: { kind: 'entity', reference: transport!.reference },
    expectedSelection: selection(runtime),
  });
  expect(mounted.result).toMatchObject({ success: true, handled: true });
  return { runtime, transport: transport! };
}

const playerLifecycle = (runtime: Awaited<ReturnType<typeof create>>) => {
  const portable = runtime.exportPortableCheckpoint();
  if (!isPortableTransportCheckpoint(portable)) throw new TypeError('Invalid transport checkpoint.');
  return portable.gameplay.entityStore.actors.find(({ entityId }) => entityId === runtime.playerId)?.lifecycle;
};

it('settles a mounted player death through Vitals without leaving a dangling transport rider', async () => {
  const { runtime, transport } = await mountedRuntime([deathPolicy]);
  runtime.server.giveItem(runtime.playerId, { itemId: 'sample:wood', count: 2 });
  runtime.server.giveItem(runtime.playerId, { itemId: 'sample:stone', count: 1 });
  const health = runtime.server.getEntity(runtime.playerId)?.health;
  if (health === undefined) throw new TypeError('Mounted player has no Vitals health.');

  const damage = runtime.server.applyDamage('death-test', runtime.playerId, health, 'transport-death-test');

  expect(damage).toEqual({ success: true });
  expect(runtime.server.getEntity(runtime.playerId)?.health).toBe(0);
  expect(playerLifecycle(runtime)).toBe('dead');
  expect(runtime.view().transports?.[0]?.rider).toBeNull();
  expect(runtime.view().transports?.[0]).toMatchObject({
    reference: transport.reference,
    pose: transport.pose,
    fuel: transport.fuel,
    inventory: transport.inventory,
  });
  const dropped = () =>
    runtime
      .view()
      .entities.filter(({ type }) => type === 'world-item')
      .map(({ stack }) => stack);
  expect(dropped()).toEqual([
    { itemId: 'sample:wood', count: 2 },
    { itemId: 'sample:stone', count: 1 },
  ]);
  expect(runtime.server.applyDamage('death-test', runtime.playerId, 1, 'duplicate-death')).toMatchObject({
    success: false,
  });
  expect(dropped()).toEqual([
    { itemId: 'sample:wood', count: 2 },
    { itemId: 'sample:stone', count: 1 },
  ]);
});

it('fails lethal Vitals closed without a death policy and leaves the mounted owner unchanged', async () => {
  const { runtime } = await mountedRuntime([]);
  const before = runtime.snapshot();
  const beforeView = runtime.view();
  const health = runtime.server.getEntity(runtime.playerId)?.health;
  if (health === undefined) throw new TypeError('Mounted player has no Vitals health.');

  const damage = runtime.server.applyDamage('death-test', runtime.playerId, health, 'transport-death-test');

  expect(damage).toEqual({ success: false, reason: 'death-inventory-policy-unavailable' });
  expect(runtime.snapshot()).toEqual(before);
  expect(runtime.view()).toEqual(beforeView);
});

it('restores a settled mounted death and respawns without restoring the rider or duplicating drops', async () => {
  const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
  const { runtime: source, transport } = await mountedRuntime([deathPolicy], persistence);
  source.server.giveItem(source.playerId, { itemId: 'sample:wood', count: 1 });
  const health = source.server.getEntity(source.playerId)?.health;
  if (health === undefined) throw new TypeError('Mounted player has no Vitals health.');
  expect(source.server.applyDamage('death-test', source.playerId, health, 'transport-death-test')).toEqual({
    success: true,
  });
  const portable = source.exportPortableCheckpoint();
  await source.persistPortableCheckpoint(portable);
  const restored = await create(undefined, persistence, [relations, deathPolicy]);
  expect(restored.server.getEntity(restored.playerId)?.health).toBe(0);
  expect(playerLifecycle(restored)).toBe('dead');
  expect(restored.view().transports?.[0]?.rider).toBeNull();
  expect(restored.view().transports?.[0]).toMatchObject({
    reference: { entityId: transport.reference.entityId, lifetime: transport.reference.lifetime },
    definitionId: transport.definitionId,
    pose: transport.pose,
    fuel: transport.fuel,
    inventory: transport.inventory,
  });
  const droppedBefore = restored
    .view()
    .entities.filter(({ type }) => type === 'world-item')
    .map(({ stack }) => stack);
  expect(droppedBefore).toEqual([{ itemId: 'sample:wood', count: 1 }]);

  expect(await restored.performAction({ type: 'respawn' })).toMatchObject({ result: { success: true } });

  expect(playerLifecycle(restored)).toBe('alive');
  expect(restored.view().transports?.[0]?.rider).toBeNull();
  expect(
    restored
      .view()
      .entities.filter(({ type }) => type === 'world-item')
      .map(({ stack }) => stack),
  ).toEqual(droppedBefore);
});
