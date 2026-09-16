import { describe, expect, it } from 'vitest';
import { AuthorityRuntime } from '@seedlands/stdlib/server/authority/authority-runtime';
import { MemoryGamePersistence } from '@seedlands/stdlib/server/persistence/memory-game-persistence';
import { testCorePlatform } from '../../../../../packages/stdlib/tests/support/core-platform';

class SwitchingGameplayPersistence extends MemoryGamePersistence {
  private replacement: unknown | undefined;

  replaceGameplay(value: unknown): void {
    this.replacement = testCorePlatform.clone(value);
  }

  override loadGameplaySnapshot(): unknown {
    return this.replacement === undefined ? super.loadGameplaySnapshot() : testCorePlatform.clone(this.replacement);
  }
}

describe('Authority uses the Gameplay Kernel frontier', () => {
  it('projects clock, multi-entity physics, transactions, and saves from one commit owner', async () => {
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    const runtime = await AuthorityRuntime.create({
      epoch: 'migration:frontier',
      seedText: 'migration-authority-kernel-frontier',
      platform: testCorePlatform,
      initialWorldTime: 9,
      startTimeMs: 0,
      initialPlayerBodyPosition: [0.5, 33, 0.5],
      persistence,
    });
    const owner = () => runtime.server.authorityExecution;
    expect(runtime.snapshot().commitSequence).toBe(owner().commitSequence);

    const secondPlayer = runtime.server.spawnPlayer({ position: [2.5, 33, 0.5] });
    runtime.setWorldClockRate(0.5);
    expect(runtime.snapshot().commitSequence).toBe(owner().commitSequence);
    const beforePhysics = owner().commitSequence;
    const advanced = runtime.advanceSession(50);
    expect(advanced.snapshot.entities.map(({ id }) => id)).toContain(secondPlayer.id);
    expect(owner().commitSequence).toBeGreaterThan(beforePhysics + 1);
    expect(advanced.snapshot.commitSequence).toBe(owner().commitSequence);

    const expectedCommitSequence = owner().commitSequence;
    const receipt = await runtime.executeTransaction(
      { epoch: 'migration:frontier', issuer: 'test', stream: 'frontier', sequence: 1, expectedCommitSequence },
      () => runtime.setWorldTime(12),
    );
    expect(receipt).toMatchObject({ status: 'executed', commitSequence: owner().commitSequence });
    expect(runtime.snapshot().commitSequence).toBe(owner().commitSequence);
    const beforeSave = runtime.snapshot();
    const portable = runtime.exportPortableCheckpoint();
    expect(portable.gameplay.authoritySession).toBeDefined();
    portable.gameplay.authoritySession!.activeTimeMs += 1_000;
    const exportedScheduler = portable.gameplay.authoritySession!.scheduler as { physicsTick: number };
    exportedScheduler.physicsTick += 1;
    expect(runtime.snapshot()).toMatchObject({
      activeTimeMs: beforeSave.activeTimeMs,
      physicsTick: beforeSave.physicsTick,
    });
    const saved = await runtime.save();
    expect(saved.commitSequence).toBe(owner().commitSequence);
    runtime.server.disposeGameplay();

    const restored = await AuthorityRuntime.create({
      epoch: 'migration:frontier-restored',
      seedText: 'migration-authority-kernel-frontier',
      platform: testCorePlatform,
      initialWorldTime: 9,
      startTimeMs: 0,
      initialPlayerBodyPosition: [0.5, 33, 0.5],
      persistence,
    });
    expect(restored.snapshot()).toMatchObject({
      activeTimeMs: beforeSave.activeTimeMs,
      physicsTick: beforeSave.physicsTick,
      commitSequence: saved.commitSequence,
    });
    const restoredBeforeSubTick = restored.server.commitSequence;
    const subTick = restored.advanceSession(1).snapshot;
    expect(subTick.physicsTick).toBe(beforeSave.physicsTick);
    expect(subTick.commitSequence).toBe(restoredBeforeSubTick + 1);
    expect(subTick.commitSequence).toBe(restored.server.authorityExecution.commitSequence);
    restored.server.disposeGameplay();
  });

  it('rejects a mismatched scheduler frontier before replacing the live Kernel owner', async () => {
    const persistence = new SwitchingGameplayPersistence({ clone: testCorePlatform.clone });
    const runtime = await AuthorityRuntime.create({
      epoch: 'migration:invalid-scheduler',
      seedText: 'migration-invalid-scheduler',
      platform: testCorePlatform,
      initialWorldTime: 9,
      startTimeMs: 0,
      initialPlayerBodyPosition: [0.5, 33, 0.5],
      persistence,
    });
    runtime.advanceSession(50);
    await runtime.save();
    const before = runtime.snapshot();
    const beforeEpoch = runtime.server.authorityExecution.epoch;
    const corrupt = runtime.exportPortableCheckpoint();
    const scheduler = corrupt.gameplay.authoritySession!.scheduler as { physicsTick: number };
    scheduler.physicsTick += 1;
    persistence.replaceGameplay(corrupt.gameplay);

    await expect(runtime.server.restore()).rejects.toThrow(/scheduler.*session frontier/i);
    expect(runtime.snapshot()).toEqual(before);
    expect(runtime.server.authorityExecution.epoch).toBe(beforeEpoch);
    runtime.server.disposeGameplay();
  });
});
