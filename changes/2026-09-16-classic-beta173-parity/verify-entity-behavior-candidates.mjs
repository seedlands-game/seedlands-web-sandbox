const assert = (condition, detail) => {
  if (!condition) throw new Error(detail);
};
const naturalSpawnClass = new Set([
  'Chicken',
  'Cow',
  'Creeper',
  'Ghast',
  'Pig',
  'PigZombie',
  'Sheep',
  'Skeleton',
  'Slime',
  'Spider',
  'Squid',
  'Wolf',
  'Zombie',
]);

export function verifyEntityBehaviorCandidates(catalog, parentById) {
  assert(catalog.schemaVersion === 2, 'entity candidate inheritance schema mismatch');
  const counts = { directLocatedSlots: 0, directGapSlots: 0, inheritedOnlySlots: 0, noLocatedMethodSlots: 0 };
  for (const entry of catalog.records) {
    assert(entry.scopeStatus === parentById.get(entry.caseId)?.scope, `entity candidate scope drift ${entry.caseId}`);
    assert(
      entry.expectedCandidate && entry.fixture?.positive && entry.fixture?.negative,
      `entity candidate incomplete ${entry.caseId}`,
    );
    assert(
      entry.inheritanceChain?.[0] === entry.className && entry.inheritanceChain.at(-1) === 'Entity',
      `entity inheritance chain incomplete ${entry.caseId}`,
    );
    assert(
      new Set(entry.inheritanceChain).size === entry.inheritanceChain.length,
      `entity inheritance cycle ${entry.caseId}`,
    );
    assert(
      entry.methodCandidates.spawn.every((source) => source.method === 'getCanSpawnHere'),
      `false spawn source ${entry.caseId}`,
    );
    assert(
      !entry.methodCandidates.aiAndInteraction.some((source) => source.method === 'attackEntityFrom'),
      `false AI source ${entry.caseId}`,
    );
    assert(
      entry.lightningDerivationCandidates.every((source) => source.method === 'onStruckByLightning'),
      `false lightning derivation ${entry.caseId}`,
    );
    if (!naturalSpawnClass.has(entry.name))
      assert(entry.inheritedMethodCandidates.spawn.length === 0, `false inherited natural spawn ${entry.caseId}`);
    for (const [category, direct] of Object.entries(entry.methodCandidates)) {
      const inherited = entry.inheritedMethodCandidates[category];
      assert(Array.isArray(inherited), `missing inherited category ${entry.caseId} ${category}`);
      for (const candidate of direct)
        assert(candidate.file === `${entry.className}.java`, `direct method owner drift ${entry.caseId}`);
      for (const candidate of inherited)
        assert(
          entry.inheritanceChain.slice(1).includes(candidate.file.replace(/\.java$/, '')),
          `inherited method outside ancestry ${entry.caseId}`,
        );
      if (direct.length) counts.directLocatedSlots++;
      else {
        counts.directGapSlots++;
        if (inherited.length) counts.inheritedOnlySlots++;
        else counts.noLocatedMethodSlots++;
      }
    }
  }
  assert(counts.directLocatedSlots === 114 && counts.directGapSlots === 66, 'entity direct-slot denominator drift');
  assert(counts.inheritedOnlySlots === 51 && counts.noLocatedMethodSlots === 15, 'entity inheritance-slot drift');
  const byName = new Map(catalog.records.map((entry) => [entry.name, entry]));
  assert(
    byName.get('Skeleton')?.inheritedMethodCandidates.spawn.some((source) => source.file === 'EntityMob.java'),
    'skeleton spawn inheritance drift',
  );
  assert(byName.get('Player')?.inheritedMethodCandidates.spawn.length === 0, 'player natural spawn leak');
  return counts;
}
