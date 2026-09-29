const sourceBase =
  'https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src';

export function resolveWorldSourceLocations(locations) {
  let previousFile = null;
  const anchored = [];
  const fileOnly = [];
  for (const location of locations) {
    const full = location.match(/^([A-Za-z][A-Za-z\d]*\.java)(#L\d+(?:-L\d+)?)?$/);
    const continuation = location.match(/^L\d+(?:-L\d+)?$/);
    if (full) {
      previousFile = full[1];
      (full[2] ? anchored : fileOnly).push(`${sourceBase}/${location}`);
    } else if (continuation && previousFile) {
      anchored.push(`${sourceBase}/${previousFile}#${location}`);
    } else {
      throw new Error(`invalid world source location: ${location}`);
    }
  }
  return { anchored: [...new Set(anchored)], fileOnly: [...new Set(fileOnly)] };
}

export function mergeWorldMechanismCandidates(cases, catalog) {
  const parents = new Map(cases.map((entry) => [entry.caseId, entry]));
  if (catalog.cases.length !== 42) throw new Error('world mechanism candidate denominator mismatch');
  for (const candidate of catalog.cases) {
    const parent = parents.get(candidate.caseId);
    if (!parent || parent.kind !== 'mechanism' || typeof parent.expected?.sourcedPartialExpected !== 'string')
      throw new Error(`missing world mechanism parent: ${candidate.caseId}`);
    const locations = resolveWorldSourceLocations(candidate.sourceLocations);
    parent.expected.sourcedPartialExpected = candidate.candidateExpected;
    parent.candidateSourceSync = {
      status: 'STATIC_CANDIDATE_NOT_APPROVED',
      anchoredSourceUris: locations.anchored,
      fileOnlyNavigationUris: locations.fileOnly,
    };
    parent.evidence = parent.evidence.filter((source) => !source.uri.startsWith(`${sourceBase}/`));
    for (const uri of locations.anchored) {
      parent.evidence.push({
        uri,
        supports: `world mechanism candidate for ${candidate.caseId}; not official-jar equivalence`,
      });
    }
    for (const uri of locations.fileOnly) {
      parent.evidence.push({ uri, supports: `navigation only for ${candidate.caseId}; exact line still to review` });
    }
  }
}
