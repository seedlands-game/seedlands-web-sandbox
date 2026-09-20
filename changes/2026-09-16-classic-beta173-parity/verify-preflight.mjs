import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateOpenEndedFamily,
  validateReadyCase,
  validateWholeContractGates,
  verifyWholeContractArtifacts,
  wholeContractGateNames,
} from './verify-design-ready.mjs';
import { verifyBlockBehaviorCandidates } from './verify-block-behavior-candidates.mjs';
import { verifyEntityBehaviorCandidates } from './verify-entity-behavior-candidates.mjs';
import { verifySourcePinPolicy } from './verify-source-pin-policy.mjs';
import { verifyMechanismSourceReview } from './verify-mechanism-source-review.mjs';
import { verifyWorldMechanismSync } from './verify-mechanism-world-sync.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const sourcePinCoverage = await verifySourcePinPolicy(root);
const [
  catalog,
  variants,
  profile,
  blockCandidates,
  recipeFixtures,
  worldCandidates,
  playCandidates,
  entityCandidates,
  itemCandidates,
  exclusionCandidates,
] = await Promise.all(
  [
    'reference-cases.json',
    'variant-cases.json',
    'harness-profile.json',
    'block-behavior-candidates.json',
    'recipe-fixture-candidates.json',
    'mechanism-world-candidates.json',
    'mechanism-play-candidates.json',
    'entity-behavior-candidates.json',
    'item-behavior-candidates.json',
    'exclusion-dependency-candidates.json',
  ].map(async (name) => JSON.parse(await readFile(join(root, name), 'utf8'))),
);
const assert = (condition, detail) => {
  if (!condition) throw new Error(detail);
};
const inc = (counter, key) => {
  counter[key] = (counter[key] ?? 0) + 1;
};

assert(catalog.schemaVersion === 3, 'catalog schema mismatch');
assert(Number.isInteger(catalog.referenceCaseSetVersion), 'missing reference case set version');
assert(
  catalog.referenceCaseSetVersion === profile.referenceCaseSetVersion &&
    profile.scenarioVersion === catalog.referenceCaseSetVersion,
  'profile/catalog version mismatch',
);
assert(
  profile.profileId === `classic-b173-singleplayer-v${catalog.referenceCaseSetVersion}`,
  'profile ID/version mismatch',
);
assert(profile.status === 'DESIGN_ONLY_NOT_EXECUTABLE', 'documentation profile cannot claim execution');
assert(profile.reference.clientSha1 === '43db9b498cb67058d2e12d394e6507722e71bb45', 'reference identity mismatch');
assert(catalog.cases.length === profile.registeredCaseCount, 'catalog/profile denominator mismatch');
assert(variants.referenceCaseSetVersion === catalog.referenceCaseSetVersion, 'variant/catalog version mismatch');
assert(variants.schemaVersion === 2, 'variant schema mismatch');
assert(variants.cases.length === profile.registeredVariantCount, 'variant/profile denominator mismatch');
assert(
  variants.openEndedFamilies.length === profile.registeredOpenEndedFamilyCount,
  'open-ended family denominator mismatch',
);
assert(blockCandidates.referenceCaseSetVersion === catalog.referenceCaseSetVersion, 'block candidate version mismatch');
assert(
  recipeFixtures.sourceCaseSet.referenceCaseSetVersion === catalog.referenceCaseSetVersion,
  'recipe fixture version mismatch',
);
assert(recipeFixtures.schemaVersion === 3, 'recipe fixture schema mismatch');
assert(
  recipeFixtures.sourceCaseSet.profileId === profile.profileId &&
    recipeFixtures.sourceCaseSet.scenarioVersion === profile.scenarioVersion,
  'recipe fixture profile identity mismatch',
);
assert(worldCandidates.profileId === profile.profileId, 'world candidate profile mismatch');
assert(playCandidates.profileId === profile.profileId, 'play candidate profile mismatch');
assert(
  entityCandidates.referenceCaseSetVersion === catalog.referenceCaseSetVersion,
  'entity candidate version mismatch',
);
assert(itemCandidates.referenceCaseSetVersion === catalog.referenceCaseSetVersion, 'item candidate version mismatch');
assert(
  exclusionCandidates.referenceCaseSetVersion === catalog.referenceCaseSetVersion,
  'exclusion candidate version mismatch',
);
assert(
  exclusionCandidates.cases.length === catalog.cases.filter((entry) => entry.scope === '排').length,
  'exclusion denominator mismatch',
);
assert(worldCandidates.caseCount === worldCandidates.cases.length, 'world candidate count mismatch');
assert(playCandidates.caseCount === playCandidates.cases.length, 'play candidate count mismatch');
assert(itemCandidates.counts.total === itemCandidates.entries.length, 'item candidate count mismatch');

const identities = [
  ...Array.from({ length: 97 }, (_, index) => `B-${String(index).padStart(3, '0')}`),
  ...Array.from({ length: 104 }, (_, index) => `I-${256 + index}`),
  'I-2256',
  'I-2257',
  ...Array.from({ length: 57 }, (_, index) => `R-D${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 93 }, (_, index) => `R-H${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 10 }, (_, index) => `R-S${String(index + 1).padStart(2, '0')}`),
];
const ids = new Set();
const kinds = {};
const statuses = {};
const scopes = {};
const variantStatuses = {};
const blockers = {
  noExpected: 0,
  unreviewed: 0,
  fixtureNotFixed: 0,
  unresolved: 0,
  contractNotReady: 0,
  profileReferenceNotReady: 0,
  openEndedNotFixed: 0,
  wholeContractGatesNotApproved: 0,
};
const requiredWholeContractGates = wholeContractGateNames;
assert(validateWholeContractGates(profile).length === 0, 'approved whole-contract gate lacks review evidence');
const artifactErrors = await verifyWholeContractArtifacts(profile, root);
assert(artifactErrors.length === 0, `whole-contract review artifact invalid: ${artifactErrors.join(', ')}`);
const pendingWholeContractGates = requiredWholeContractGates.filter((gate) => {
  const status = profile.wholeContractReview?.[gate];
  assert(['PENDING', 'APPROVED'].includes(status), `invalid whole-contract gate ${gate}`);
  return status !== 'APPROVED';
});
blockers.wholeContractGatesNotApproved = pendingWholeContractGates.length;
assert(
  ['PARTIAL_REFERENCE_GAP', 'REFERENCE_READY'].includes(profile.referenceCaseSetStatus),
  'invalid profile reference status',
);
blockers.profileReferenceNotReady = Number(profile.referenceCaseSetStatus !== 'REFERENCE_READY');
for (const entry of catalog.cases) {
  assert(entry.caseId && !ids.has(entry.caseId), `duplicate or missing ID ${entry.caseId}`);
  ids.add(entry.caseId);
  assert(entry.action && ['做', '存', '排', '核'].includes(entry.scope), `missing action/scope ${entry.caseId}`);
  assert(
    ['block', 'item', 'entity', 'crafting', 'smelting', 'mechanism'].includes(entry.kind),
    `unknown kind ${entry.caseId}`,
  );
  assert(entry.review?.ownerReview && entry.review?.confidence, `missing review ${entry.caseId}`);
  assert(entry.fixture?.status && entry.executionStatus === 'NOT_RUN', `premature execution ${entry.caseId}`);
  assert(
    [
      'PARTIAL_REFERENCE_GAP',
      'SOURCE_CANDIDATE_REVIEW',
      'REFERENCE_GAP',
      'PROJECT_CONTRACT_GAP',
      'PROJECT_CONTRACT_CANDIDATE_REVIEW',
      'REFERENCE_READY',
    ].includes(entry.referenceStatus),
    `invalid reference status ${entry.caseId}`,
  );
  if (['REFERENCE_GAP', 'PROJECT_CONTRACT_GAP'].includes(entry.referenceStatus)) {
    assert(entry.expected === null && entry.evidence.length === 0, `unsourced expected ${entry.caseId}`);
  } else {
    const exclusionReady = entry.scope === '排' && entry.referenceStatus === 'REFERENCE_READY';
    assert(
      (exclusionReady || entry.expected !== null) && entry.evidence.length > 0,
      `missing expected/evidence ${entry.caseId}`,
    );
  }
  for (const evidence of entry.evidence) {
    const external = evidence.uri?.startsWith('https://');
    const localProject =
      entry.referenceStatus === 'PROJECT_CONTRACT_CANDIDATE_REVIEW' &&
      typeof evidence.uri === 'string' &&
      !evidence.uri.includes('://') &&
      existsSync(join(root, evidence.uri));
    assert((external || localProject) && evidence.supports, `unlocatable evidence ${entry.caseId}`);
  }
  if (entry.expected === null && !(entry.scope === '排' && entry.referenceStatus === 'REFERENCE_READY'))
    blockers.noExpected++;
  const readyErrors = validateReadyCase(entry, profile);
  assert(readyErrors.length === 0, `incomplete promoted case ${readyErrors.slice(0, 6).join(', ')}`);
  if (entry.review.ownerReview !== 'APPROVED') blockers.unreviewed++;
  if (entry.fixture.status !== 'DESIGN_FIXED' || !entry.fixture.negativeControl) blockers.fixtureNotFixed++;
  if (entry.unresolved) blockers.unresolved++;
  if (entry.referenceStatus !== 'REFERENCE_READY') blockers.contractNotReady++;
  inc(kinds, entry.kind);
  inc(statuses, entry.referenceStatus);
  inc(scopes, entry.scope);
}
for (const id of identities) assert(ids.has(id), `missing fixed catalog ID ${id}`);
const exclusionById = new Map(exclusionCandidates.cases.map((entry) => [entry.caseId, entry]));
assert(exclusionById.size === exclusionCandidates.cases.length, 'duplicate exclusion candidate');
for (const entry of catalog.cases.filter((candidate) => candidate.scope === '排')) {
  const exclusion = exclusionById.get(entry.caseId);
  assert(
    exclusion?.candidateStatus === 'EXCLUSION_DEPENDENCY_CANDIDATE_NOT_APPROVED' &&
      exclusion.ordinarySurvivalNegative?.expectedUnreachable &&
      exclusion.closure?.retainedBoundaryCaseIds?.length,
    `missing exclusion dependency candidate ${entry.caseId}`,
  );
  if (entry.referenceStatus === 'REFERENCE_READY') {
    for (const id of entry.exclusion.dependencyClosure ?? [])
      assert(
        catalog.cases.some((candidate) => candidate.caseId === id && candidate.scope === '排'),
        `invalid approved exclusion edge ${entry.caseId}->${id}`,
      );
    for (const id of entry.exclusion.retainedPositiveControl.caseIds ?? [])
      assert(
        catalog.cases.some((candidate) => candidate.caseId === id && candidate.scope === '做'),
        `invalid retained positive edge ${entry.caseId}->${id}`,
      );
  }
}
for (const [kind, count] of Object.entries(catalog.counts)) {
  assert(kinds[kind] === count, `category denominator mismatch: ${kind}`);
}
assert(Object.keys(kinds).length === Object.keys(catalog.counts).length, 'unregistered category');
assert(ids.size === catalog.cases.length, 'catalog count mismatch');
const variantKinds = {};
for (const entry of variants.cases) {
  assert(entry.caseId && !ids.has(entry.caseId), `duplicate or missing variant ID ${entry.caseId}`);
  ids.add(entry.caseId);
  const parent = catalog.cases.find((candidate) => candidate.caseId === entry.parentCaseId);
  assert(parent && parent.kind === entry.kind && parent.scope === '做', `invalid variant parent ${entry.caseId}`);
  assert(entry.expected?.variantState && entry.evidence?.length, `missing variant state/source ${entry.caseId}`);
  assert(
    entry.review?.ownerReview && entry.fixture?.status && entry.executionStatus === 'NOT_RUN',
    `invalid variant review/fixture ${entry.caseId}`,
  );
  const readyErrors = validateReadyCase(entry, profile);
  assert(readyErrors.length === 0, `incomplete promoted variant ${readyErrors.slice(0, 6).join(', ')}`);
  if (entry.review.ownerReview !== 'APPROVED') blockers.unreviewed++;
  if (entry.fixture.status !== 'DESIGN_FIXED' || !entry.fixture.negativeControl) blockers.fixtureNotFixed++;
  if (entry.unresolved) blockers.unresolved++;
  if (entry.referenceStatus !== 'REFERENCE_READY') blockers.contractNotReady++;
  inc(variantKinds, entry.kind);
  inc(variantStatuses, entry.referenceStatus);
}
for (const [kind, count] of Object.entries(variants.counts)) {
  assert(variantKinds[kind] === count, `variant category denominator mismatch: ${kind}`);
}
assert(Object.keys(variantKinds).length === Object.keys(variants.counts).length, 'unregistered variant category');
const variantById = new Map(variants.cases.map((entry) => [entry.caseId, entry]));
for (const id of [6, 18]) {
  for (const metadata of [3, 11]) {
    const caseId = `B-${String(id).padStart(3, '0')}~m${String(metadata).padStart(2, '0')}`;
    assert(variantById.get(caseId)?.expected.variantState.metadata === metadata, `missing raw bit state ${caseId}`);
  }
}
for (const id of [8, 9, 10, 11]) {
  for (let metadata = 0; metadata <= 15; metadata++) {
    const caseId = `B-${String(id).padStart(3, '0')}~m${String(metadata).padStart(2, '0')}`;
    const state = variantById.get(caseId)?.expected.variantState;
    assert(state?.metadata === metadata && state.fallingFlag === metadata >= 8, `incomplete fluid raw state ${caseId}`);
  }
}
const lastDurabilityCases = variants.cases.filter((entry) => entry.caseId.endsWith('~damage-last'));
assert(lastDurabilityCases.length === 44, 'durability family denominator drift');
for (const entry of lastDurabilityCases) {
  const state = entry.expected.variantState;
  assert(
    state.rawDamage === state.maxDamage &&
      state.nextOneDamageBreaksStack === true &&
      entry.evidence.some((source) => source.uri.endsWith('/ItemStack.java')),
    `invalid durability break boundary ${entry.caseId}`,
  );
}
for (const [material, eventKey] of [
  ['rock', 'note.bd'],
  ['sand', 'note.snare'],
  ['glass', 'note.hat'],
  ['wood', 'note.bassattack'],
]) {
  const entry = variantById.get(`B-025~instrument-${material}`);
  assert(
    entry?.expected.variantState.supportingMaterial === material &&
      entry.expected.variantState.eventKey === eventKey &&
      entry.evidence.some((source) => source.uri.endsWith('/BlockNote.java')),
    `note event candidate drift ${material}`,
  );
}
for (const [name, aboveBlockMaterial] of [
  ['clear', 'air'],
  ['snow-covered', 'snow'],
]) {
  const state = variantById.get(`B-002~${name}`)?.expected.variantState;
  assert(
    state?.grassMetadata === 0 && state.aboveBlockMaterial === aboveBlockMaterial,
    `grass cover is not a stored grass variant ${name}`,
  );
}
for (let facing = 0; facing <= 3; facing++) {
  for (const occupied of [false, true]) {
    const state = variantById.get(`B-026~f${facing}-occupied-${Number(occupied)}`)?.expected.variantState;
    assert(
      state?.placedFirstCellMetadata === facing &&
        state.placedOffsetCellMetadata === (facing | 8) &&
        state.observedOffsetCellMetadata === (facing | 8 | (occupied ? 4 : 0)) &&
        state.occupiedSetBySuccessfulSleep === occupied,
      `bed paired metadata drift ${facing}/${occupied}`,
    );
  }
}
for (let lower = 0; lower <= 7; lower++) {
  const state = variantById.get(`B-064~upper-m${String(lower + 8).padStart(2, '0')}`)?.expected.variantState;
  assert(
    state?.upperMetadata === lower + 8 && state.pairedLowerMetadata === lower,
    `door upper metadata drift ${lower}`,
  );
}
const brickRecipe = catalog.cases.find((entry) => entry.caseId === 'R-D09')?.expected;
assert(brickRecipe?.output.id === 45 && brickRecipe.symbols?.['#']?.id === 336, 'Block.brick / Item.brick collision');
for (const age of [0, 5999, 6000])
  assert(variantById.has(`E-Item~age-${age}`), `item entity age boundary missing ${age}`);
for (const age of [0, 1199, 1200])
  assert(variantById.has(`E-Arrow~embedded-age-${age}`), `arrow embedded age boundary missing ${age}`);
const spiderRider = variantById.get('E-Spider~skeleton-rider');
assert(
  spiderRider?.evidence.some((source) => source.uri.endsWith('/SpawnerAnimals.java')),
  'spider rider source drift',
);
for (const [name, type] of [
  ['Minecart', 0],
  ['MinecartChest', 1],
  ['MinecartFurnace', 2],
]) {
  const entry = variants.cases.find(
    (candidate) => candidate.parentCaseId === `E-${name}` && candidate.expected.variantState.minecartType === type,
  );
  assert(entry, `minecart type candidate drift ${name}`);
}
const sameIds = (actual, expected, label) => {
  assert(actual.length === expected.length, `${label} denominator mismatch`);
  assert(new Set(actual).size === actual.length, `${label} duplicate ID`);
  assert(
    actual.every((id) => expected.includes(id)),
    `${label} ID mismatch`,
  );
};
sameIds(
  blockCandidates.records.map((entry) => entry.caseId),
  catalog.cases.filter((entry) => entry.kind === 'block').map((entry) => entry.caseId),
  'block candidate',
);
sameIds(
  recipeFixtures.fixtures.map((entry) => entry.caseId),
  catalog.cases.filter((entry) => ['crafting', 'smelting'].includes(entry.kind)).map((entry) => entry.caseId),
  'recipe fixture',
);
sameIds(
  worldCandidates.cases.map((entry) => entry.caseId),
  catalog.cases
    .filter((entry) => entry.kind === 'mechanism' && /^M(?:0[2-9]|1[0-3])-/.test(entry.caseId))
    .map((entry) => entry.caseId),
  'world mechanism candidate',
);
sameIds(
  playCandidates.cases.map((entry) => entry.caseId),
  catalog.cases
    .filter((entry) => entry.kind === 'mechanism' && /^M(?:1[4-9]|2[0-9]|3[0-6])-/.test(entry.caseId))
    .map((entry) => entry.caseId),
  'play mechanism candidate',
);
const playSourceReviewCount = await verifyMechanismSourceReview(root, catalog, playCandidates);
const worldSyncCount = await verifyWorldMechanismSync(root, catalog, worldCandidates);
sameIds(
  entityCandidates.records.map((entry) => entry.caseId),
  catalog.cases.filter((entry) => entry.kind === 'entity').map((entry) => entry.caseId),
  'entity candidate',
);
sameIds(
  itemCandidates.entries.map((entry) => entry.caseId),
  catalog.cases.filter((entry) => entry.kind === 'item').map((entry) => entry.caseId),
  'item candidate',
);
const m01 = catalog.cases.filter((entry) => /^M01-/.test(entry.caseId));
assert(m01.length === 4 && m01.every((entry) => entry.expected !== null), 'M01 direct contract incomplete');
assert(
  blockCandidates.records.length +
    itemCandidates.entries.length +
    entityCandidates.records.length +
    recipeFixtures.fixtures.length +
    worldCandidates.cases.length +
    playCandidates.cases.length +
    m01.length ===
    catalog.cases.length,
  'parent candidate coverage mismatch',
);
const parentById = new Map(catalog.cases.map((entry) => [entry.caseId, entry]));
verifyBlockBehaviorCandidates(blockCandidates, parentById);
for (const entry of recipeFixtures.fixtures) {
  assert(
    entry.candidateStatus === 'SOURCE_CANDIDATE_NOT_DESIGN_FIXED',
    `recipe fixture promoted prematurely ${entry.caseId}`,
  );
  assert(entry.positive && entry.negative && entry.sourceLinks?.length, `recipe fixture incomplete ${entry.caseId}`);
  assert(
    entry.sourceBindingReview === 'PENDING' && entry.candidateSourceBindings?.length && entry.unmappedExpectedPaths,
    `recipe source mapping promoted or incomplete ${entry.caseId}`,
  );
}
for (const entry of worldCandidates.cases) {
  assert(
    entry.candidateExpected && entry.positiveControl && entry.negativeControl && entry.unconfirmed?.length,
    `world candidate incomplete ${entry.caseId}`,
  );
}
for (const entry of playCandidates.cases) {
  assert(
    entry.candidateExpected && entry.positiveControl && entry.negativeControl && entry.gap,
    `play candidate incomplete ${entry.caseId}`,
  );
}
const entityMethodCoverage = verifyEntityBehaviorCandidates(entityCandidates, parentById);
for (const entry of itemCandidates.entries) {
  assert(entry.item.scope === parentById.get(entry.caseId).scope, `item candidate scope drift ${entry.caseId}`);
  assert(
    entry.candidateStatus === 'SOURCE_CANDIDATE_NOT_APPROVED',
    `item candidate promoted prematurely ${entry.caseId}`,
  );
  assert(
    entry.sourceLinks?.length &&
      entry.behaviorFixture?.positive &&
      entry.behaviorFixture?.negative &&
      entry.gaps?.length,
    `item candidate incomplete ${entry.caseId}`,
  );
}
const familyIds = new Set();
for (const family of variants.openEndedFamilies) {
  assert(family.familyId && !familyIds.has(family.familyId), `duplicate or missing family ${family.familyId}`);
  familyIds.add(family.familyId);
  assert(
    family.coverageRule && family.affectedCaseIds?.every((id) => ids.has(id)),
    `invalid family scope ${family.familyId}`,
  );
  const familyErrors = validateOpenEndedFamily(family);
  assert(familyErrors.length === 0, `incomplete promoted family ${familyErrors.slice(0, 6).join(', ')}`);
  if (
    family.status !== 'COVERAGE_FIXED' ||
    family.sourceReview !== 'APPROVED' ||
    family.ownerReview !== 'APPROVED' ||
    !family.partitionFixture
  )
    blockers.openEndedNotFixed++;
}

// Structural validation passes even on a truthful NO-GO. The strict mode is
// for a future whole-contract kickoff review, never a claim that the game ran.
const kickoffReady = Object.values(blockers).every((count) => count === 0);
const result = {
  profileId: profile.profileId,
  decisionLayer: 'PREIMPLEMENTATION_CONTRACT_DESIGN',
  productExecutionStatus: 'NOT_RUN',
  cases: catalog.cases.length,
  variants: variants.cases.length,
  registeredTotal: ids.size,
  openEndedFamilies: variants.openEndedFamilies.length,
  supplementalCandidateCoverage: {
    blocks: blockCandidates.records.length,
    recipes: recipeFixtures.fixtures.length,
    worldMechanisms: worldCandidates.cases.length,
    worldMechanismParentSync: worldSyncCount,
    playMechanisms: playCandidates.cases.length,
    playMechanismSourceReview: playSourceReviewCount,
    entities: entityCandidates.records.length,
    entityLocatedSlots: entityMethodCoverage.directLocatedSlots,
    entityInheritedOnlySlots: entityMethodCoverage.inheritedOnlySlots,
    pinnedSourceUrls: sourcePinCoverage.uniqueUrls,
    items: itemCandidates.entries.length,
    exclusions: exclusionCandidates.cases.length,
    m01Direct: m01.length,
  },
  kinds,
  variantKinds,
  scopes,
  statuses,
  variantStatuses,
  blockers,
  pendingWholeContractGates,
  kickoffDecision: kickoffReady ? 'REFERENCE_READY' : 'NO_GO',
  executableCases: 0,
};
console.log(JSON.stringify(result));
if (process.argv.includes('--require-ready') && !kickoffReady) process.exitCode = 1;
