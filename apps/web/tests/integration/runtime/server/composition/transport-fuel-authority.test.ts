import { expect, it } from 'vitest';
import { defineTransportMotionModule, defineTransportStorageModule } from '@seedlands/stdlib/mod-api';
import { addRoute, create, deploy, putVoxel } from './transport-authority-test-fixture';

const motionConfig = {
  moduleId: 'sample:fuel-motion',
  operationId: 'sample:advance-fuel-motion',
  systemId: 'sample:fuel-motion-system',
  policies: [
    {
      definitionId: 'sample:route-cart',
      acceleration: 4,
      drag: 0,
      maxSpeed: 3,
      steeringRate: 0,
      fuelPerMeter: 1,
      throttleSource: 'fuel' as const,
    },
  ],
};
async function fueledCarrier() {
  const runtime = await create(undefined, undefined, [
    defineTransportMotionModule(motionConfig),
    defineTransportStorageModule({
      moduleId: 'sample:route-storage',
      operationId: 'sample:store-route',
      fuels: [{ definitionId: 'sample:route-cart', itemId: 'sample:stone', units: 4 }],
    }),
  ]);
  await addRoute(runtime);
  for (let x = 0; x <= 3; x++) for (let z = -1; z <= 1; z++) await putVoxel(runtime, [x, 58, z], 0);
  runtime.server.giveItem(runtime.playerId, { itemId: 'sample:route-cart-kit', count: 1 });
  expect((await runtime.performAction(deploy(runtime, [1, 59, 0], [1, 60, 0]))).result).toMatchObject({
    success: true,
  });
  const empty = runtime.view().transports![0]!;
  expect(empty.fuel).toBe(0);
  runtime.advanceSession(200);
  expect(runtime.view().transports![0]!.pose).toEqual(empty.pose);
  runtime.server.giveItem(runtime.playerId, { itemId: 'sample:stone', count: 1 });
  const inventory = runtime.server.getInventoryPointerView(runtime.playerId);
  const site = runtime.view().transportStorage![0]!;
  expect(
    (
      await runtime.performAction({
        type: 'transport-storage',
        version: 1,
        actor: runtime.server.createEntityReference(runtime.playerId)!,
        transport: site.reference,
        expectedInventoryRevision: inventory.revision,
        expectedTransportRevision: site.revision,
        command: {
          kind: 'refuel',
          actorSlot: inventory.slots.findIndex((entry) => entry?.itemId === 'sample:stone'),
          count: 1,
        },
      })
    ).result,
  ).toMatchObject({ success: true });
  const fueled = runtime.view().transports![0]!;
  expect(fueled.fuel).toBe(4);
  expect(fueled.rider).toBeNull();
  return { runtime, fueled };
}

it('drives an unmounted route carrier only after normal Authority refueling and charges traveled distance', async () => {
  const { runtime, fueled } = await fueledCarrier();
  const afterRefuelInventory = runtime.server.getInventoryPointerView(runtime.playerId);
  runtime.advanceSession(200);
  const moved = runtime.view().transports![0]!;
  const distance = Math.hypot(...moved.pose.position.map((value, axis) => value - fueled.pose.position[axis]!));
  expect(distance).toBeGreaterThan(0);
  expect(moved.rider).toBeNull();
  expect(moved.fuel).toBeCloseTo(4 - distance, 8);
  expect(runtime.server.getInventoryPointerView(runtime.playerId)).toEqual(afterRefuelInventory);
});

it('stops a fuel-driven carrier at a loaded wall without charging fuel after it stops', async () => {
  const { runtime, fueled } = await fueledCarrier();
  await putVoxel(runtime, [2, Math.floor(fueled.pose.position[1]), 0], 3);
  runtime.advanceSession(1200);
  const stopped = runtime.view().transports![0]!;
  expect(stopped.pose.position[0]).toBeLessThanOrEqual(1.600001);
  expect(stopped.pose.position[0]).toBeGreaterThan(fueled.pose.position[0]);
  expect(stopped.fuel).toBeCloseTo(4 - (stopped.pose.position[0] - fueled.pose.position[0]), 8);
  runtime.advanceSession(400);
  expect(runtime.view().transports![0]!.pose).toEqual(stopped.pose);
  expect(runtime.view().transports![0]!.fuel).toBe(stopped.fuel);
});

it('rejects fuel throttle for surface carriers and policies without fuel consumption', async () => {
  for (const policy of [
    { ...motionConfig.policies[0]!, definitionId: 'sample:surface-cart' },
    { ...motionConfig.policies[0]!, fuelPerMeter: 0 },
  ]) {
    await expect(
      create(undefined, undefined, [defineTransportMotionModule({ ...motionConfig, policies: [policy] })]),
    ).rejects.toThrow('Fuel throttle requires');
  }
});
