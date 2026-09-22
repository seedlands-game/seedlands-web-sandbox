import {
  assertWorldgenProviderIdentity,
  createWorldgenProviderRegistry,
  type KernelWorldgenProvider,
} from '@seedlands/kernel/spatial';
import { GENERATOR_VERSION } from '@seedlands/stdlib/world/voxel';
import { selectStoredWorldVersion } from '../client/persistence/stored-world-selection';
import type { PersistenceWorkerConfig, PersistenceWorldRecord } from './persistence-worker-protocol';

export function preparePersistenceWorldgen(
  task: Pick<PersistenceWorkerConfig, 'databaseName' | 'seedText' | 'provider' | 'voxelStorageIds'> & {
    openMode: import('@seedlands/stdlib/runtime/world-version-policy').WorldOpenMode;
  },
  records: readonly PersistenceWorldRecord[],
  loadedProvider: KernelWorldgenProvider,
) {
  const generatorVersion = selectStoredWorldVersion(
    records,
    task.seedText,
    task.provider,
    task.openMode,
    loadedProvider.acceptsStoredIdentity,
  );
  const provider = createWorldgenProviderRegistry([loadedProvider]).resolve(task.provider, generatorVersion);
  const worldId = `seedlands:g${generatorVersion}:${task.seedText}`;
  const existing = records.find((record) => record.worldId === worldId);
  if (task.openMode === 'continue-legacy' && generatorVersion === GENERATOR_VERSION)
    throw new Error('这个 Seed 没有可继续的旧版世界。');
  if (existing && (existing.seedText !== task.seedText || existing.generatorVersion !== generatorVersion))
    throw new Error('Stored world metadata is incompatible with the requested seed or generator.');
  if (existing) {
    const storedProvider = existing.provider;
    if (!storedProvider) throw new Error('Stored world has no world-generation provider identity.');
    try {
      assertWorldgenProviderIdentity(provider.identity, storedProvider, generatorVersion);
    } catch (error) {
      if (!provider.acceptsStoredIdentity?.(storedProvider, generatorVersion)) throw error;
    }
  }
  const config: PersistenceWorkerConfig = {
    databaseName: task.databaseName,
    worldId,
    seedText: task.seedText,
    generatorVersion,
    provider: provider.identity,
    voxelStorageIds: Object.freeze([...new Set(task.voxelStorageIds)]),
  };
  return Object.freeze({ config, provider, existing });
}
