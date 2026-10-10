import { describe, expect, it } from 'vitest';
import { matchesGameplaySnapshotPredecessorV1 } from '@seedlands/stdlib/mod-api';
import { classicWorldgenProvider } from '@seedlands/playbook-classic/worldgen';
import { classicGameplaySnapshotPredecessors } from '../../../../../../../playbooks/classic/src/legacy-composition-identities';
import { AuthorityRuntime } from '../../../../../../../packages/stdlib/src/server/authority/authority-runtime';
import { MemoryGamePersistence } from '../../../../../../../packages/stdlib/src/server/persistence/memory-game-persistence';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { classicOptions } from '../../../../fixtures/classic/content';
import straightBaseline from '../../../../fixtures/classic/pre-route-shapes-production-v4.json';
import shapeBaseline from '../../../../fixtures/classic/pre-route-transitions-production-v4.json';

describe.each([
  ['straight-only', straightBaseline, '5690ed3c6ddb5207e28dc8a7ae170ab7996230c8', 'classic-straight-v4-source-135'],
  ['ten-shape', shapeBaseline, 'b705f3706a8c43d947d9909b05854aca321cf9dc', 'classic-route-rule-v4-source-137'],
] as const)('%s production V4 compatibility', (_shape, baseline, sourceSha, seedText) => {
  it('accepts the exact captured production composition only for gameplay V4', () => {
    const identity = baseline.gameplay.composition;
    expect(baseline.identitySource.sourceSha).toBe(sourceSha);
    expect(baseline.captureKind).toBe('headless-exact-pre-extension-owner');
    expect(matchesGameplaySnapshotPredecessorV1(classicGameplaySnapshotPredecessors, 4, identity)).toBe(true);
    for (const version of [1, 2, 3])
      expect(matchesGameplaySnapshotPredecessorV1(classicGameplaySnapshotPredecessors, version, identity)).toBe(false);
    for (const change of ['digest', 'route-definition', 'system'] as const) {
      const tampered = structuredClone(identity);
      if (change === 'digest') tampered.packLock[0]!.integrity.entryDigest = 'f'.repeat(64);
      if (change === 'route-definition') {
        const transport = tampered.definitionMap.capabilities.find(
          ({ id }) => id === 'seedlands:transport-interactions',
        );
        if (!transport || !('definitionIdentity' in transport)) throw new Error('Old transport definition is absent.');
        transport.definitionIdentity += 'tampered';
      }
      if (change === 'system') tampered.definitionMap.systems.pop();
      expect(matchesGameplaySnapshotPredecessorV1(classicGameplaySnapshotPredecessors, 4, tampered)).toBe(false);
    }
  });

  it('restores the pre-extension mounted moving carrier without replacing its state or clock phases', async () => {
    const before = structuredClone(baseline.gameplay);
    const persistence = new MemoryGamePersistence({ clone: structuredClone, rawGameplaySnapshot: before });
    const runtime = await AuthorityRuntime.create({
      ...classicOptions(),
      worldgenProvider: classicWorldgenProvider,
      platform: testCorePlatform,
      epoch: 'classic-route-shapes-restored',
      seedText,
      persistence,
      initialWorldTime: 8,
      startTimeMs: 0,
    });
    const carrier = runtime.view().transports![0]!;
    expect(runtime.view().transports).toHaveLength(1);
    expect(carrier.reference).toEqual({
      ...baseline.transport.reference,
      epoch: baseline.transport.reference.epoch + 1,
    });
    expect(carrier.pose).toEqual(baseline.transport.pose);
    expect(carrier.velocity).toEqual(baseline.transport.velocity);
    expect(carrier.routeCursor).toEqual(baseline.transport.routeCursor);
    expect(carrier.rider).toEqual({ ...baseline.transport.rider, epoch: baseline.transport.rider!.epoch + 1 });
    expect(carrier.fuel).toBeNull();
    expect(carrier.inventory).toEqual([]);
    expect(runtime.server.resolveEntityReference(baseline.transport.reference)).toBeNull();
    expect(runtime.server.resolveEntityReference(carrier.reference)?.id).toBe(carrier.reference.entityId);
    expect(runtime.server.getPlayerState(runtime.playerId).inventory).toEqual(before.entityStore.actors[0]!.inventory);
    const restored = runtime.exportPortableCheckpoint().gameplay;
    if (restored.version !== 4 || restored.entityStore.version !== 2)
      throw new Error('Expected current ECS checkpoint.');
    expect(restored.entityStore.identities).toEqual(before.entityStore.identities);
    expect(restored.moduleSchedule).toEqual(before.moduleSchedule);
    expect(before).toEqual(baseline.gameplay);
  });

  it('rejects an unknown pack digest while preserving the captured nonempty source', async () => {
    const before = structuredClone(baseline.gameplay);
    before.composition.packLock[0]!.integrity.entryDigest = '0'.repeat(64);
    const immutable = structuredClone(before);
    const persistence = new MemoryGamePersistence({ clone: structuredClone, rawGameplaySnapshot: before });
    await expect(
      AuthorityRuntime.create({
        ...classicOptions(),
        worldgenProvider: classicWorldgenProvider,
        platform: testCorePlatform,
        epoch: 'classic-route-shapes-unknown',
        seedText,
        persistence,
        initialWorldTime: 8,
        startTimeMs: 0,
      }),
    ).rejects.toThrow();
    expect(before).toEqual(immutable);
  });
});
