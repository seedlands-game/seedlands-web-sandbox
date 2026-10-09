import { expect } from 'vitest';
import { defineTransportMotionModule, defineTransportRelationModule } from '@seedlands/stdlib/mod-api';
import { create, deploy, putVoxel, selection, type Runtime } from './transport-authority-test-fixture';

const relations = defineTransportRelationModule({
  moduleId: 'sample:transport-relations',
  operationId: 'sample:relate-transport',
});
const motion = defineTransportMotionModule({
  moduleId: 'sample:transport-motion',
  operationId: 'sample:advance-transport',
  systemId: 'sample:transport-physics',
  policies: [
    {
      definitionId: 'sample:surface-cart',
      acceleration: 4,
      drag: 2,
      maxSpeed: 3,
      steeringRate: 1.5,
      fuelPerMeter: 0,
    },
  ],
});
export async function deployAndMountSurfaceCart(extraModules: Parameters<typeof create>[2] = []) {
  const runtime = await create(undefined, undefined, [...extraModules, relations, motion]);
  await putVoxel(runtime, [3, 59, 0], 5);
  for (let z = 1; z <= 8; z += 1) {
    const current = runtime.server.peekLoadedVoxel(3, 59, z);
    if (!current || current.voxel !== 5) await putVoxel(runtime, [3, 59, z], 5);
  }

  const source = {
    actorId: runtime.playerId,
    entityId: runtime.playerId,
    sourceType: 'test-player',
    capabilities: ['mutation'] as const,
  };
  const mode = await runtime.executeCommand(source, { type: 'set-mode', mode: 'creative' }, runtime.commandBinding);
  expect(mode).toMatchObject({ success: true, data: { mode: 'creative' } });
  const selected = await runtime.executeCommand(
    source,
    { type: 'set-creative-slot', slot: 0, itemId: 'sample:surface-cart-kit' },
    runtime.commandBinding,
  );
  expect(selected).toMatchObject({ success: true });

  const deployed = await runtime.performAction(deploy(runtime, [3, 59, 0], [3, 60, 0]));
  expect(deployed.result, JSON.stringify(deployed.result)).toMatchObject({ success: true, handled: true });
  const transport = runtime.view().transports?.[0];
  expect(transport).toBeDefined();
  const mounted = await runtime.performAction({
    type: 'interact',
    intent: 'use',
    target: { kind: 'entity', reference: transport!.reference },
    expectedSelection: selection(runtime),
  });
  expect(mounted.result, JSON.stringify(mounted.result)).toMatchObject({ success: true, handled: true });

  const survival = await runtime.executeCommand(source, { type: 'set-mode', mode: 'survival' }, runtime.commandBinding);
  expect(survival).toMatchObject({ success: true, data: { mode: 'survival' } });
  return { runtime, transport: runtime.view().transports![0] };
}

export const sendForwardInput = (runtime: Runtime, sequence = 0) => {
  const snapshot = runtime.snapshot();
  expect(snapshot.player.movement).toBeDefined();
  const command: Parameters<Runtime['receiveInput']>[0] = {
    kind: 'input',
    protocolVersion: 1,
    epoch: snapshot.epoch,
    stream: 'player-input',
    sequence,
    targetPhysicsTick: snapshot.physicsTick + 1,
    issuedAtMs: snapshot.activeTimeMs + 1,
    movementRevision: snapshot.player.movement!.revision,
    state: { moveX: 0, moveZ: 1, verticalIntent: 0, jumpHeld: false },
    edges: { jumpPressed: false },
  };
  expect(runtime.receiveInput(command)).toBe('accepted');
  return command;
};
