import { expect, it } from 'vitest';
import { preparePersistenceWorldgen } from '../../../src/worker/persistence-worldgen-initialize';
import { modularWorldgenProvider } from '../../fixtures/packs/modular-world/modular-world';

const task = {
  databaseName: 'test',
  seedText: 'modular',
  provider: modularWorldgenProvider.identity,
  voxelStorageIds: [0, 500],
  openMode: 'continue' as const,
};

it('prepares persistence with the executable provider supplied by the selected Pack', () => {
  const prepared = preparePersistenceWorldgen(task, [], modularWorldgenProvider);
  expect(prepared.provider.identity).toEqual(modularWorldgenProvider.identity);
  expect(prepared.provider.sampleVoxel).toBe(modularWorldgenProvider.sampleVoxel);
  expect(prepared.config).toMatchObject({
    databaseName: 'test',
    seedText: 'modular',
    provider: modularWorldgenProvider.identity,
    voxelStorageIds: [0, 500],
  });
});

it('rejects a persisted world whose provider identity is not accepted by the selected Pack', () => {
  expect(() =>
    preparePersistenceWorldgen(
      task,
      [
        {
          worldId: 'seedlands:g11:modular',
          seedText: 'modular',
          generatorVersion: 11,
          provider: { ...modularWorldgenProvider.identity, artifactIdentity: 'sample:tampered@1' },
          player: null,
          updatedAt: 1,
        },
      ],
      modularWorldgenProvider,
    ),
  ).toThrow(/不兼容|does not match/);
});
