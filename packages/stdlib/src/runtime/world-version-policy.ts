export type StoredWorldVersionRecord = {
  worldId: string;
  seedText: string;
  generatorVersion: number;
  updatedAt: number;
};

export type WorldOpenMode = 'continue' | 'continue-legacy' | 'continue-v2' | 'continue-v3' | 'new-current';

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
  if (mode === 'continue-v2' || mode === 'continue-v3') {
    const version = mode === 'continue-v2' ? 2 : 3;
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
