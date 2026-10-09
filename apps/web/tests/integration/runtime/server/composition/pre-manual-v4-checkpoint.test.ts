import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assembleOverworldPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
} from '@seedlands/stdlib/host';
import { pack } from '../../../../../../../playbooks/classic/src/pack';
import { classicPreManualV4CompositionIdentity } from '../../../../../../../playbooks/classic/src/pre-manual-v4-composition-identity';
import { GameplayRuntime } from '../../../../../../../packages/stdlib/src/server/gameplay/gameplay-runtime';
import type { GameplaySnapshotV4 } from '../../../../../../../packages/stdlib/src/server/gameplay/gameplay-snapshot';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';

const captured = () =>
  JSON.parse(
    readFileSync(
      new URL(
        '../../../../../../../changes/2026-10-08-pr41-ci-recovery/evidence/pre-manual-v4-runtime-51-01.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as GameplaySnapshotV4;

function create() {
  // Synthetic target identity isolates migration behavior; source identity is an actual captured V4.
  // Independently verified production Pack migration is recorded in checkpoint51 evidence.
  const composition = assembleOverworldPacks([
    {
      ...pack,
      integrity: {
        algorithm: 'sha256',
        manifestDigest: 'a'.repeat(64),
        entryDigest: 'b'.repeat(64),
        resources: pack.manifest.resources!.map((path) => ({ path, digest: 'd'.repeat(64) })),
      },
    },
  ]);
  return new GameplayRuntime({
    composition,
    platform: testCorePlatform,
    moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'capture' }),
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
    worldId: 'manual-cadence-predecessor-capture',
    getVoxel: () => 0,
    getLoadedCell: () => ({ voxel: 0, fluid: 0 }),
    getWorldTime: () => 12,
    prepareVoxelEdit: () => {
      throw new Error('Restore must not edit voxels');
    },
    prepareVoxelEdits: () => {
      throw new Error('Restore must not edit voxels');
    },
  });
}

describe('exact pre-manual Classic V4 checkpoint', () => {
  it('uses the actual captured identity and retains saved gameplay state on restore', () => {
    const old = captured();
    expect(old.composition).toEqual(classicPreManualV4CompositionIdentity);
    const target = create();
    target.spawnPlayer({ id: 'active-before-restore', position: [3, 2, 0] });
    const issued = target.createSnapshot().entityStore.issuedIds;
    expect(target.restoreSnapshot(old)).toEqual({ version: 4, worldTime: 12 });
    const restored = target.createSnapshot();
    expect(restored.entityStore).toEqual({
      ...old.entityStore,
      issuedIds: [...new Set([...issued, ...old.entityStore.issuedIds])].sort(),
    });
    for (const key of [
      'simulation',
      'vehicles',
      'lifeSkills',
      'navigationItems',
      'crops',
      'finalEntities',
      'progress',
      'ruleset',
      'moduleSchedule',
      'media',
    ] as const)
      expect(restored[key]).toEqual(old[key]);
  });

  it.each(['entry', 'definition'] as const)('rejects an altered %s identity without replacing the owner', (kind) => {
    const old = captured();
    const identity = old.composition!;
    old.composition =
      kind === 'entry'
        ? {
            ...identity,
            packLock: identity.packLock.map((entry) => ({
              ...entry,
              integrity: { ...entry.integrity, entryDigest: '0'.repeat(64) },
            })),
          }
        : {
            ...identity,
            definitionMap: {
              ...identity.definitionMap,
              operations: identity.definitionMap.operations.map((operation, index) =>
                index === 0 ? { ...operation, resource: 'seedlands.inventory' } : operation,
              ),
            },
          };
    const target = create();
    target.spawnPlayer({ id: 'active-before-restore', position: [3, 2, 0] });
    const reference = target.entities.createReference('active-before-restore')!;
    const before = target.createSnapshot();
    expect(() => target.restoreSnapshot(old)).toThrow(/composition/i);
    expect(target.createSnapshot()).toEqual(before);
    expect(target.entities.resolveReference(reference)?.id).toBe('active-before-restore');
  });
});
