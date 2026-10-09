import { expect, it } from 'vitest';
import { create, deploy, type Runtime } from './transport-authority-test-fixture';

const setupWalkingWorld = async (withCart: boolean): Promise<Runtime> => {
  const runtime = await create();
  expect(await runtime.server.prepareCanonicalChunkForMutation(0, 1, 0)).toBe(true);
  const floor = Array.from({ length: 13 }, (_, x) => ({ x, y: 59, z: 0, value: withCart && x === 3 ? 5 : 3 }));
  const edits = floor.filter(({ x, y, z, value }) => runtime.server.peekLoadedVoxel(x, y, z)?.voxel !== value);
  if (edits.length) {
    const committed = await runtime.editWorld('transport-collision-walking-fixture', edits);
    expect(committed, JSON.stringify(committed)).toMatchObject({ committed: true });
  }
  for (const { x, y, z, value } of floor)
    expect(runtime.server.peekLoadedVoxel(x, y, z)?.voxel, `floor cell ${x},${y},${z}`).toBe(value);

  if (withCart) {
    const actor = {
      actorId: runtime.playerId,
      entityId: runtime.playerId,
      sourceType: 'test-player',
      capabilities: ['mutation'] as const,
    };
    const creative = await runtime.executeCommand(
      actor,
      { type: 'set-mode', mode: 'creative' },
      runtime.commandBinding,
    );
    expect(creative).toMatchObject({ success: true, data: { mode: 'creative' } });
    const selected = await runtime.executeCommand(
      actor,
      { type: 'set-creative-slot', slot: 0, itemId: 'sample:surface-cart-kit' },
      runtime.commandBinding,
    );
    expect(selected).toMatchObject({ success: true });
    const result = await runtime.performAction(deploy(runtime, [3, 59, 0], [3, 60, 0]));
    expect(result.result, JSON.stringify(result.result)).toMatchObject({ success: true, handled: true });
    expect(runtime.view().transports).toHaveLength(1);
    const survival = await runtime.executeCommand(
      actor,
      { type: 'set-mode', mode: 'survival' },
      runtime.commandBinding,
    );
    expect(survival).toMatchObject({ success: true, data: { mode: 'survival' } });
  }

  return runtime;
};

const walkForward = (runtime: Runtime) => {
  const snapshot = runtime.snapshot();
  const movement = snapshot.player.movement;
  expect(movement).toBeDefined();
  expect(
    runtime.receiveInput({
      kind: 'input',
      protocolVersion: 1,
      epoch: snapshot.epoch,
      stream: 'player-input',
      sequence: 0,
      targetPhysicsTick: snapshot.physicsTick + 1,
      issuedAtMs: snapshot.activeTimeMs + 1,
      movementRevision: movement!.revision,
      state: { moveX: 1, moveZ: 0, verticalIntent: 0, jumpHeld: false },
      edges: { jumpPressed: false },
    }),
  ).toBe('accepted');

  for (let tick = 0; tick < 55; tick += 1) runtime.advanceSession(50);
  return [...runtime.server.getEntity(runtime.playerId)!.position] as [number, number, number];
};

it('blocks ordinary walking at a deployed transport while the same route is clear without one', async () => {
  const openRuntime = await setupWalkingWorld(false);
  const openPosition = walkForward(openRuntime);
  expect(openPosition[0]).toBeGreaterThan(3.5);

  const blockedRuntime = await setupWalkingWorld(true);
  const transportBefore = blockedRuntime.view().transports![0];
  const blockedPosition = walkForward(blockedRuntime);
  const transportAfter = blockedRuntime.view().transports![0];

  expect(blockedPosition[0], `player passed through deployed transport at x=${blockedPosition[0]}`).toBeLessThanOrEqual(
    3.1 - 0.32 + 0.02,
  );
  expect(blockedPosition[0]).toBeGreaterThan(2);
  expect(transportAfter).toEqual(transportBefore);
});
