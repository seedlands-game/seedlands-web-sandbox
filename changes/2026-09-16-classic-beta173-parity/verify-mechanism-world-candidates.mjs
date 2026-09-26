import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(await readFile(join(root, 'mechanism-world-candidates.json'), 'utf8'));
const profile = JSON.parse(await readFile(join(root, 'harness-profile.json'), 'utf8'));
const assert = (condition, detail) => {
  if (!condition) throw new Error(detail);
};
const expectedCounts = {
  M02: 3,
  M03: 4,
  M04: 4,
  M05: 3,
  M06: 3,
  M07: 3,
  M08: 4,
  M09: 3,
  M10: 4,
  M11: 5,
  M12: 3,
  M13: 3,
};
assert(catalog.schemaVersion === 1, 'schema version mismatch');
assert(catalog.profileId === profile.profileId, 'profile version mismatch');
assert(catalog.caseCount === 42 && catalog.cases.length === 42, 'M02-M13 denominator mismatch');
const seen = new Set();
const counts = {};
for (const entry of catalog.cases) {
  assert(/^M(?:0[2-9]|1[0-3])-\d\d$/.test(entry.caseId), `out-of-scope case ${entry.caseId}`);
  assert(!seen.has(entry.caseId), `duplicate ${entry.caseId}`);
  seen.add(entry.caseId);
  const group = entry.caseId.slice(0, 3);
  counts[group] = (counts[group] ?? 0) + 1;
  assert(entry.sourceLevel === 'RECONSTRUCTED_SOURCE_CANDIDATE', `source level ${entry.caseId}`);
  assert(entry.fixture?.initialState && entry.fixture?.trigger, `fixture ${entry.caseId}`);
  assert(entry.candidateExpected && entry.sourceLocations?.length, `candidate/source ${entry.caseId}`);
  assert(entry.positiveControl && entry.negativeControl, `controls ${entry.caseId}`);
  assert(
    entry.saveResumeDependency && Array.isArray(entry.unconfirmed) && entry.unconfirmed.length,
    `gap boundary ${entry.caseId}`,
  );
}
assert(JSON.stringify(counts) === JSON.stringify(expectedCounts), `group denominator ${JSON.stringify(counts)}`);
console.log(JSON.stringify({ cases: seen.size, counts, status: 'CANDIDATE_ONLY_NOT_EXECUTED' }));
