import { expect, it } from 'vitest';
import { type ModModule } from '@seedlands/stdlib/mod-api';
import { putVoxel } from './transport-authority-test-fixture';
import { deployAndMountSurfaceCart, sendForwardInput } from './transport-authority-motion-fixture';

const motionVeto: ModModule = {
  descriptor: {
    id: 'test:transport-motion-veto',
    version: '1.0.0',
    permissions: [{ resource: 'seedlands.transport', operations: ['read', 'write', 'execute'] }],
  },
  register(api) {
    api.registerRule({
      id: 'test:transport-motion-veto',
      operationId: 'sample:advance-transport',
      stage: 'before',
      apply() {
        return { reject: 'transport-motion-test-veto' };
      },
    });
  },
};

it('advances a mounted surface cart from real world-space input in the same physics session', async () => {
  const { runtime, transport: before } = await deployAndMountSurfaceCart();
  expect(runtime.server.getPlayerState(runtime.playerId).mode?.value).toBe('survival');
  sendForwardInput(runtime);
  runtime.advanceSession(1_000);

  const after = runtime.view().transports?.[0];
  expect(after).toBeDefined();
  expect(after!.pose.position[2]).toBeGreaterThan(before.pose.position[2] + 0.1);
  expect(after!.velocity[2]).toBeGreaterThan(0);
  expect(after!.reference).toEqual(before.reference);
  expect(after!.definitionId).toBe(before.definitionId);
  expect(after!.fuel).toBe(before.fuel);
  expect(after!.inventory).toEqual(before.inventory);
  expect(after!.rider).toEqual(runtime.server.createEntityReference(runtime.playerId));
  const rider = runtime.server.getEntity(runtime.playerId);
  expect(rider?.position).toEqual([after!.pose.position[0], after!.pose.position[1] + 0.55, after!.pose.position[2]]);
  expect(rider?.physicsVelocity).toEqual(after!.velocity);
});

it('keeps transport and rider at the same pose when a registered motion rule vetoes the tick', async () => {
  const { runtime } = await deployAndMountSurfaceCart([motionVeto]);
  runtime.advanceSession(50);
  const beforeTransport = runtime.view().transports![0];
  const beforeRider = [...runtime.server.getEntity(runtime.playerId)!.position];
  sendForwardInput(runtime);
  runtime.advanceSession(1_000);

  expect(runtime.view().transports![0]).toEqual(beforeTransport);
  expect(runtime.server.getEntity(runtime.playerId)?.position).toEqual(beforeRider);
});

it('does not move a surface cart through a loaded solid wall', async () => {
  const { runtime, transport: before } = await deployAndMountSurfaceCart();
  await putVoxel(runtime, [3, 60, 2], 3);
  sendForwardInput(runtime);
  runtime.advanceSession(1_000);

  const after = runtime.view().transports![0];
  expect(after.pose.position[2]).toBeLessThanOrEqual(1.62);
  expect(after.reference).toEqual(before.reference);
  const rider = runtime.server.getEntity(runtime.playerId);
  expect(rider?.position).toEqual([after.pose.position[0], after.pose.position[1] + 0.55, after.pose.position[2]]);
  expect(rider?.physicsVelocity).toEqual(after.velocity);
});
