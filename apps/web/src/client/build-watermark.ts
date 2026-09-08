const GIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

export function formatBuildWatermark(commitSha: string | undefined, generatorVersion: number): string | null {
  const normalizedSha = commitSha?.trim();
  if (!normalizedSha || !GIT_SHA_PATTERN.test(normalizedSha)) return null;
  return `commit ${normalizedSha.slice(0, 7)} · generator v${generatorVersion}`;
}
