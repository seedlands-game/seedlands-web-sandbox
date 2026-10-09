import { expect, it } from 'vitest';
import { defineTransportMotionModule, defineTransportRelationModule, type ModModule } from '@seedlands/stdlib/mod-api';
import { addRoute, create, deploy, selection, putVoxel } from './transport-authority-test-fixture';

async function setup(extraModules: readonly ModModule[] = [], slope: 0 | 1 = 0) {
  const runtime = await create(
    undefined,
    undefined,
    [
      ...extraModules,
      defineTransportRelationModule({ moduleId: 'sample:route-relations', operationId: 'sample:relate-route' }),
      defineTransportMotionModule({
        moduleId: 'sample:route-motion',
        operationId: 'sample:advance-route',
        systemId: 'sample:route-physics',
        policies: [
          {
            definitionId: 'sample:route-cart',
            acceleration: 4,
            drag: 2,
            maxSpeed: 3,
            steeringRate: 0,
            fuelPerMeter: 0,
          },
        ],
      }),
    ],
    slope,
  );
  if (slope === 0) {
    await addRoute(runtime);
    for (let x = 3; x <= 8; x++) await putVoxel(runtime, [x, 59, 0], 6);
  } else {
    // Explicit empty fixture corridor, rather than silently treating absent cells as Air.
    const edits = [];
    for (let x = 0; x <= 4; x++) for (let y = 58; y <= 63; y++) edits.push({ x, y, z: 0, value: y === 58 + x ? 6 : 0 });
    expect(await runtime.editWorld('registered-route-slope-fixture', edits)).toMatchObject({ committed: true });
  }
  runtime.server.giveItem(runtime.playerId, { itemId: 'sample:route-cart-kit', count: 1 });
  const deployed = await runtime.performAction(deploy(runtime, [1, 59, 0], [1, 60, 0]));
  expect(deployed.result).toMatchObject({ success: true, handled: true });
  const before = runtime.view().transports![0]!;
  const mounted = await runtime.performAction({
    type: 'interact',
    intent: 'use',
    target: { kind: 'entity', reference: before.reference },
    expectedSelection: selection(runtime),
  });
  expect(mounted.result).toMatchObject({ success: true, handled: true });
  return runtime;
}

function forward(runtime: Awaited<ReturnType<typeof setup>>, moveX = 1, moveZ = 0, sequence = 0) {
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
}

it('advances a normally deployed and mounted route cart through the registered physics system', async () => {
  const runtime = await setup();
  const before = runtime.view().transports![0]!;
  forward(runtime);
  runtime.advanceSession(1_000);
  const after = runtime.view().transports![0]!;
  expect(after.pose.position[0]).toBeGreaterThan(before.pose.position[0] + 0.1);
  expect(after.pose.position[1]).toBe(59);
  expect(after.pose.position[2]).toBe(0.5);
  expect(after.velocity[0]).toBeGreaterThan(0);
  expect(after.routeCursor!.cell[0]).toBeGreaterThan(before.routeCursor!.cell[0]);
  expect(after.reference).toEqual(before.reference);
  expect(after.fuel).toBe(before.fuel);
  expect(after.inventory).toEqual(before.inventory);
  expect(after.rider).toEqual(runtime.server.createEntityReference(runtime.playerId));
  expect(runtime.server.getEntity(runtime.playerId)!.position).toEqual([after.pose.position[0], 59.55, 0.5]);
  expect(runtime.server.getEntity(runtime.playerId)!.physicsVelocity).toEqual(after.velocity);
});

it('advances a normally mounted slope with matching world height, cursor and rider seat', async () => {
  const runtime = await setup([], 1);
  const before = runtime.view().transports![0]!;
  expect(before.pose.position).toEqual([1.5, 59.5, 0.5]);
  forward(runtime);
  runtime.advanceSession(1_000);
  const after = runtime.view().transports![0]!;
  expect(after.pose.position[0]).toBeGreaterThan(2);
  expect(after.pose.position[1]).toBeCloseTo(after.pose.position[0] + 58);
  expect(after.pose.position[2]).toBe(0.5);
  expect(after.velocity[0]).toBeGreaterThan(0);
  expect(after.velocity[1]).toBeCloseTo(after.velocity[0]);
  expect(after.routeCursor!.cell[1]).toBe(after.routeCursor!.cell[0] + 58);
  expect(after.reference).toEqual(before.reference);
  expect(runtime.server.getEntity(runtime.playerId)!.position).toEqual([
    after.pose.position[0],
    after.pose.position[1] + 0.55,
    0.5,
  ]);
  expect(runtime.server.getEntity(runtime.playerId)!.physicsVelocity).toEqual(after.velocity);
});

it('does not move the route carrier or its rider through a loaded solid wall', async () => {
  const runtime = await setup();
  await putVoxel(runtime, [3, 59, 0], 3);
  forward(runtime);
  runtime.advanceSession(1_000);
  const after = runtime.view().transports![0]!;
  expect(after.pose.position[0]).toBeLessThanOrEqual(2.6);
  expect(after.velocity).toEqual([0, 0, 0]);
  expect(after.routeCursor!.cell).toEqual([1, 59, 0]);
  expect(runtime.server.getEntity(runtime.playerId)!.position).toEqual([after.pose.position[0], 59.55, 0.5]);
});

it('keeps an already moving route carrier and rider at their accepted pose after a registered veto', async () => {
  let veto = false;
  let calls = 0;
  const rule: ModModule = {
    descriptor: {
      id: 'sample:route-veto',
      version: '1.0.0',
      permissions: [{ resource: 'seedlands.transport', operations: ['read', 'write', 'execute'] }],
    },
    register(api) {
      api.registerRule({
        id: 'sample:route-veto',
        operationId: 'sample:advance-route',
        stage: 'before',
        apply() {
          calls++;
          if (veto) return { reject: 'route-motion-test-veto' };
        },
      });
    },
  };
  const runtime = await setup([rule]);
  forward(runtime);
  runtime.advanceSession(200);
  const before = runtime.view().transports![0]!;
  expect(before.velocity[0]).toBeGreaterThan(0);
  const beforeCalls = calls;
  veto = true;
  runtime.advanceSession(17);
  expect(calls).toBeGreaterThan(beforeCalls);
  expect(runtime.view().transports![0]).toEqual(before);
  expect(runtime.server.getEntity(runtime.playerId)!.position).toEqual([before.pose.position[0], 59.55, 0.5]);
});

it('rejects Actor calls to the route Host system without writing carrier or rider state', async () => {
  const runtime = await setup();
  const before = runtime.view().transports![0]!;
  const revision = runtime.server.gameplayRevision;
  expect(
    runtime.server.invokeActorModuleOperation(runtime.playerId, {
      operationId: 'sample:advance-route',
      target: { kind: 'world' },
    }),
  ).toMatchObject({ ok: false, code: 'EXECUTION_KIND_MISMATCH' });
  expect(runtime.server.gameplayRevision).toBe(revision);
  expect(runtime.view().transports![0]).toEqual(before);
});

it('does not accelerate along a directed route from a perpendicular world-space wish', async () => {
  const runtime = await setup();
  const before = runtime.view().transports![0]!;
  forward(runtime, 0, 1);
  runtime.advanceSession(1_000);
  const after = runtime.view().transports![0]!;
  expect(after.pose).toEqual(before.pose);
  expect(after.routeCursor).toEqual(before.routeCursor);
  expect(after.velocity).toEqual([0, 0, 0]);
});

it('brakes an already moving directed route without silently reversing its cursor', async () => {
  const runtime = await setup();
  forward(runtime);
  runtime.advanceSession(200);
  const before = runtime.view().transports![0]!;
  expect(before.velocity[0]).toBeGreaterThan(0);
  forward(runtime, -1, 0, 1);
  runtime.advanceSession(1_000);
  const after = runtime.view().transports![0]!;
  expect(after.pose.position[0]).toBeGreaterThanOrEqual(before.pose.position[0]);
  expect(after.velocity).toEqual([0, 0, 0]);
  expect(after.routeCursor!.entry).toEqual(before.routeCursor!.entry);
  expect(after.routeCursor!.exit).toEqual(before.routeCursor!.exit);
  expect(after.fuel).toBe(before.fuel);
});

it('does not publish a route pose or cursor from a physics frame whose observed rail revision changed', async () => {
  const owner: { runtime?: Awaited<ReturnType<typeof setup>> } = {};
  let changed = false;
  const rule: ModModule = {
    descriptor: {
      id: 'sample:route-world-race',
      version: '1.0.0',
      permissions: [{ resource: 'seedlands.transport', operations: ['read', 'write', 'execute'] }],
    },
    register(api) {
      api.registerRule({
        id: 'sample:route-world-race',
        operationId: 'sample:advance-route',
        stage: 'before',
        apply() {
          if (owner.runtime && !changed) {
            // Deliberate owner race through World.edit's normal commit adapter, not a successful player action.
            expect(
              owner.runtime.server.editBatch({
                actorId: 'route-world-race-fixture',
                edits: [{ x: 2, y: 59, z: 0, value: 0 }],
              }),
            ).toMatchObject({ committed: true });
            changed = true;
          }
        },
      });
    },
  };
  const runtime = await setup([rule]);
  forward(runtime);
  runtime.advanceSession(200);
  const before = runtime.view().transports![0]!;
  expect(before.velocity[0]).toBeGreaterThan(0);
  const worldRevision = runtime.server.worldRevision;
  owner.runtime = runtime;
  runtime.advanceSession(17);
  expect(changed).toBe(true);
  expect(runtime.server.worldRevision).toBeGreaterThan(worldRevision);
  expect(runtime.server.peekLoadedVoxel(2, 59, 0)!.voxel).toBe(0);
  expect(runtime.view().transports![0].pose).toEqual(before.pose);
  expect(runtime.view().transports![0].routeCursor).toEqual(before.routeCursor);
  expect(runtime.server.getEntity(runtime.playerId)!.position).toEqual([before.pose.position[0], 59.55, 0.5]);
});
