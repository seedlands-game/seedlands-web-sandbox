export type StoredWorldVersionRecord = {
  worldId: string;
  seedText: string;
  generatorVersion: number;
  updatedAt: number;
};

export type WorldOpenMode = 'continue' | 'continue-legacy' | `continue-v${number}` | 'new-current';

export function selectWorldGeneratorVersion(
  records: readonly StoredWorldVersionRecord[],
  seedText: string,
  currentVersion: number,
  mode: WorldOpenMode = 'continue',
): number {
  if (mode === 'new-current') return currentVersion;
  const versions = records
    .filter((record) => record.seedText === seedText && Number.isInteger(record.generatorVersion))
    .map((record) => record.generatorVersion);
  if (mode.startsWith('continue-v')) {
    const version = Number(mode.slice('continue-v'.length));
    if (!Number.isSafeInteger(version) || version < 1) throw new Error('世界版本选择无效。');
    if (!versions.includes(version)) throw new Error(`这个 Seed 没有可继续的 v${version} 世界。`);
    return version;
  }
  if (mode === 'continue-legacy')
    return (
      versions.filter((version) => version > 0 && version < currentVersion).sort((a, b) => b - a)[0] ?? currentVersion
    );
  if (versions.includes(currentVersion)) return currentVersion;
  return (
    versions.filter((version) => version > 0 && version < currentVersion).sort((a, b) => b - a)[0] ?? currentVersion
  );
}
