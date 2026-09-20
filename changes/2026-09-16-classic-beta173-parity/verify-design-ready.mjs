import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

// Structural guard for a future pre-implementation contract approval. It does
// not authenticate a reviewer, verify a remote source, or execute gameplay.
export const wholeContractGateNames = [
  'scopeAndDeviations',
  'referenceOracle',
  'caseExpectedAndFixtures',
  'harnessDesign',
  'independentArtAndAudioComparator',
  'performanceEnvironmentAndThresholds',
];

const notApplicable = (value) =>
  value &&
  typeof value === 'object' &&
  value.status === 'NOT_APPLICABLE' &&
  typeof value.reason === 'string' &&
  value.reason.trim().length > 0;

const declared = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0 && !/^(?:TODO|TBD|FIXME|PENDING)$/i.test(value.trim());
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return true; // [] is a valid explicitly empty world/inventory/input list.
  return typeof value === 'object' && Object.keys(value).length > 0;
};

const resolved = (value) =>
  declared(value) && (typeof value !== 'object' || value.status !== 'NOT_APPLICABLE' || notApplicable(value));
const nonEmpty = (value) =>
  (Array.isArray(value) && value.length > 0) || (value && typeof value === 'object' && Object.keys(value).length > 0);
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const date = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  !Number.isNaN(Date.parse(value));

const normalized = (value) => {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b, 'en'))
        .map(([key, part]) => [key, normalized(part)]),
    );
  return value;
};

export const expectedLeafPaths = (value, prefix = '') => {
  if (Array.isArray(value)) {
    if (value.length === 0) return [prefix];
    return value.flatMap((part, index) => expectedLeafPaths(part, `${prefix}/${index}`));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return [prefix];
    return entries.flatMap(([key, part]) =>
      expectedLeafPaths(part, `${prefix}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`),
    );
  }
  return [prefix];
};

const sourceDocument = (uri) => (typeof uri === 'string' ? uri.split('#', 1)[0] : null);

export function fixtureDigestFor(fixture) {
  const declaration = { ...fixture };
  delete declaration.fixtureDigest;
  return createHash('sha256')
    .update(JSON.stringify(normalized(declaration)))
    .digest('hex');
}

export function validateReadyCase(entry, profile) {
  const promoted =
    entry.referenceStatus === 'REFERENCE_READY' ||
    entry.review?.ownerReview === 'APPROVED' ||
    entry.fixture?.status === 'DESIGN_FIXED';
  if (!promoted) return [];

  const errors = [];
  const need = (condition, field) => {
    if (!condition) errors.push(`${entry.caseId}.${field}`);
  };
  need(entry.referenceStatus === 'REFERENCE_READY', 'referenceStatus');
  need(entry.review?.ownerReview === 'APPROVED', 'review.ownerReview');
  need(entry.review?.confidence && entry.review.confidence !== 'UNREVIEWED', 'review.confidence');
  need(declared(entry.review?.reviewerId), 'review.reviewerId');
  need(date(entry.review?.reviewedAt), 'review.reviewedAt');
  need(entry.fixture?.status === 'DESIGN_FIXED', 'fixture.status');
  need(!declared(entry.unresolved), 'unresolved');
  need(entry.profileId === profile.profileId, 'profileId');
  need(entry.referenceCaseSetVersion === profile.referenceCaseSetVersion, 'referenceCaseSetVersion');
  if (entry.scope !== '排') {
    need(nonEmpty(entry.expected), 'expected');
    need(Array.isArray(entry.source) && entry.source.length > 0, 'source');
    const supportedPaths = new Set();
    const evidenceDocuments = new Set((entry.evidence ?? []).map((evidence) => sourceDocument(evidence.uri)));
    const expectedPaths = new Set(expectedLeafPaths(entry.expected));
    for (const [index, source] of (entry.source ?? []).entries()) {
      need(declared(source.uri), `source[${index}].uri`);
      need(evidenceDocuments.has(sourceDocument(source.uri)), `source[${index}].evidenceLink`);
      need(declared(source.methodOrSection), `source[${index}].methodOrSection`);
      need(declared(source.supports), `source[${index}].supports`);
      need(declared(source.evidenceLevel), `source[${index}].evidenceLevel`);
      need(
        Array.isArray(source.supportedExpectedPaths) && source.supportedExpectedPaths.length > 0,
        `source[${index}].supportedExpectedPaths`,
      );
      for (const path of source.supportedExpectedPaths ?? []) {
        need(expectedPaths.has(path), `source[${index}].unknownExpectedPath`);
        supportedPaths.add(path);
      }
    }
    for (const path of expectedPaths) need(supportedPaths.has(path), `expected.unsourced:${path}`);
    const resolution = entry.sourceConflictResolution;
    need(
      resolution &&
        ['NO_CONFLICT', 'RESOLVED', 'PROJECT_CONTRACT'].includes(resolution.status) &&
        declared(resolution.rationale),
      'sourceConflictResolution',
    );
  }

  const fixture = entry.fixture ?? {};
  for (const field of [
    'seed',
    'generatorVersion',
    'difficulty',
    'worldTimeTick',
    'weather',
    'loadedChunks',
    'initialBlocks',
    'initialEntities',
    'initialInventory',
    'initialOwnerStateDeclaration',
    'rngAlgorithmAndState',
    'inputEventsWithTicks',
    'observationTickWindow',
  ]) {
    need(resolved(fixture[field]), `fixture.${field}`);
  }
  need(digest(fixture.fixtureDigest) && fixture.fixtureDigest === fixtureDigestFor(fixture), 'fixture.fixtureDigest');
  const control = fixture.negativeControl;
  need(
    control && declared(control.setupOrMutation) && declared(control.trigger) && declared(control.expectedRejection),
    'fixture.negativeControl',
  );

  const assertions = entry.assertions ?? {};
  for (const field of [
    'expectedOwnerStateByTick',
    'expectedEventsInOrder',
    'expectedRenderOrAudioEvidence',
    'saveResumeCheckpoint',
    'probabilityPlanOrNotApplicable',
  ]) {
    need(resolved(assertions[field]), `assertions.${field}`);
  }
  need(
    ['expectedOwnerStateByTick', 'expectedEventsInOrder', 'expectedRenderOrAudioEvidence'].some(
      (field) => resolved(assertions[field]) && !notApplicable(assertions[field]) && nonEmpty(assertions[field]),
    ),
    'assertions.observableExpected',
  );

  if (entry.scope === '排') {
    const exclusion = entry.exclusion;
    need(
      exclusion?.expectedScopeEffect?.enabledInClassic === false &&
        exclusion.expectedScopeEffect.ordinarySurvivalReachable === false,
      'exclusion.expectedScopeEffect',
    );
    need(declared(exclusion?.reason), 'exclusion.reason');
    need(Array.isArray(exclusion?.sourceLinks) && exclusion.sourceLinks.length > 0, 'exclusion.sourceLinks');
    need(
      exclusion?.sourceLinks?.some((uri) => typeof uri === 'string' && uri.startsWith('spec.md#')),
      'exclusion.scopeDecisionSource',
    );
    need(
      exclusion?.sourceLinks?.some((uri) => typeof uri === 'string' && uri.startsWith('https://')),
      'exclusion.comparatorIdentitySource',
    );
    need(Array.isArray(exclusion?.dependencyClosure), 'exclusion.dependencyClosure');
    need(
      exclusion?.dependencyClosure?.length > 0 || declared(exclusion?.noDependenciesReason),
      'exclusion.dependencyClosureOrReason',
    );
    need(
      declared(exclusion?.ordinarySurvivalNegative?.setup) &&
        declared(exclusion?.ordinarySurvivalNegative?.trigger) &&
        declared(exclusion?.ordinarySurvivalNegative?.expectedUnreachable),
      'exclusion.ordinarySurvivalNegative',
    );
    need(
      declared(exclusion?.retainedPositiveControl?.setup) &&
        declared(exclusion?.retainedPositiveControl?.trigger) &&
        declared(exclusion?.retainedPositiveControl?.expectedSurvival) &&
        Array.isArray(exclusion?.retainedPositiveControl?.caseIds) &&
        exclusion.retainedPositiveControl.caseIds.length > 0,
      'exclusion.retainedPositiveControl',
    );
  }
  return errors;
}

export function validateOpenEndedFamily(family) {
  const promoted =
    family.status === 'COVERAGE_FIXED' || family.sourceReview === 'APPROVED' || family.ownerReview === 'APPROVED';
  if (!promoted) return [];
  const errors = [];
  const need = (condition, field) => {
    if (!condition) errors.push(`${family.familyId}.${field}`);
  };
  need(family.status === 'COVERAGE_FIXED', 'status');
  need(family.sourceReview === 'APPROVED', 'sourceReview');
  need(family.ownerReview === 'APPROVED', 'ownerReview');
  need(declared(family.reviewerId), 'reviewerId');
  need(date(family.reviewedAt), 'reviewedAt');
  const partition = family.partitionFixture;
  need(Array.isArray(partition?.dimensions) && partition.dimensions.length > 0, 'partitionFixture.dimensions');
  need(Array.isArray(partition?.partitions) && partition.partitions.length > 0, 'partitionFixture.partitions');
  for (const [index, part] of (partition?.partitions ?? []).entries()) {
    need(
      declared(part.id) && declared(part.equivalenceRule) && declared(part.source),
      `partitionFixture.partitions[${index}]`,
    );
  }
  need(Array.isArray(partition?.boundaryCases) && partition.boundaryCases.length > 0, 'partitionFixture.boundaryCases');
  need(Array.isArray(partition?.negativeCases) && partition.negativeCases.length > 0, 'partitionFixture.negativeCases');
  need(declared(partition?.coverageJustification), 'partitionFixture.coverageJustification');
  need(
    digest(partition?.fixtureDigest) && partition.fixtureDigest === fixtureDigestFor(partition),
    'partitionFixture.fixtureDigest',
  );
  return errors;
}

export function validateWholeContractGates(profile) {
  const errors = [];
  for (const gate of wholeContractGateNames) {
    const status = profile.wholeContractReview?.[gate];
    if (!['PENDING', 'APPROVED'].includes(status)) errors.push(`${gate}.status`);
    if (status !== 'APPROVED') continue;
    const evidence = profile.wholeContractReviewEvidence?.[gate];
    if (!declared(evidence?.reviewerId)) errors.push(`${gate}.reviewerId`);
    if (!date(evidence?.reviewedAt)) errors.push(`${gate}.reviewedAt`);
    if (!declared(evidence?.artifact)) errors.push(`${gate}.artifact`);
    if (!digest(evidence?.artifactSha256)) errors.push(`${gate}.artifactSha256`);
  }
  return errors;
}

export async function verifyWholeContractArtifacts(profile, root) {
  const errors = [];
  for (const gate of wholeContractGateNames) {
    if (profile.wholeContractReview?.[gate] !== 'APPROVED') continue;
    const evidence = profile.wholeContractReviewEvidence?.[gate];
    if (!evidence?.artifact || !digest(evidence.artifactSha256)) continue;
    const target = resolve(root, evidence.artifact);
    const within = relative(root, target);
    if (isAbsolute(evidence.artifact) || within.startsWith('..') || isAbsolute(within)) {
      errors.push(`${gate}.artifactOutsideContract`);
      continue;
    }
    try {
      const content = await readFile(target);
      const actual = createHash('sha256').update(content).digest('hex');
      if (actual !== evidence.artifactSha256) errors.push(`${gate}.artifactDigestMismatch`);
    } catch {
      errors.push(`${gate}.artifactUnreadable`);
    }
  }
  return errors;
}
