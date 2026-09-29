import { assertWorldgenProviderIdentity, type KernelWorldgenProviderIdentity } from '@seedlands/kernel/spatial';
import { GENERATOR_VERSION, SUPPORTED_GENERATOR_VERSIONS } from '@seedlands/stdlib/world/voxel';
import {
  selectWorldGeneratorVersion,
  type StoredWorldVersionRecord,
  type WorldOpenMode,
} from '@seedlands/stdlib/runtime/world-version-policy';

type StoredWorld = StoredWorldVersionRecord & { provider?: KernelWorldgenProviderIdentity };

export function selectStoredWorldVersion(
  records: readonly StoredWorld[],
  seed: string,
  provider: KernelWorldgenProviderIdentity,
  mode: WorldOpenMode,
  compatibleLegacyProvider: (candidate: KernelWorldgenProviderIdentity, generatorVersion: number) => boolean = () =>
    false,
): number {
  const version = selectWorldGeneratorVersion(records, seed, GENERATOR_VERSION, mode);
  const selected = records.find((record) => record.seedText === seed && record.generatorVersion === version);
  const relevant = records.some((record) => record.seedText === seed);
  if ((mode !== 'new-current' && relevant && !selected) || !SUPPORTED_GENERATOR_VERSIONS.includes(version))
    throw new Error('存档生成器版本不兼容，请保留原存档并选择创建新版本世界。');
  if (selected) {
    try {
      if (!selected.provider) throw new Error('Missing stored provider identity.');
      try {
        assertWorldgenProviderIdentity(provider, selected.provider, version);
      } catch (error) {
        if (!compatibleLegacyProvider(selected.provider, version)) throw error;
      }
    } catch {
      throw new Error('存档世界生成器身份不兼容，请使用原版本打开，或明确创建新版本世界。');
    }
  }
  return version;
}
