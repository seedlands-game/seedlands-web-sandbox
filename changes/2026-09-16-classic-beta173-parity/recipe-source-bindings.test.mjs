import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { recipeSourceBindings } from './recipe-source-bindings.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(await readFile(join(root, 'reference-cases.json'), 'utf8'));
const byId = new Map(catalog.cases.map((entry) => [entry.caseId, entry]));

test('crafting workstations use composite matrix candidates; remainders remain explicit gaps', () => {
  const paper = recipeSourceBindings(byId.get('R-D01'));
  const cake = recipeSourceBindings(byId.get('R-D22'));
  assert(paper.candidateSourceBindings.some((binding) => binding.supportedExpectedPaths.includes('/workstations/0')));
  assert(!paper.unmappedExpectedPaths.some((path) => path.startsWith('/workstations/')));
  assert(paper.unmappedExpectedPaths.includes('/remainders'));
  assert(cake.unmappedExpectedPaths.some((path) => path.startsWith('/remainders/')));
  assert.equal(paper.sourceBindingReview, 'PENDING');
});

test('both inventory and workbench workstation claims are separately sourced', () => {
  const recipe = recipeSourceBindings(byId.get('R-D07'));
  const workstationBindings = recipe.candidateSourceBindings.filter((binding) =>
    binding.supportedExpectedPaths.some((path) => path.startsWith('/workstations/')),
  );
  assert.deepEqual(
    workstationBindings.map((binding) => binding.supportedExpectedPaths[0]),
    ['/workstations/0', '/workstations/1'],
  );
  assert(workstationBindings[0].uri.includes('/ContainerPlayer.java#'));
  assert(workstationBindings[1].uri.includes('/ContainerWorkbench.java#'));
  assert(workstationBindings.every((binding) => binding.evidenceLevel.includes('COMPOSITE')));
});

test('smelting registration and cook path are mapped only as candidates', () => {
  const result = recipeSourceBindings(byId.get('R-S01'));
  assert.deepEqual(result.unmappedExpectedPaths, []);
  assert(result.candidateSourceBindings.some((binding) => binding.supportedExpectedPaths.includes('/cookTicks')));
  assert(result.candidateSourceBindings.every((binding) => binding.evidenceLevel.includes('NOT_REVIEWED')));
});

test('missing recipe evidence cannot silently produce a source map', () => {
  const broken = structuredClone(byId.get('R-S01'));
  broken.evidence = [];
  assert.throws(() => recipeSourceBindings(broken), /Missing recipe source/);
});
