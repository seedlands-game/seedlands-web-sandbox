import { readFile } from 'node:fs/promises';

export async function currentBrowserEvidence(path, key, fallback, expectedRunId, sourceSha) {
  if (!expectedRunId)
    return { ...fallback, note: `${fallback.note} Run pnpm harness for fresh, correlated browser evidence.` };
  try {
    const result = JSON.parse(await readFile(path, 'utf8'));
    const matchingRun = result.runId === expectedRunId && result.sourceSha === sourceSha;
    const matchingEnvironment =
      result.environment?.node === process.version &&
      result.environment?.platform === process.platform &&
      result.environment?.arch === process.arch;
    if (!matchingRun || !matchingEnvironment)
      return {
        status: 'NOT_COLLECTED',
        note: 'Browser result metadata does not match this Harness run, source SHA, or environment.',
      };
    return result[key];
  } catch {
    return fallback;
  }
}
