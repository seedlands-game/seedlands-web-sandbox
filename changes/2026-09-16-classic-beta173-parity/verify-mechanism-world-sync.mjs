import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveWorldSourceLocations } from './mechanism-world-merge.mjs';

export async function verifyWorldMechanismSync(root, catalog, worldCandidates) {
  const parents = new Map(catalog.cases.map((entry) => [entry.caseId, entry]));
  const acceptance = await readFile(join(root, 'mechanism-acceptance-audit.md'), 'utf8');
  const acceptanceRows = new Map(
    acceptance
      .split('\n')
      .filter((line) => /^\| M(?:0[2-9]|1[0-3])-\d\d \|/.test(line))
      .map((line) => {
        const cells = line
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim());
        if (cells.length !== 8) throw new Error(`invalid world acceptance row: ${cells[0]}`);
        return [cells[0], cells];
      }),
  );
  if (worldCandidates.cases.length !== 42) throw new Error('world mechanism denominator drift');
  if (acceptanceRows.size !== worldCandidates.cases.length) throw new Error('world acceptance denominator drift');
  for (const candidate of worldCandidates.cases) {
    const parent = parents.get(candidate.caseId);
    const locations = resolveWorldSourceLocations(candidate.sourceLocations);
    const row = acceptanceRows.get(candidate.caseId);
    if (
      row?.[1] !== candidate.behavior ||
      row[3] !== candidate.candidateExpected ||
      row[4] !== candidate.sourceLocations.join('、') ||
      row[5] !== candidate.negativeControl
    )
      throw new Error(`world mechanism acceptance drift ${candidate.caseId}`);
    if (parent?.expected?.sourcedPartialExpected !== candidate.candidateExpected)
      throw new Error(`world mechanism expected drift ${candidate.caseId}`);
    if (parent.candidateSourceSync?.status !== 'STATIC_CANDIDATE_NOT_APPROVED')
      throw new Error(`world mechanism status drift ${candidate.caseId}`);
    const actual = parent.candidateSourceSync.anchoredSourceUris;
    if (JSON.stringify(actual) !== JSON.stringify(locations.anchored))
      throw new Error(`world mechanism source anchor drift ${candidate.caseId}`);
    if (JSON.stringify(parent.candidateSourceSync.fileOnlyNavigationUris) !== JSON.stringify(locations.fileOnly))
      throw new Error(`world mechanism file-only source drift ${candidate.caseId}`);
    for (const uri of locations.anchored) {
      if (!parent.evidence.some((entry) => entry.uri === uri))
        throw new Error(`world mechanism parent evidence missing ${candidate.caseId}: ${uri}`);
    }
    const actualReconstructedUris = parent.evidence
      .filter((entry) => entry.uri.startsWith('https://github.com/jacobo-mc/mc_b1.7.3_release/blob/'))
      .map((entry) => entry.uri);
    if (JSON.stringify(actualReconstructedUris) !== JSON.stringify([...locations.anchored, ...locations.fileOnly]))
      throw new Error(`world mechanism stale evidence ${candidate.caseId}`);
  }
  return worldCandidates.cases.length;
}
