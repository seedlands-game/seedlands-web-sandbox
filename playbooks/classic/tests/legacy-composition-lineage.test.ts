import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { CompositionCheckpointIdentity } from '@seedlands/stdlib/mod-api';
import {
  classicGameplaySnapshotPredecessors,
  classicKernelMigrationCompositionIdentity,
} from '../src/legacy-composition-identities';
import { classicRetiredActorsMigration } from '../src/retired-actors-migration';

const captured = (): CompositionCheckpointIdentity => {
  const checkpoint = JSON.parse(
    gunzipSync(
      readFileSync(new URL('../../../apps/web/tests/fixtures/checkpoints/base-checkpoint.json.gz', import.meta.url)),
    ).toString('utf8'),
  ) as { args: [{ snapshot: { gameplay: { composition: CompositionCheckpointIdentity } } }] };
  return checkpoint.args[0].snapshot.gameplay.composition;
};
const deeplyFrozen = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return true;
  return Object.isFrozen(value) && Object.values(value).every(deeplyFrozen);
};

describe('Classic gameplay snapshot lineage', () => {
  it('owns the exact captured c18a890 composition without a runtime fixture dependency', () => {
    expect(classicKernelMigrationCompositionIdentity).toEqual(captured());
    expect(classicGameplaySnapshotPredecessors[0]?.gameplayVersions).toEqual([1, 2, 3, 4]);
    expect(deeplyFrozen(classicGameplaySnapshotPredecessors)).toBe(true);
  });

  it('reprojects exact captured V4 identity but leaves a tampered source for the guard to reject', () => {
    const target = structuredClone(captured());
    target.packLock[0]!.integrity.manifestDigest = 'f'.repeat(64);
    const exact = { version: 4, composition: captured() };
    const migrated = classicRetiredActorsMigration.migrate(exact, { targetComposition: target });
    expect((migrated.snapshot as typeof exact).composition).toEqual(target);

    const tampered = structuredClone(exact);
    tampered.composition.definitionMap.operations.pop();
    const rejected = classicRetiredActorsMigration.migrate(tampered, { targetComposition: target });
    expect((rejected.snapshot as typeof exact).composition).toEqual(tampered.composition);
    expect((rejected.snapshot as typeof exact).composition).not.toEqual(target);
  });
});
