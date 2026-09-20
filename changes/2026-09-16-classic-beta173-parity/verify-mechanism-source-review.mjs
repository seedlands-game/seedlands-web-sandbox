import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isStalePlayEvidence, parseMechanismSourceReview } from './mechanism-review-merge.mjs';

export async function verifyMechanismSourceReview(root, catalog, playCandidates) {
  const text = await readFile(join(root, 'mechanism-play-source-review.md'), 'utf8');
  const acceptanceText = await readFile(join(root, 'mechanism-acceptance-audit.md'), 'utf8');
  const reviews = parseMechanismSourceReview(text);
  const candidates = playCandidates.cases.filter((entry) => entry.classification === 'RECONSTRUCTED_SOURCE_CANDIDATE');
  const parents = new Map(catalog.cases.map((entry) => [entry.caseId, entry]));
  const acceptanceRows = new Map(
    acceptanceText
      .split('\n')
      .filter((line) => /^\| M\d\d-\d\d \|/.test(line))
      .map((line) => {
        const cells = line
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim());
        return [cells[0], cells];
      }),
  );
  if (reviews.size !== candidates.length) throw new Error('play mechanism source review denominator mismatch');
  for (const candidate of candidates) {
    const parent = parents.get(candidate.caseId);
    const review = reviews.get(candidate.caseId);
    if (!review || parent?.expected?.sourcedPartialExpected !== candidate.candidateExpected)
      throw new Error(`stale mechanism parent expected ${candidate.caseId}`);
    const acceptance = acceptanceRows.get(candidate.caseId);
    if (
      acceptance?.length !== 8 ||
      acceptance[3] !== candidate.candidateExpected ||
      acceptance[4] !== candidate.sourceLocations.join('、')
    )
      throw new Error(`stale mechanism acceptance row ${candidate.caseId}`);
    if (
      parent.sourceReview?.status !== 'STATIC_CANDIDATE_NOT_APPROVED' ||
      !review.sourceUris.every(
        (uri) => parent.sourceReview.sourceUris.includes(uri) && parent.evidence.some((source) => source.uri === uri),
      )
    )
      throw new Error(`missing mechanism parent source anchors ${candidate.caseId}`);
    const reviewedUris = new Set(review.sourceUris);
    if (parent.evidence.some((source) => isStalePlayEvidence(source.uri, reviewedUris)))
      throw new Error(`stale mechanism parent evidence ${candidate.caseId}`);
  }
  return reviews.size;
}
