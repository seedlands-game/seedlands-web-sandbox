import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(await readFile(join(root, 'mechanism-play-candidates.json'), 'utf8'));
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const expected = {
  M14: 4,
  M15: 4,
  M16: 3,
  M17: 3,
  M18: 3,
  M19: 3,
  M20: 3,
  M21: 5,
  M22: 4,
  M23: 3,
  M24: 4,
  M25: 3,
  M26: 4,
  M27: 3,
  M28: 6,
  M29: 3,
  M30: 4,
  M31: 3,
  M32: 4,
  M33: 3,
  M34: 4,
  M35: 3,
  M36: 4,
};
const profile = JSON.parse(await readFile(join(root, 'harness-profile.json'), 'utf8'));
assert(catalog.profileId === profile.profileId, 'profile version mismatch');
assert(catalog.caseCount === 83 && catalog.cases.length === 83, 'denominator mismatch');
const counts = {};
for (const entry of catalog.cases) {
  assert(/^M(?:1[4-9]|2[0-9]|3[0-6])-\d\d$/.test(entry.caseId), `out-of-scope ${entry.caseId}`);
  const group = entry.caseId.slice(0, 3);
  counts[group] = (counts[group] ?? 0) + 1;
  assert(
    ['RECONSTRUCTED_SOURCE_CANDIDATE', 'PROJECT_CONTRACT_CANDIDATE'].includes(entry.classification),
    `classification ${entry.caseId}`,
  );
  assert(
    entry.sourceLocations.length &&
      entry.fixture.initialState &&
      entry.fixture.trigger &&
      entry.candidateExpected &&
      entry.positiveControl &&
      entry.negativeControl &&
      entry.saveOrHumanDependency &&
      entry.gap,
    `incomplete ${entry.caseId}`,
  );
}
assert(JSON.stringify(counts) === JSON.stringify(expected), `group counts ${JSON.stringify(counts)}`);
const classes = Object.fromEntries(
  ['RECONSTRUCTED_SOURCE_CANDIDATE', 'PROJECT_CONTRACT_CANDIDATE'].map((k) => [
    k,
    catalog.cases.filter((x) => x.classification === k).length,
  ]),
);
assert(JSON.stringify(classes) === JSON.stringify(catalog.classificationCounts), 'classification counts');
console.log(JSON.stringify({ cases: catalog.cases.length, counts, classes, status: 'CANDIDATE_ONLY_NOT_EXECUTED' }));
