const assert = (condition, detail) => {
  if (!condition) throw new Error(detail);
};

export function verifyBlockBehaviorCandidates(catalog, parentById) {
  assert(catalog.schemaVersion === 2, 'block candidate inheritance schema mismatch');
  for (const entry of catalog.records) {
    assert(entry.scopeStatus === parentById.get(entry.caseId)?.scope, `block candidate scope drift ${entry.caseId}`);
    assert(
      entry.expectedCandidate && entry.fixture?.positive && entry.fixture?.negative,
      `block candidate incomplete ${entry.caseId}`,
    );
    if (entry.caseId === 'B-000') continue;
    assert(
      entry.inheritanceChain?.[0] === entry.className && entry.inheritanceChain.at(-1) === 'Block',
      `block inheritance chain incomplete ${entry.caseId}`,
    );
    assert(
      new Set(entry.inheritanceChain).size === entry.inheritanceChain.length,
      `block inheritance cycle ${entry.caseId}`,
    );
    for (const candidate of Object.values(entry.methodCandidates).flat())
      assert(
        entry.inheritanceChain.includes(candidate.file.replace(/\.java$/, '')),
        `block source outside inheritance chain ${entry.caseId}`,
      );
  }
  const crop = catalog.records.find((entry) => entry.caseId === 'B-059');
  assert(crop?.inheritanceChain?.join('>') === 'BlockCrops>BlockFlower>Block', 'crop ancestry drift');
  assert(
    crop.methodCandidates.placement.some(
      (candidate) => candidate.file === 'BlockFlower.java' && candidate.method === 'canPlaceBlockAt',
    ),
    'crop placement must resolve BlockFlower override',
  );
}
