import { expect, it } from 'vitest';
import type { ModModule, ModuleInvocationValue } from '@seedlands/stdlib/mod-api';
import { deployAndMountSurfaceCart, sendForwardInput } from './transport-authority-motion-fixture';
import { deploy, selection, type Runtime } from './transport-authority-test-fixture';

it('rejects a registered after-rule forged motion publication before any transport or rider write', async () => {
  let attempted = 0;
  const forge: ModModule = {
    descriptor: {
      id: 'test:motion-forge',
      version: '1.0.0',
      permissions: [{ resource: 'seedlands.transport', operations: ['read', 'write', 'execute'] }],
    },
    register(api) {
      api.registerRule({
        id: 'test:motion-forge',
        operationId: 'sample:advance-transport',
        stage: 'after',
        apply(_context, _input, state, candidate) {
          attempted++;
          if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
            throw new Error('Missing motion candidate');
          state.write(
            { componentId: 'seedlands:transport-motion-frame', target: { kind: 'world' } },
            { ...(candidate as Readonly<Record<string, ModuleInvocationValue>>), entries: [] },
          );
        },
      });
    },
  };
  const { runtime } = await deployAndMountSurfaceCart([forge]);
  runtime.advanceSession(17);
  const before = runtime.view().transports![0];
  sendForwardInput(runtime);
  runtime.advanceSession(34);
  expect(attempted).toBeGreaterThan(0);
  expect(runtime.view().transports![0]).toEqual(before);
  expect(runtime.server.getEntity(runtime.playerId)?.position).toEqual([
    before.pose.position[0],
    before.pose.position[1] + 0.55,
    before.pose.position[2],
  ]);
});

it('does not overwrite a current owner changed by a before-rule with stale ordinary physics positions', async () => {
  const owner: { current?: Runtime } = {};
  let changed = false;
  let transportId = '';
  let otherId = '';
  const stale: ModModule = {
    descriptor: {
      id: 'test:motion-stale',
      version: '1.0.0',
      permissions: [{ resource: 'seedlands.transport', operations: ['read', 'write', 'execute'] }],
    },
    register(api) {
      api.registerRule({
        id: 'test:motion-stale',
        operationId: 'sample:advance-transport',
        stage: 'before',
        apply() {
          if (owner.current && !changed) {
            changed = true;
            owner.current.server.updateEntityWithoutSnapshot(otherId, {
              position: [8.5, 60, 4.5],
              physicsVelocity: [0, 0, 0],
            });
            owner.current.server.updateEntityWithoutSnapshot(transportId, {
              position: [3.5, 60, 4.5],
              physicsVelocity: [0, 0, 0],
            });
          }
        },
      });
    },
  };
  const { runtime } = await deployAndMountSurfaceCart([stale]);
  transportId = runtime.view().transports![0].reference.entityId;
  otherId = runtime.server.spawnPlayer({ id: 'rule-moved-player', position: [8.5, 60, 0.5] }).id;
  owner.current = runtime;
  sendForwardInput(runtime);
  runtime.advanceSession(17);
  expect(changed).toBe(true);
  expect(runtime.server.getEntity(otherId)?.position).toEqual([8.5, 60, 4.5]);
  const corrected = runtime.snapshot().entities.find(({ id }) => id === otherId)!;
  expect(corrected.body.position).toEqual({ x: 8.5, y: 60, z: 4.5 });
  expect(corrected.grounded).toBe(false);
  expect(corrected.contacts).toEqual([]);
  expect(runtime.view().transports![0].pose.position).toEqual([3.5, 60, 4.5]);
  expect(runtime.server.getEntity(runtime.playerId)?.position).toEqual([3.5, 60.55, 4.5]);
});

it('publishes one entity-counted gameplay frontier for one physics tick with transport motion', async () => {
  const { runtime } = await deployAndMountSurfaceCart();
  const entities = runtime.server.queryEntities().filter(({ type }) => type !== 'station').length;
  const before = runtime.server.gameplayRevision;
  sendForwardInput(runtime);
  runtime.advanceSession(17);
  expect(runtime.snapshot().physicsTick).toBe(1);
  expect(runtime.server.gameplayRevision - before).toBe(entities);
  expect(runtime.view().transports![0].velocity[2]).toBeGreaterThan(0);
});

it('keeps an already moving transport at its last accepted pose when its registered motion is vetoed', async () => {
  let veto = false;
  const rule: ModModule = {
    descriptor: {
      id: 'test:motion-coasting-veto',
      version: '1.0.0',
      permissions: [{ resource: 'seedlands.transport', operations: ['read', 'write', 'execute'] }],
    },
    register(api) {
      api.registerRule({
        id: 'test:motion-coasting-veto',
        operationId: 'sample:advance-transport',
        stage: 'before',
        apply() {
          if (veto) return { reject: 'veto-moving-transport' };
        },
      });
    },
  };
  const { runtime } = await deployAndMountSurfaceCart([rule]);
  sendForwardInput(runtime);
  runtime.advanceSession(200);
  const before = runtime.view().transports![0];
  expect(before.velocity[2]).toBeGreaterThan(0);
  veto = true;
  runtime.advanceSession(17);
  expect(runtime.view().transports![0].pose).toEqual(before.pose);
  expect(runtime.server.getEntity(runtime.playerId)?.position).toEqual([
    before.pose.position[0],
    before.pose.position[1] + 0.55,
    before.pose.position[2],
  ]);
});

it('does not turn reversed replay or wrong-epoch input into additional transport control', async () => {
  const { runtime } = await deployAndMountSurfaceCart();
  const command = sendForwardInput(runtime);
  const reverse = { ...command, state: { ...command.state, moveZ: -1 } };
  expect(runtime.receiveInput(reverse)).toBe('duplicate');
  expect(runtime.receiveInput({ ...reverse, epoch: 'foreign-session', sequence: 1 })).toBe('wrong-epoch');
  runtime.advanceSession(200);
  const after = runtime.view().transports![0];
  expect(after.pose.position[2]).toBeGreaterThan(0.5);
  expect(after.velocity[2]).toBeGreaterThan(0);
  expect(runtime.snapshot().acknowledgedInputSequence).toBe(0);
});

it('rejects an actor attempting to invoke the Host physics system without a physics frame', async () => {
  const { runtime } = await deployAndMountSurfaceCart();
  const before = runtime.view().transports![0];
  const revision = runtime.server.gameplayRevision;
  const result = runtime.server.invokeActorModuleOperation(runtime.playerId, {
    operationId: 'sample:advance-transport',
    target: { kind: 'world' },
  });
  expect(result).toMatchObject({ ok: false, code: 'EXECUTION_KIND_MISMATCH' });
  expect(runtime.server.gameplayRevision).toBe(revision);
  expect(runtime.view().transports![0]).toEqual(before);
});

it('stops both carriers on a relative crossing that each stationary-carrier sweep alone would allow', async () => {
  const { runtime, transport: first } = await deployAndMountSurfaceCart();
  const source = {
    actorId: runtime.playerId,
    entityId: runtime.playerId,
    sourceType: 'test-player',
    capabilities: ['mutation'] as const,
  };
  expect(
    await runtime.executeCommand(source, { type: 'set-mode', mode: 'creative' }, runtime.commandBinding),
  ).toMatchObject({ success: true });
  expect(
    await runtime.executeCommand(
      source,
      { type: 'set-creative-slot', slot: 0, itemId: 'sample:surface-cart-kit' },
      runtime.commandBinding,
    ),
  ).toMatchObject({ success: true });
  const deployed = await runtime.performAction(deploy(runtime, [3, 59, 1], [3, 60, 1], selection(runtime)));
  expect(deployed.result).toMatchObject({ success: true, handled: true });
  const second = runtime.view().transports!.find(({ reference }) => reference.entityId !== first.reference.entityId)!;
  expect(second).toBeDefined();
  expect(
    await runtime.executeCommand(source, { type: 'set-mode', mode: 'survival' }, runtime.commandBinding),
  ).toMatchObject({ success: true });
  // Establish two current canonical velocities with 0.09m of free space. Each 60Hz
  // stationary-obstacle path is shorter than that gap; their relative displacement exceeds it.
  runtime.server.updateEntityWithoutSnapshot(first.reference.entityId, { physicsVelocity: [0, 0, 3] });
  runtime.server.updateEntityWithoutSnapshot(second.reference.entityId, {
    position: [3.5, 60, 1.39],
    physicsVelocity: [0, 0, -3],
  });
  sendForwardInput(runtime);
  runtime.advanceSession(17);
  const transports = runtime.view().transports!;
  const afterFirst = transports.find(({ reference }) => reference.entityId === first.reference.entityId)!;
  const afterSecond = transports.find(({ reference }) => reference.entityId === second.reference.entityId)!;
  expect(afterFirst.pose.position).toEqual([3.5, 60, 0.5]);
  expect(afterSecond.pose.position).toEqual([3.5, 60, 1.39]);
  expect(afterFirst.velocity).toEqual([0, 0, 0]);
  expect(afterSecond.velocity).toEqual([0, 0, 0]);
  expect(runtime.server.getEntity(runtime.playerId)?.position).toEqual([3.5, 60.55, 0.5]);
});
