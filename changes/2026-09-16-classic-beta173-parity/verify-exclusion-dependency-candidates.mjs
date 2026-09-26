import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const [catalog, attachment] = await Promise.all(
  ['reference-cases.json', 'exclusion-dependency-candidates.json'].map(async (name) =>
    JSON.parse(await readFile(join(root, name), 'utf8')),
  ),
);
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const byId = new Map(catalog.cases.map((entry) => [entry.caseId, entry]));
const excluded = catalog.cases.filter((entry) => entry.scope === '排');
const expectedIds = new Set(excluded.map((entry) => entry.caseId));
const actualIds = new Set(attachment.cases.map((entry) => entry.caseId));
assert(attachment.schemaVersion === 1, 'schema version drift');
assert(attachment.referenceCaseSetVersion === catalog.referenceCaseSetVersion, 'case version drift');
assert(attachment.sourceCaseCount === catalog.cases.length, 'parent denominator drift');
assert(attachment.caseCount === 38 && attachment.cases.length === 38, 'exclusion denominator drift');
assert(
  actualIds.size === expectedIds.size && [...expectedIds].every((id) => actualIds.has(id)),
  'excluded ID set drift',
);
assert(attachment.status === 'CANDIDATE_ONLY_NOT_APPROVED', 'candidate attachment cannot claim approval');
const byCause = {};
for (const candidate of attachment.cases) {
  const source = byId.get(candidate.caseId);
  assert(source?.scope === '排' && source.kind === candidate.kind, `scope drift ${candidate.caseId}`);
  assert(
    candidate.candidateStatus === 'EXCLUSION_DEPENDENCY_CANDIDATE_NOT_APPROVED',
    `premature promotion ${candidate.caseId}`,
  );
  assert(['REDSTONE_CIRCUITS', 'OTHER_DIMENSIONS'].includes(candidate.decisionCause), `cause ${candidate.caseId}`);
  assert(
    candidate.reason && candidate.unresolved && candidate.positiveControl,
    `missing candidate boundary ${candidate.caseId}`,
  );
  assert(
    candidate.ordinarySurvivalNegative?.setup &&
      candidate.ordinarySurvivalNegative?.trigger &&
      candidate.ordinarySurvivalNegative?.expectedUnreachable,
    `missing ordinary-survival negative ${candidate.caseId}`,
  );
  assert(
    candidate.sourceLinks?.some((uri) => uri.startsWith('spec.md#')),
    `missing decision source ${candidate.caseId}`,
  );
  assert(
    candidate.sourceLinks?.some((uri) => uri.startsWith('https://')),
    `missing comparator source ${candidate.caseId}`,
  );
  for (const key of ['producerRecipeIds', 'dependencyCaseIds', 'retainedBoundaryCaseIds'])
    assert(Array.isArray(candidate.closure?.[key]), `missing closure ${candidate.caseId}.${key}`);
  for (const id of [...candidate.closure.producerRecipeIds, ...candidate.closure.dependencyCaseIds])
    assert(byId.get(id)?.scope === '排', `dependency is not excluded ${candidate.caseId}->${id}`);
  for (const id of candidate.closure.retainedBoundaryCaseIds)
    assert(byId.get(id)?.scope === '做', `boundary is not retained ${candidate.caseId}->${id}`);
  if (source.kind === 'crafting') {
    const outputId = source.expected?.output?.id;
    const productCaseId = outputId < 256 ? `B-${String(outputId).padStart(3, '0')}` : `I-${outputId}`;
    assert(candidate.closure.outputCaseId === productCaseId, `output identity ${candidate.caseId}`);
    assert(byId.get(productCaseId)?.scope === '排', `recipe output not excluded ${candidate.caseId}`);
    assert(candidate.pathKind === 'DISABLED_CRAFTING_OUTPUT', `recipe path kind ${candidate.caseId}`);
  }
  byCause[candidate.decisionCause] = (byCause[candidate.decisionCause] ?? 0) + 1;
}
assert(byCause.REDSTONE_CIRCUITS === 31 && byCause.OTHER_DIMENSIONS === 7, 'cause denominator drift');
const index = new Map(attachment.cases.map((entry) => [entry.caseId, entry]));
assert(
  index.get('B-055').closure.retainedBoundaryCaseIds.includes('I-331'),
  'redstone material must survive wire exclusion',
);
assert(
  ['B-049', 'B-051', 'I-259'].every((id) => index.get('B-090').closure.retainedBoundaryCaseIds.includes(id)),
  'portal exclusion must preserve obsidian, fire and flint',
);
for (const recipe of attachment.cases.filter((entry) => entry.kind === 'crafting'))
  assert(
    index.get(recipe.closure.outputCaseId).closure.producerRecipeIds.includes(recipe.caseId),
    `producer closure missing ${recipe.caseId}`,
  );
console.log(JSON.stringify({ caseCount: attachment.caseCount, byCause, status: attachment.status }));
