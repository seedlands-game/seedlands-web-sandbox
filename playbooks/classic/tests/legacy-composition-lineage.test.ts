import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { matchesGameplaySnapshotPredecessorV1, type CompositionCheckpointIdentity } from '@seedlands/stdlib/mod-api';
import { assembleOverworldPacks } from '@seedlands/stdlib/host';
import {
  classicGameplaySnapshotPredecessors,
  classicKernelMigrationCompositionIdentity,
} from '../src/legacy-composition-identities';
import { classicRetiredActorsMigration } from '../src/retired-actors-migration';
import { pack } from '../src/pack';
import { classicPreDeathV4CompositionIdentity } from '../src/pre-death-v4-composition-identity';
import { canonicalCompositionCheckpointIdentity } from '../../../packages/stdlib/src/server/composition/checkpoint-identity';

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
const preDeathV4Captured = (): CompositionCheckpointIdentity => {
  const capture = JSON.parse(
    readFileSync(
      new URL(
        '../../../changes/2026-09-23-classic-functional-completion/evidence/v2-death-mixed-series-01/pre-death-v4-identity.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as { identity: { value: CompositionCheckpointIdentity } };
  return capture.identity.value;
};
const currentComposition = () =>
  assembleOverworldPacks([
    {
      ...pack,
      integrity: {
        algorithm: 'sha256',
        manifestDigest: 'a'.repeat(64),
        entryDigest: 'b'.repeat(64),
        resources: pack.manifest.resources!.map((path) => ({ path, digest: 'c'.repeat(64) })),
      },
    },
  ]);

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

  it('installs the one frozen Classic death policy capability in the production composition', () => {
    const composition = currentComposition();
    const definitions = composition.definitionMap.capabilities.filter(
      ({ id }) => id === 'seedlands:death-inventory-policy',
    );
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({
      moduleId: 'seedlands:overworld-death-inventory-policy',
      version: '1.0.0',
    });
    expect(
      composition
        .capability<{ policyFor(kind: 'player' | 'creature' | 'npc'): unknown }>('seedlands:death-inventory-policy')
        .policyFor('player'),
    ).toEqual({ inventory: 'drop', cursor: 'drop', crafting: 'drop', armor: 'drop', actor: 'retain' });
  });

  it('accepts only the full captured pre-death V4 identity', () => {
    const exact = preDeathV4Captured();
    expect(classicPreDeathV4CompositionIdentity).toEqual(exact);
    expect(
      createHash('sha256')
        .update(canonicalCompositionCheckpointIdentity(classicPreDeathV4CompositionIdentity))
        .digest('hex'),
    ).toBe('e799b930b686da9a8bd34d9052e4179e8624013bcbc774da81ff672ed6cd724a');
    expect(classicGameplaySnapshotPredecessors.map(({ identity }) => identity)).toContainEqual(exact);
    expect(matchesGameplaySnapshotPredecessorV1(classicGameplaySnapshotPredecessors, 4, exact)).toBe(true);
    expect(exact.definitionMap.modules).toHaveLength(22);
    expect(exact.definitionMap.capabilities).toHaveLength(28);

    for (const altered of [
      {
        ...exact,
        definitionMap: {
          ...exact.definitionMap,
          modules: [
            ...exact.definitionMap.modules,
            { id: 'sample:unknown', packId: 'seedlands:overworld', version: '1.0.0' },
          ],
        },
      },
      {
        ...exact,
        definitionMap: {
          ...exact.definitionMap,
          capabilities: [
            ...exact.definitionMap.capabilities,
            {
              id: 'sample:unknown',
              moduleId: 'seedlands:overworld-content',
              version: '1.0.0',
            },
          ],
        },
      },
      {
        ...exact,
        definitionMap: {
          ...exact.definitionMap,
          modules: exact.definitionMap.modules.map((entry, index) =>
            index === 0 ? { ...entry, version: '9.9.9' } : entry,
          ),
        },
      },
      {
        ...exact,
        definitionMap: {
          ...exact.definitionMap,
          capabilities: exact.definitionMap.capabilities.map((entry) =>
            entry.definitionIdentity === undefined ? entry : { ...entry, definitionIdentity: '{}' },
          ),
        },
      },
      {
        ...exact,
        definitionMap: {
          ...exact.definitionMap,
          capabilities: exact.definitionMap.capabilities.map((entry, index) =>
            index === 0 ? { ...entry, version: '9.9.9' } : entry,
          ),
        },
      },
      {
        ...exact,
        definitionMap: {
          ...exact.definitionMap,
          resources: [...exact.definitionMap.resources, { id: 'sample.unknown', operations: ['read' as const] }],
        },
      },
      {
        ...exact,
        packLock: exact.packLock.map((entry, index) =>
          index === 0 ? { ...entry, integrity: { ...entry.integrity, entryDigest: '0'.repeat(64) } } : entry,
        ),
      },
      {
        ...exact,
        packLock: exact.packLock.map((entry, index) =>
          index === 0 ? { ...entry, integrity: { ...entry.integrity, manifestDigest: '0'.repeat(64) } } : entry,
        ),
      },
      {
        ...exact,
        packLock: exact.packLock.map((entry, index) =>
          index === 0
            ? {
                ...entry,
                integrity: {
                  ...entry.integrity,
                  resources: entry.integrity.resources.map((resource, resourceIndex) =>
                    resourceIndex === 0 ? { ...resource, digest: '0'.repeat(64) } : resource,
                  ),
                },
              }
            : entry,
        ),
      },
    ])
      expect(matchesGameplaySnapshotPredecessorV1(classicGameplaySnapshotPredecessors, 4, altered)).toBe(false);
  });
});
