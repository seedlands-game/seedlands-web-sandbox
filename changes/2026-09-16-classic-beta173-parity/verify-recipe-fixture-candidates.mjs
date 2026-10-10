import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectedLeafPaths } from './verify-design-ready.mjs';

// Checks only internal consistency of source-derived candidates. This does
// not execute Minecraft or prove the reconstructed source equals its jar.
const root = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(await readFile(join(root, 'reference-cases.json'), 'utf8'));
const ledger = JSON.parse(await readFile(join(root, 'recipe-fixture-candidates.json'), 'utf8'));
const recipes = catalog.cases.filter((entry) => entry.kind === 'crafting');
const fixtures = ledger.fixtures.filter((entry) => entry.kind === 'crafting');
if (recipes.length !== 150 || fixtures.length !== 150) throw new Error('Crafting denominator drift');
const recipesById = new Map(recipes.map((entry) => [entry.caseId, entry]));
const smeltingRecipes = catalog.cases.filter((entry) => entry.kind === 'smelting');
const smeltingFixtures = ledger.fixtures.filter((entry) => entry.kind === 'smelting');
if (smeltingRecipes.length !== 10 || smeltingFixtures.length !== 10) throw new Error('Smelting denominator drift');
const smeltingById = new Map(smeltingRecipes.map((entry) => [entry.caseId, entry]));
if (ledger.schemaVersion !== 3) throw new Error('Recipe source-binding schema drift');
const allRecipeById = new Map([...recipes, ...smeltingRecipes].map((entry) => [entry.caseId, entry]));
let sourceBindingsChecked = 0;
let mappedExpectedPaths = 0;
let unmappedExpectedPaths = 0;
for (const fixture of ledger.fixtures) {
  const parent = allRecipeById.get(fixture.caseId);
  if (!parent || fixture.sourceBindingReview !== 'PENDING')
    throw new Error(`Invalid recipe source review ${fixture.caseId}`);
  if (parent.kind === 'crafting') {
    const fitsInventory =
      parent.expected.type === 'shapeless'
        ? parent.expected.ingredients.length <= 4
        : (parent.expected.alternatives ?? [parent.expected]).some(
            ({ grid }) => grid.length <= 2 && Math.max(...grid.map((row) => row.length)) <= 2,
          );
    const workstations = fitsInventory
      ? ['inventory-2x2', 'crafting-table-3x3']
      : ['crafting-table-3x3'];
    if (JSON.stringify(parent.expected.workstations) !== JSON.stringify(workstations))
      throw new Error(`Recipe grid/workstation mismatch ${fixture.caseId}`);
  }
  const allPaths = new Set(expectedLeafPaths(parent.expected));
  const evidenceUris = new Set(parent.evidence.map((entry) => entry.uri));
  const mapped = new Set();
  for (const binding of fixture.candidateSourceBindings ?? []) {
    if (!evidenceUris.has(binding.uri) || !binding.supportedExpectedPaths?.length)
      throw new Error(`Recipe binding has no matching evidence ${fixture.caseId}`);
    for (const path of binding.supportedExpectedPaths) {
      if (!allPaths.has(path) || mapped.has(path))
        throw new Error(`Invalid or duplicate recipe path ${fixture.caseId} ${path}`);
      mapped.add(path);
    }
    sourceBindingsChecked++;
  }
  for (const [index, workstation] of (parent.expected.workstations ?? []).entries()) {
    const sourceIndex = workstation === 'inventory-2x2' ? 3 : workstation === 'crafting-table-3x3' ? 4 : -1;
    const path = `/workstations/${index}`;
    const binding = fixture.candidateSourceBindings.find((candidate) =>
      candidate.supportedExpectedPaths.includes(path),
    );
    if (
      sourceIndex < 0 ||
      binding?.uri !== parent.evidence[sourceIndex]?.uri ||
      binding.evidenceLevel !== 'RECONSTRUCTED_COMPOSITE_SOURCE_CANDIDATE_NOT_REVIEWED'
    )
      throw new Error(`Unbound workstation candidate ${fixture.caseId} ${path}`);
  }
  const unmapped = new Set(fixture.unmappedExpectedPaths ?? []);
  if (
    mapped.size + unmapped.size !== allPaths.size ||
    [...allPaths].some((path) => !mapped.has(path) && !unmapped.has(path))
  )
    throw new Error(`Recipe path coverage drift ${fixture.caseId}`);
  if ([...unmapped].some((path) => path.split('/')[1] !== 'remainders'))
    throw new Error(`Unexpected unmapped recipe field ${fixture.caseId}`);
  mappedExpectedPaths += mapped.size;
  unmappedExpectedPaths += unmapped.size;
}
if (
  sourceBindingsChecked !== ledger.counts.sourceBindings ||
  mappedExpectedPaths !== ledger.counts.mappedExpectedPaths ||
  unmappedExpectedPaths !== ledger.counts.unmappedExpectedPaths
)
  throw new Error('Recipe source-binding count drift');

const sameItem = (actual, expected) =>
  actual !== null &&
  actual.id === expected.id &&
  (expected.metadata === -1 || actual.metadata === (expected.metadata ?? 0));

function shapedMatches(recipe, cells) {
  for (const alternative of recipe.expected.alternatives ?? [recipe.expected]) {
    const { grid, symbols } = alternative;
    const width = Math.max(...grid.map((row) => row.length));
    const height = grid.length;
    for (let rowOffset = 0; rowOffset <= 3 - height; rowOffset += 1) {
      for (let columnOffset = 0; columnOffset <= 3 - width; columnOffset += 1) {
        for (const mirrored of [false, true]) {
          let match = true;
          for (let row = 0; row < 3 && match; row += 1) {
            for (let column = 0; column < 3; column += 1) {
              const localRow = row - rowOffset;
              const localColumn = column - columnOffset;
              const patternColumn = mirrored ? width - 1 - localColumn : localColumn;
              const symbol =
                localRow >= 0 && localRow < height && localColumn >= 0 && localColumn < width
                  ? (grid[localRow][patternColumn] ?? ' ')
                  : ' ';
              const actual = cells[row * 3 + column];
              if (symbol === ' ' ? actual !== null : !sameItem(actual, symbols[symbol])) {
                match = false;
                break;
              }
            }
          }
          if (match) return true;
        }
      }
    }
  }
  return false;
}

function shapelessMatches(recipe, cells) {
  const actual = cells.filter(Boolean);
  const ingredients = recipe.expected.ingredients;
  if (actual.length !== ingredients.length) return false;
  const remaining = [...ingredients];
  const consume = (index) => {
    if (index === actual.length) return true;
    for (let i = 0; i < remaining.length; i += 1) {
      if (!sameItem(actual[index], remaining[i])) continue;
      const [matched] = remaining.splice(i, 1);
      if (consume(index + 1)) return true;
      remaining.splice(i, 0, matched);
    }
    return false;
  };
  return consume(0);
}

function matchingIds(cells) {
  return recipes
    .filter((recipe) =>
      recipe.expected.type === 'shapeless' ? shapelessMatches(recipe, cells) : shapedMatches(recipe, cells),
    )
    .map((recipe) => recipe.caseId);
}

function cellsForSlots(slots, label) {
  const cells = Array(9).fill(null);
  for (const slot of slots) {
    const index = slot.row * 3 + slot.column;
    if (index < 0 || index >= 9 || cells[index] !== null) throw new Error(`Invalid positive slots: ${label}`);
    cells[index] = { ...slot.item, metadata: slot.item.metadata === -1 ? 0 : slot.item.metadata };
  }
  return cells;
}

const contradictions = [];
const positiveCollisions = [];
let positiveControlsChecked = 0;
let negativeControlsChecked = 0;
let smeltingControlsChecked = 0;
for (const fixture of fixtures) {
  const cells = cellsForSlots(fixture.positive.inputSlots, fixture.caseId);
  const matches = matchingIds(cells);
  positiveControlsChecked++;
  if (!matches.includes(fixture.caseId)) contradictions.push({ caseId: fixture.caseId, control: 'positive', matches });
  if (matches.length > 1) positiveCollisions.push({ caseId: fixture.caseId, matches });

  const positiveControls = [];
  if (fixture.positive.type === 'SHAPED_CANONICAL') {
    const { width, height } = fixture.positive.grid;
    for (const [index, alternative] of fixture.positive.alternativeRegistrations.entries()) {
      positiveControls.push([`alternative-${index + 1}`, alternative.slots]);
    }
    if (fixture.positive.translationWithin3x3 && (width < 3 || height < 3)) {
      positiveControls.push([
        'translated-bottom-right',
        fixture.positive.inputSlots.map((slot) => ({
          ...slot,
          row: slot.row + 3 - height,
          column: slot.column + 3 - width,
        })),
      ]);
    }
    if (fixture.positive.horizontalMirror && width > 1) {
      positiveControls.push([
        'horizontal-mirror',
        fixture.positive.inputSlots.map((slot) => ({ ...slot, column: width - 1 - slot.column })),
      ]);
    }
  } else {
    positiveControls.push(['shapeless-reorder', fixture.positive.reorderedInputSlots]);
  }
  for (const [control, slots] of positiveControls) {
    const controlMatches = matchingIds(cellsForSlots(slots, `${fixture.caseId}/${control}`));
    positiveControlsChecked++;
    if (!controlMatches.includes(fixture.caseId))
      contradictions.push({ caseId: fixture.caseId, control, matches: controlMatches });
    if (controlMatches.length > 1)
      positiveCollisions.push({ caseId: fixture.caseId, control, matches: controlMatches });
  }

  const controls =
    fixture.positive.type === 'SHAPED_CANONICAL'
      ? [
          ['wrongItemId', fixture.negative.wrongItemId],
          ['extraOccupiedCell', fixture.negative.extraOccupiedCell],
          ['metadata', fixture.negative.metadata],
        ]
      : [
          ['extraIngredient', fixture.negative.extraIngredient],
          ['metadata', fixture.negative.metadata],
        ];
  for (const [name, control] of controls) {
    if (!control || control.status?.startsWith('GAP')) continue;
    negativeControlsChecked++;
    const mutated = cells.map((cell) => (cell ? { ...cell } : null));
    if (control.mutate) {
      const index = control.mutate.row * 3 + control.mutate.column;
      if (!mutated[index]) throw new Error(`Missing mutation target ${fixture.caseId}/${name}`);
      mutated[index][name === 'wrongItemId' ? 'id' : 'metadata'] = control.mutate.to;
    } else {
      const index = (control.cell ?? control.insert).row * 3 + (control.cell ?? control.insert).column;
      if (mutated[index]) throw new Error(`Extra cell overlaps ${fixture.caseId}/${name}`);
      mutated[index] = control.insert.item ?? control.insert;
    }
    const after = matchingIds(mutated);
    if (control.expect === 'no-output' && after.length) {
      const index = control.mutate
        ? control.mutate.row * 3 + control.mutate.column
        : (control.cell ?? control.insert).row * 3 + (control.cell ?? control.insert).column;
      const safeValues = (
        name === 'metadata' ? Array.from({ length: 16 }, (_, value) => value) : [1, 2, 3, 5, 17, 280, 336]
      )
        .filter((value) => value !== (name === 'metadata' ? control.mutate.from : cells[index]?.id))
        .filter((value) => {
          const trial = mutated.map((cell) => (cell ? { ...cell } : null));
          trial[index][name === 'metadata' ? 'metadata' : 'id'] = value;
          return matchingIds(trial).length === 0;
        });
      contradictions.push({ caseId: fixture.caseId, control: name, matches: after, safeValues });
    }
    if (control.expect === 'same-output') {
      const expected = fixture.positive.output;
      const sameOutput =
        after.length > 0 &&
        after.every((caseId) => {
          const output = recipesById.get(caseId).expected.output;
          return (
            output.id === expected.id &&
            (output.count ?? 1) === expected.count &&
            (output.metadata ?? 0) === expected.metadata
          );
        });
      if (!sameOutput || (control.matchedByCaseIdCandidate && !after.includes(control.matchedByCaseIdCandidate)))
        contradictions.push({ caseId: fixture.caseId, control: name, matches: after, expected });
    } else if (control.expect !== 'no-output') {
      throw new Error(`Unknown control expectation ${fixture.caseId}/${name}: ${control.expect}`);
    }
  }
}

for (const fixture of smeltingFixtures) {
  const source = smeltingById.get(fixture.caseId);
  if (!source) throw new Error(`Unknown smelting fixture ${fixture.caseId}`);
  const expected = source.expected;
  smeltingControlsChecked++;
  if (
    fixture.positive.inputSlot.id !== expected.input.id ||
    fixture.positive.output.id !== expected.output.id ||
    fixture.positive.output.metadata !== expected.output.metadata ||
    fixture.positive.output.count !== expected.output.count ||
    fixture.positive.cookTicks !== expected.cookTicks
  ) {
    contradictions.push({ caseId: fixture.caseId, control: 'smelting-positive-source-registration' });
  }
  smeltingControlsChecked++;
  if (smeltingRecipes.some((recipe) => recipe.expected.input.id === fixture.negative.wrongInputId.input.id)) {
    contradictions.push({
      caseId: fixture.caseId,
      control: 'wrongInputId',
      matches: fixture.negative.wrongInputId.input.id,
    });
  }
  smeltingControlsChecked++;
  if (fixture.negative.mismatchedOutputId.outputSlotBefore.id === expected.output.id) {
    contradictions.push({ caseId: fixture.caseId, control: 'mismatchedOutputId' });
  }
  smeltingControlsChecked++;
  const outputItem = catalog.cases.find((entry) => entry.kind === 'item' && entry.expected.id === expected.output.id);
  if (
    fixture.negative.fullOutputCapacity.outputSlotBefore.id !== expected.output.id ||
    fixture.negative.fullOutputCapacity.outputSlotBefore.count !==
      (outputItem?.expected.staticRegistration.stackLimit ?? 64)
  ) {
    contradictions.push({ caseId: fixture.caseId, control: 'fullOutputCapacity' });
  }
  smeltingControlsChecked++;
  if (
    !expected.input.metadataIgnoredByLookup ||
    fixture.negative.inputMetadata.input.id !== expected.input.id ||
    fixture.negative.inputMetadata.input.metadata !== 7
  ) {
    contradictions.push({ caseId: fixture.caseId, control: 'inputMetadata' });
  }
}

const result = {
  status:
    contradictions.length || positiveCollisions.length
      ? 'CANDIDATE_FIXTURE_CONTRADICTION'
      : 'INTERNAL_CONSISTENCY_ONLY',
  recipeCount: recipes.length + smeltingRecipes.length,
  fixtureCount: fixtures.length + smeltingFixtures.length,
  craftingCount: recipes.length,
  smeltingCount: smeltingRecipes.length,
  positiveControlsChecked,
  negativeControlsChecked,
  smeltingControlsChecked,
  sourceBindingsChecked,
  mappedExpectedPaths,
  unmappedExpectedPaths,
  positiveCollisions,
  contradictions,
};
console.log(JSON.stringify(result));
if (contradictions.length || positiveCollisions.length) process.exitCode = 1;
