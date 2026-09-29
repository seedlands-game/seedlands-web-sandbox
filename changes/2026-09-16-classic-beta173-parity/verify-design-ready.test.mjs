import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  fixtureDigestFor,
  validateOpenEndedFamily,
  validateReadyCase,
  validateWholeContractGates,
  verifyWholeContractArtifacts,
  wholeContractGateNames,
} from './verify-design-ready.mjs';

const profile = { profileId: 'contract-test', referenceCaseSetVersion: 1 };
const na = (reason) => ({ status: 'NOT_APPLICABLE', reason });

function readyCase() {
  const fixture = {
    status: 'DESIGN_FIXED',
    seed: 'seed-1',
    generatorVersion: 'generator-1',
    difficulty: 'normal',
    worldTimeTick: 0,
    weather: 'clear',
    loadedChunks: [],
    initialBlocks: [],
    initialEntities: [],
    initialInventory: [],
    initialOwnerStateDeclaration: { inventory: [] },
    rngAlgorithmAndState: { algorithm: 'fixed', state: 1 },
    inputEventsWithTicks: [{ tick: 0, action: 'open' }],
    observationTickWindow: { first: 0, last: 1 },
    negativeControl: {
      setupOrMutation: { target: 'blocked' },
      trigger: { tick: 0, action: 'open' },
      expectedRejection: { ownerStateUnchanged: true },
    },
  };
  fixture.fixtureDigest = fixtureDigestFor(fixture);
  return {
    caseId: 'B-001',
    kind: 'block',
    scope: '做',
    profileId: profile.profileId,
    referenceCaseSetVersion: profile.referenceCaseSetVersion,
    referenceStatus: 'REFERENCE_READY',
    expected: { id: 1, behavior: { breakDrops: 4 } },
    evidence: [{ uri: 'https://example.com/fixed#L1', supports: 'break drop' }],
    source: [
      {
        uri: 'https://example.com/fixed#L1',
        methodOrSection: 'BlockStone.idDropped#L10',
        supports: 'break drop',
        evidenceLevel: 'RECONSTRUCTED_SOURCE_PROXY',
        supportedExpectedPaths: ['/id', '/behavior/breakDrops'],
      },
    ],
    sourceConflictResolution: { status: 'NO_CONFLICT', rationale: 'one fixed branch supports this assertion' },
    unresolved: null,
    review: {
      ownerReview: 'APPROVED',
      confidence: 'SOURCE_PROXY_ACCEPTED',
      reviewerId: 'reviewer-1',
      reviewedAt: '2026-09-17T14:00:00Z',
    },
    fixture,
    assertions: {
      expectedOwnerStateByTick: [{ tick: 1, state: { blockId: 0 } }],
      expectedEventsInOrder: [],
      expectedRenderOrAudioEvidence: na('block state is checked in a separate perceptual case'),
      saveResumeCheckpoint: na('this case does not persist'),
      probabilityPlanOrNotApplicable: na('deterministic branch'),
    },
  };
}

test('complete declared case passes only the structural gate', () => {
  assert.deepEqual(validateReadyCase(readyCase(), profile), []);
});

test('empty candidate is not accidentally promoted', () => {
  const entry = readyCase();
  entry.referenceStatus = 'PARTIAL_REFERENCE_GAP';
  entry.review.ownerReview = 'PENDING';
  entry.fixture.status = 'NOT_FIXED';
  assert.deepEqual(validateReadyCase(entry, profile), []);
});

test('a status-only promotion cannot bypass source, fixture or assertion requirements', () => {
  const entry = readyCase();
  entry.source[0].methodOrSection = '';
  entry.fixture.loadedChunks = null;
  entry.fixture.fixtureDigest = fixtureDigestFor(entry.fixture);
  entry.assertions.expectedOwnerStateByTick = null;
  const errors = validateReadyCase(entry, profile);
  assert(errors.includes('B-001.source[0].methodOrSection'));
  assert(errors.includes('B-001.fixture.loadedChunks'));
  assert(errors.includes('B-001.assertions.expectedOwnerStateByTick'));
  assert(errors.includes('B-001.assertions.observableExpected'));
});

test('fixture digest must cover the current declaration', () => {
  const entry = readyCase();
  entry.fixture.worldTimeTick = 1;
  assert(validateReadyCase(entry, profile).includes('B-001.fixture.fixtureDigest'));
});

test('every expected leaf must map to a source already in the evidence set', () => {
  const entry = readyCase();
  entry.source[0].supportedExpectedPaths = ['/id'];
  assert(validateReadyCase(entry, profile).includes('B-001.expected.unsourced:/behavior/breakDrops'));
  entry.source[0].supportedExpectedPaths = ['/id', '/behavior/breakDrops', '/not-an-expected-field'];
  assert(validateReadyCase(entry, profile).includes('B-001.source[0].unknownExpectedPath'));
  entry.source[0].supportedExpectedPaths = ['/id', '/behavior/breakDrops'];
  entry.source[0].uri = 'https://example.com/other#L1';
  assert(validateReadyCase(entry, profile).includes('B-001.source[0].evidenceLink'));
});

test('exclusion requires a dependency closure and survival-unreachable control', () => {
  const entry = readyCase();
  entry.scope = '排';
  assert(validateReadyCase(entry, profile).includes('B-001.exclusion.ordinarySurvivalNegative'));
  entry.source = [];
  entry.sourceConflictResolution = null;
  entry.expected = null;
  entry.exclusion = {
    expectedScopeEffect: { enabledInClassic: false, ordinarySurvivalReachable: false },
    reason: 'requires an excluded redstone circuit',
    sourceLinks: ['spec.md#excluded-scope', 'https://example.com/fixed#L1'],
    dependencyClosure: ['R-D54'],
    ordinarySurvivalNegative: {
      setup: 'new survival world',
      trigger: 'attempt ordinary acquisition',
      expectedUnreachable: 'cannot obtain the excluded device',
    },
    retainedPositiveControl: {
      caseIds: ['B-054'],
      setup: 'ordinary chest fixture',
      trigger: 'open chest',
      expectedSurvival: 'chest still works',
    },
  };
  assert.deepEqual(validateReadyCase(entry, profile), []);
});

test('open-ended family cannot pass with an empty partition fixture', () => {
  const family = {
    familyId: 'V-O01',
    status: 'COVERAGE_FIXED',
    sourceReview: 'APPROVED',
    ownerReview: 'APPROVED',
    reviewerId: 'reviewer-1',
    reviewedAt: '2026-09-17T14:00:00Z',
    partitionFixture: {},
  };
  assert(validateOpenEndedFamily(family).includes('V-O01.partitionFixture.partitions'));
  family.partitionFixture = {
    dimensions: ['length'],
    partitions: [{ id: 'empty', equivalenceRule: 'no characters', source: 'fixed source section' }],
    boundaryCases: ['zero', 'maximum'],
    negativeCases: ['overflow'],
    coverageJustification: 'zero/max/overflow cover this bounded field',
  };
  family.partitionFixture.fixtureDigest = fixtureDigestFor(family.partitionFixture);
  assert.deepEqual(validateOpenEndedFamily(family), []);
});

test('whole-contract approval requires review evidence for every approved gate', () => {
  const gates = Object.fromEntries(wholeContractGateNames.map((name) => [name, 'PENDING']));
  gates.harnessDesign = 'APPROVED';
  assert(validateWholeContractGates({ wholeContractReview: gates }).includes('harnessDesign.artifactSha256'));
  assert.deepEqual(
    validateWholeContractGates({
      wholeContractReview: gates,
      wholeContractReviewEvidence: {
        harnessDesign: {
          reviewerId: 'reviewer-1',
          reviewedAt: '2026-09-17T14:00:00Z',
          artifact: 'review-notes.md',
          artifactSha256: 'a'.repeat(64),
        },
      },
    }),
    [],
  );
});

test('approved whole-contract artifact must be present and match its recorded digest', async () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const artifact = 'case-design.md';
  const artifactSha256 = createHash('sha256')
    .update(await readFile(new URL(artifact, import.meta.url)))
    .digest('hex');
  const profileWithGate = {
    wholeContractReview: { harnessDesign: 'APPROVED' },
    wholeContractReviewEvidence: { harnessDesign: { artifact, artifactSha256 } },
  };
  assert.deepEqual(await verifyWholeContractArtifacts(profileWithGate, root), []);
  profileWithGate.wholeContractReviewEvidence.harnessDesign.artifactSha256 = 'a'.repeat(64);
  assert((await verifyWholeContractArtifacts(profileWithGate, root)).includes('harnessDesign.artifactDigestMismatch'));
  profileWithGate.wholeContractReviewEvidence.harnessDesign.artifact = '../outside.md';
  assert((await verifyWholeContractArtifacts(profileWithGate, root)).includes('harnessDesign.artifactOutsideContract'));
});
