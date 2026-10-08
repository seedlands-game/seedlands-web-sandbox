import { expect, it, vi } from 'vitest';
import { AuthorityRuntime } from '../../../../../packages/stdlib/src/server/authority/authority-runtime';
import { classicOptions } from '../../fixtures/classic/content';
import { classicWorldgenProvider } from '@seedlands/playbook-classic/worldgen';
import { testCorePlatform } from '../../../../../packages/stdlib/tests/support/core-platform';
import { CHUNK_SIZE, Voxel, voxelIndex } from '@seedlands/stdlib/world/voxel';
import { createAuthorityPointerAttackPump } from '../../../src/worker/authority-pointer-attack-target';
import { BrowserAuthorityIngress } from '../../../src/worker/authority-worker-ingress';

async function driver(blocked = false) {
  const runtime = await AuthorityRuntime.create({
    ...classicOptions(),
    platform: testCorePlatform,
    worldgenProvider: classicWorldgenProvider,
    epoch: 'pointer-target',
    seedText: 'pointer-target',
    initialWorldTime: 8,
    startTimeMs: 0,
    initialPlayerBodyPosition: [4.5, 60, 4.5],
    onUnknownChunk: () => undefined,
  });
  const canonical = new Uint16Array(CHUNK_SIZE ** 3);
  for (let x = 0; x < CHUNK_SIZE; x++)
    for (let z = 0; z < CHUNK_SIZE; z++) canonical[voxelIndex(x, 27, z)] = Voxel.Stone;
  if (blocked) canonical[voxelIndex(4, 29, 3)] = Voxel.Stone;
  expect(
    runtime.acceptGeneratedChunk({
      key: '0,1,0',
      cx: 0,
      cy: 1,
      cz: 0,
      chunkRevision: 0,
      generatorVersion: runtime.server.generatorVersion,
      provider: runtime.server.worldgenProvider,
      canonical,
    }),
  ).toBe(true);
  runtime.server.giveItem(runtime.playerId, { itemId: 'wood-sword', count: 1 });
  runtime.server.spawnAutonomousActor({ id: 'near', archetype: 'zombie', position: [4.5, 60, 2.5] });
  runtime.server.spawnAutonomousActor({ id: 'right', archetype: 'zombie', position: [6.5, 60, 4.5] });
  const ingress = new BrowserAuthorityIngress(runtime.playerId);
  const authorize = vi.fn((action) => ingress.action(action));
  const pump = createAuthorityPointerAttackPump(() => runtime, authorize);
  return { runtime, pump, authorize };
}

it('worker selects from fresh canonical actors and direction and enters registered Authority combat', async () => {
  const d = await driver();
  try {
    expect(d.pump.accept({ sequence: 0, gesture: 1, capturedAtTimeOriginMs: 1000, direction: [0, 0, -1] }, 1000)).toBe(
      true,
    );
    const first = await d.pump.service(1000);
    expect(first?.result).toMatchObject({ success: true });
    expect(d.runtime.server.getCombatState(d.runtime.playerId)).toMatchObject({ active: { targetId: 'near' } });
    d.runtime.server.updateEntity('near', { position: [20, 60, 20] });
    expect(d.pump.accept({ sequence: 1, gesture: 1, capturedAtTimeOriginMs: 1200, direction: [0, 0, -1] }, 1200)).toBe(
      true,
    );
    expect(await d.pump.service(1200)).toBeNull();
    expect(d.pump.accept({ sequence: 2, gesture: 1, capturedAtTimeOriginMs: 1400, direction: [1, 0, 0] }, 1400)).toBe(
      true,
    );
    const next = await d.pump.service(1400);
    expect(next).not.toBeNull();
    // Existing combat policy may reject retargeting an active swing; the target is resolved afresh either way.
    expect(d.authorize.mock.calls.map(([action]) => action)).toEqual([
      { type: 'attack', targetId: 'near' },
      { type: 'attack', targetId: 'right' },
    ]);
  } finally {
    d.runtime.server.disposeGameplay();
  }
});

it('unloaded cells fail closed before selecting an otherwise visible canonical actor', async () => {
  const d = await driver();
  try {
    d.runtime.setPlayerPosition([31.5, 60, 4.5]);
    d.runtime.server.updateEntity('right', { position: [33.5, 60, 4.5] });
    d.pump.accept({ sequence: 0, gesture: 1, capturedAtTimeOriginMs: 1000, direction: [1, 0, 0] }, 1000);
    expect(await d.pump.service(1000)).toBeNull();
    expect(d.runtime.server.getCombatState(d.runtime.playerId)?.active).toBeNull();
  } finally {
    d.runtime.server.disposeGameplay();
  }
});

it('loaded canonical occlusion prevents an attack without bypassing the owner transaction', async () => {
  const d = await driver(true);
  try {
    d.pump.accept({ sequence: 0, gesture: 1, capturedAtTimeOriginMs: 1000, direction: [0, 0, -1] }, 1000);
    expect(await d.pump.service(1000)).toBeNull();
    expect(d.authorize).not.toHaveBeenCalled();
    expect(d.runtime.server.getCombatState(d.runtime.playerId)?.active).toBeNull();
  } finally {
    d.runtime.server.disposeGameplay();
  }
});
