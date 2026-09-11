import { testCorePlatform } from '../../../../../../packages/stdlib/tests/support/core-platform';
import { testWorldgenExecutableProvider } from '../../../../../../packages/stdlib/tests/support/worldgen';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserAuthorityClient } from '../../../../src/client/authority/browser-authority-client';
import { createHarnessSnapshot } from '../../../../src/app/game-harness';
import { AuthorityRuntime } from '../../../../../../packages/stdlib/src/server/authority/authority-runtime';
import { MemoryGamePersistence } from '../../../../../../packages/stdlib/src/server/persistence/memory-game-persistence';
import { Voxel } from '../../../../../../packages/stdlib/src/world/voxel';

describe('Authority canonical residency observability', () => {
  it('把真实驻留压力与异步保存失败投影到Authority快照和Harness', async () => {
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    const runtime = await AuthorityRuntime.create({
      platform: testCorePlatform,
      worldgenProvider: testWorldgenExecutableProvider,
      epoch: 'residency-observability:1',
      seedText: 'residency-observability',
      persistence,
      initialWorldTime: 9,
      startTimeMs: 0,
      initialPlayerBodyPosition: [0.5, 33, 0.5],
      canonicalResidency: { target: 2, hardLimit: 8, evictionBatch: 2 },
    });
    for (let cx = 0; cx < 4; cx += 1)
      expect(
        (await runtime.editWorld('residency-observability', [{ x: cx * 32, y: 63, z: 0, value: Voxel.Lantern }]))
          .committed,
      ).toBe(true);
    persistence.failNextFrozenSave(new Error('observable residency save failure'));

    runtime.wake(20);
    await vi.waitFor(() => expect(runtime.residencyDiagnostics.autoSaveFailureCount).toBe(1));
    const snapshot = runtime.wake(40);
    expect(snapshot.diagnostics?.residency).toMatchObject({
      residentCount: 4,
      dirtyCount: 4,
      target: 2,
      autoSaveFailureCount: 1,
      lastSaveError: 'observable residency save failure',
    });

    const harness = createHarnessSnapshot({
      world: null,
      environment: null,
      controller: null,
      frameMs: 16,
      qualityLevel: 'medium',
      authority: { snapshot } as unknown as BrowserAuthorityClient,
      compute: null,
      logic: null,
      authorityTrajectory: [],
      ui: {} as never,
      presentedEntityCount: 0,
      visualEffects: null,
      underwaterVisual: null,
    });
    expect(harness.authority.residency).toEqual(snapshot.diagnostics?.residency);
  });
});
