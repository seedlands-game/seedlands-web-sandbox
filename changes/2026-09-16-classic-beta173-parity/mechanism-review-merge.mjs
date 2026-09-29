const reconstructedCommit = '740c583901e1ff1150e9ef37e37dab5bc0e4f807';
const wikiCommit = '8bcc41aee34334c2b916e7b500abe6853b4fd704';
const bases = {
  S: `https://github.com/jacobo-mc/mc_b1.7.3_release/blob/${reconstructedCommit}/1.7.3-LTS/src/minecraft/net/minecraft/src`,
  C: `https://github.com/jacobo-mc/mc_b1.7.3_release/blob/${reconstructedCommit}/1.7.3-LTS/src/minecraft/net/minecraft/client`,
  W: `https://github.com/OfficialPixelBrush/beta-wiki/blob/${wikiCommit}`,
};
export function isStalePlayEvidence(uri, reviewedUris) {
  return (
    uri.startsWith('https://minecraft.fandom.com/') ||
    ((uri.startsWith(`${bases.S}/`) || uri.startsWith(`${bases.C}/`)) && !reviewedUris.has(uri))
  );
}

export function parseMechanismSourceReview(markdown) {
  const byId = new Map();
  for (const line of markdown.split('\n')) {
    if (!/^\| M\d\d-\d\d \|/.test(line)) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((part) => part.trim());
    if (cells.length !== 4 || byId.has(cells[0]) || !['支持', '部分', '冲突'].includes(cells[1]))
      throw new Error(`invalid or duplicate source review row: ${cells[0]}`);
    const sourceUris = [];
    for (const [, kind, raw] of cells[2].matchAll(/`([SCW])\/([^`]+)`/g)) {
      const [first, ...more] = raw.split(',');
      const split = first.indexOf('#L');
      if (split < 1) throw new Error(`missing source line anchor: ${cells[0]} ${raw}`);
      const file = first.slice(0, split);
      for (const anchor of [first.slice(split), ...more]) {
        if (!/^#L\d+(?:-L?\d+)?$/.test(anchor)) throw new Error(`invalid source line anchor: ${cells[0]} ${anchor}`);
        sourceUris.push(`${bases[kind]}/${file}${anchor}`);
      }
    }
    if (!sourceUris.length) throw new Error(`source review has no fixed link: ${cells[0]}`);
    byId.set(cells[0], { verdict: cells[1], sourceUris: [...new Set(sourceUris)] });
  }
  return byId;
}

export function mergeMechanismSourceReview(cases, playCandidates, sourceReview) {
  const parents = new Map(cases.map((entry) => [entry.caseId, entry]));
  const reconstructed = playCandidates.cases.filter(
    (entry) => entry.classification === 'RECONSTRUCTED_SOURCE_CANDIDATE',
  );
  if (sourceReview.size !== reconstructed.length) throw new Error('mechanism source review denominator mismatch');
  for (const candidate of reconstructed) {
    const parent = parents.get(candidate.caseId);
    const review = sourceReview.get(candidate.caseId);
    if (!parent?.expected?.sourcedPartialExpected || !review)
      throw new Error(`missing mechanism parent/review: ${candidate.caseId}`);
    parent.expected.sourcedPartialExpected = candidate.candidateExpected;
    parent.sourceReview = {
      status: 'STATIC_CANDIDATE_NOT_APPROVED',
      originalCandidateVerdict: review.verdict,
      sourceUris: review.sourceUris,
    };
    const reviewedUris = new Set(review.sourceUris);
    parent.evidence = parent.evidence.filter((source) => !isStalePlayEvidence(source.uri, reviewedUris));
    const existing = new Set(parent.evidence.map((source) => source.uri));
    for (const uri of review.sourceUris) {
      if (existing.has(uri)) continue;
      parent.evidence.push({
        uri,
        supports: `fixed source line candidate for ${candidate.caseId}; not official-jar equivalence`,
      });
    }
  }
}
