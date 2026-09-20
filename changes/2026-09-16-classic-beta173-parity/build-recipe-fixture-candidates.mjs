import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recipeSourceBindings } from './recipe-source-bindings.mjs';

// This generator only derives executable-fixture candidates from the frozen
// reference-case candidate table. It neither downloads nor executes Minecraft.
const root = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(root, 'reference-cases.json');
const targetPath = join(root, 'recipe-fixture-candidates.json');
const recipeId = /^R-(?:D|H|S)\d{2}$/;

const item = (value) => ({
  id: value.id,
  count: value.count ?? 1,
  metadata: value.metadata ?? 0,
  metadataRule: value.metadata === -1 ? 'ANY_METADATA_RECONSTRUCTED_SOURCE' : 'EXACT_METADATA_RECONSTRUCTED_SOURCE',
});

function occupiedSlots(grid, symbols) {
  const slots = [];
  for (let row = 0; row < grid.length; row += 1) {
    for (let column = 0; column < grid[row].length; column += 1) {
      const symbol = grid[row][column];
      if (symbol !== ' ') slots.push({ row, column, symbol, item: item(symbols[symbol]) });
    }
  }
  return slots;
}

function firstEmptyCell(grid, width, height) {
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if (row >= grid.length || column >= grid[row].length || grid[row][column] === ' ') return { row, column };
    }
  }
  return null;
}

function metadataControl(slots, caseId) {
  const exact = slots.find((slot) => slot.item.metadata !== -1);
  if (exact) {
    // The two coal variants are separate registrations for the same torch
    // output. Changing 0 <-> 1 is therefore a positive metamorphic control.
    const torchCoalAlternative = { 'R-D26': 'R-D27', 'R-D27': 'R-D26' }[caseId];
    // Metadata 0 is itself a registered dye ingredient in these mixtures.
    // Brown dye (3) leaves the other ingredient fixed without matching any
    // registration in the full 150-recipe candidate table.
    const dyeMixture = new Set(['R-H61', 'R-H62', 'R-H66', 'R-H67', 'R-H68']).has(caseId);
    return {
      status: 'CANDIDATE',
      type: torchCoalAlternative ? 'ALTERNATE_EXACT_METADATA_SAME_OUTPUT' : 'WRONG_EXACT_METADATA_REJECTS',
      mutate: {
        row: exact.row,
        column: exact.column,
        from: exact.item.metadata,
        to: dyeMixture ? 3 : exact.item.metadata === 0 ? 1 : 0,
      },
      expect: torchCoalAlternative ? 'same-output' : 'no-output',
      ...(torchCoalAlternative ? { matchedByCaseIdCandidate: torchCoalAlternative } : {}),
    };
  }
  const wildcard = slots[0];
  return {
    status: 'CANDIDATE',
    type: 'NONDEFAULT_WILDCARD_METADATA_MATCHES',
    mutate: { row: wildcard.row, column: wildcard.column, from: -1, to: 7 },
    expect: 'same-output',
  };
}

function shapedFixture(caseEntry) {
  const expected = caseEntry.expected;
  const alternatives = expected.alternatives ?? [{ grid: expected.grid, symbols: expected.symbols }];
  const primary = alternatives[0];
  const width = Math.max(...primary.grid.map((row) => row.length));
  const height = primary.grid.length;
  const slots = occupiedSlots(primary.grid, primary.symbols);
  const first = slots[0];
  const extraCell = firstEmptyCell(primary.grid, 3, 3);
  const output = item(expected.output);
  return {
    caseId: caseEntry.caseId,
    kind: 'crafting',
    candidateStatus: 'SOURCE_CANDIDATE_NOT_DESIGN_FIXED',
    sourceClassification: caseEntry.review?.evidenceLevel ?? 'RECONSTRUCTED_SOURCE_CANDIDATE',
    sourceLinks: caseEntry.evidence,
    workstationCandidates: expected.workstations,
    positive: {
      type: 'SHAPED_CANONICAL',
      grid: { width, height, rows: primary.grid },
      inputSlots: slots,
      alternativeRegistrations: alternatives.slice(1).map((alternative) => ({
        grid: alternative.grid,
        slots: occupiedSlots(alternative.grid, alternative.symbols),
      })),
      output,
      quantity: {
        consumePerOccupiedCell: expected.consumePerOccupiedCell ?? 1,
        inputSlotCount: slots.length,
        outputCount: output.count,
      },
      horizontalMirror: expected.horizontalMirror === true,
      translationWithin3x3: expected.translationWithinGrid === true,
    },
    negative: {
      wrongItemId: {
        status: 'CANDIDATE',
        mutate: { row: first.row, column: first.column, from: first.item.id, to: first.item.id === 1 ? 2 : 1 },
        expect: 'no-output',
      },
      extraOccupiedCell: extraCell
        ? {
            status: 'CANDIDATE',
            cell: extraCell,
            // A third stone turns the pressure-plate input into stone slabs.
            insert: { id: caseEntry.caseId === 'R-D52' ? 2 : 1, count: 1, metadata: 0 },
            expect: 'no-output',
          }
        : {
            status: 'GAP_NO_EMPTY_CELL',
            reason: 'canonical 3x3 pattern fills every cell; use wrong-item or wrong-metadata control instead',
          },
      metadata: metadataControl(slots, caseEntry.caseId),
    },
    remainders: expected.remainders ?? [],
    gaps: ['OFFICIAL_JAR_METHOD_MAPPING_MISSING', 'FIXTURE_NOT_EXECUTED', 'NOT_A_DESIGN_FIXED_ASSERTION'],
  };
}

function shapelessFixture(caseEntry) {
  const expected = caseEntry.expected;
  const ingredients = expected.ingredients.map(item);
  const slots = ingredients.map((ingredient, index) => ({
    row: Math.floor(index / 3),
    column: index % 3,
    item: ingredient,
  }));
  const output = item(expected.output);
  return {
    caseId: caseEntry.caseId,
    kind: 'crafting',
    candidateStatus: 'SOURCE_CANDIDATE_NOT_DESIGN_FIXED',
    sourceClassification: caseEntry.review?.evidenceLevel ?? 'RECONSTRUCTED_SOURCE_CANDIDATE',
    sourceLinks: caseEntry.evidence,
    workstationCandidates: expected.workstations,
    positive: {
      type: 'SHAPELESS_EXACT_MULTISET',
      inputSlots: slots,
      reorderedInputSlots: slots.map((slot, index) => ({
        ...slot,
        item: ingredients[slots.length - 1 - index],
      })),
      output,
      quantity: {
        consumePerOccupiedCell: expected.consumePerOccupiedCell ?? 1,
        inputSlotCount: slots.length,
        outputCount: output.count,
      },
    },
    negative: {
      extraIngredient: {
        status: 'CANDIDATE',
        insert: { row: 2, column: 2, item: { id: 1, count: 1, metadata: 0 } },
        expect: 'no-output',
      },
      metadata: metadataControl(slots, caseEntry.caseId),
    },
    remainders: expected.remainders ?? [],
    gaps: ['OFFICIAL_JAR_METHOD_MAPPING_MISSING', 'FIXTURE_NOT_EXECUTED', 'NOT_A_DESIGN_FIXED_ASSERTION'],
  };
}

function smeltingFixture(caseEntry, itemStackLimits) {
  const expected = caseEntry.expected;
  const input = item(expected.input);
  const output = item(expected.output);
  return {
    caseId: caseEntry.caseId,
    kind: 'smelting',
    candidateStatus: 'SOURCE_CANDIDATE_NOT_DESIGN_FIXED',
    sourceClassification: caseEntry.review?.evidenceLevel ?? 'RECONSTRUCTED_PLUS_COMMUNITY_CANDIDATE',
    sourceLinks: caseEntry.evidence,
    workstationCandidates: ['furnace'],
    positive: {
      inputSlot: input,
      fuelSlot: {
        id: 263,
        count: 1,
        metadata: 0,
        rationale: 'coal is a 1600-tick candidate fuel; one item covers a 200-tick cook',
      },
      outputSlotBefore: null,
      output,
      cookTicks: expected.cookTicks,
      inputConsumption: expected.inputConsumption,
      fuelConsumption: 1,
      outputConstraint: 'same-id output stack with capacity remaining',
    },
    negative: {
      wrongInputId: { input: { id: input.id === 1 ? 2 : 1, count: 1, metadata: 0 }, expect: 'does-not-smelt' },
      mismatchedOutputId: {
        outputSlotBefore: { id: output.id === 1 ? 2 : 1, count: 1, metadata: 0 },
        expect: 'does-not-smelt',
      },
      fullOutputCapacity: {
        outputSlotBefore: { ...output, count: itemStackLimits.get(output.id) ?? 64 },
        expect: 'does-not-smelt',
      },
      inputMetadata: { input: { ...input, metadata: 7 }, expect: 'same-output-by-id-lookup' },
    },
    fuelRemainderCandidates: [
      { fuel: { id: 263, count: 1, metadata: 0 }, burnTicks: 1600, remainder: [], status: 'SOURCE_CANDIDATE' },
      {
        fuel: { id: 327, count: 1, metadata: 0 },
        burnTicks: 20000,
        remainder: [],
        status: 'SOURCE_CANDIDATE_NO_EMPTY_BUCKET_RETURN',
      },
    ],
    gaps: ['OFFICIAL_JAR_METHOD_MAPPING_MISSING', 'FIXTURE_NOT_EXECUTED', 'NOT_A_DESIGN_FIXED_ASSERTION'],
  };
}

const source = JSON.parse(await readFile(sourcePath, 'utf8'));
const profile = JSON.parse(await readFile(join(root, 'harness-profile.json'), 'utf8'));
if (source.referenceCaseSetVersion !== profile.referenceCaseSetVersion) throw new Error('Profile/case version drift');
const recipeCases = source.cases.filter((caseEntry) => recipeId.test(caseEntry.caseId));
if (recipeCases.length !== 160) throw new Error(`Expected 160 recipe cases, got ${recipeCases.length}`);
const itemStackLimits = new Map(
  source.cases
    .filter((caseEntry) => caseEntry.kind === 'item')
    .map((caseEntry) => [caseEntry.expected.id, caseEntry.expected.staticRegistration.stackLimit]),
);

const fixtures = recipeCases.map((caseEntry) => {
  const fixture =
    caseEntry.kind === 'smelting'
      ? smeltingFixture(caseEntry, itemStackLimits)
      : caseEntry.expected.type === 'shapeless'
        ? shapelessFixture(caseEntry)
        : shapedFixture(caseEntry);
  return { ...fixture, ...recipeSourceBindings(caseEntry) };
});
const counts = {
  total: fixtures.length,
  crafting: fixtures.filter((fixture) => fixture.kind === 'crafting').length,
  shaped: fixtures.filter((fixture) => fixture.positive.type === 'SHAPED_CANONICAL').length,
  shapeless: fixtures.filter((fixture) => fixture.positive.type === 'SHAPELESS_EXACT_MULTISET').length,
  smelting: fixtures.filter((fixture) => fixture.kind === 'smelting').length,
  withRemainders: fixtures.filter((fixture) => fixture.remainders?.length > 0).length,
  explicitGapPerCase: fixtures.filter((fixture) => fixture.gaps.length > 0).length,
  sourceBindings: fixtures.reduce((sum, fixture) => sum + fixture.candidateSourceBindings.length, 0),
  mappedExpectedPaths: fixtures.reduce(
    (sum, fixture) =>
      sum + fixture.candidateSourceBindings.reduce((count, binding) => count + binding.supportedExpectedPaths.length, 0),
    0,
  ),
  unmappedExpectedPaths: fixtures.reduce((sum, fixture) => sum + fixture.unmappedExpectedPaths.length, 0),
};
const output = {
  schemaVersion: 3,
  sourceCaseSet: {
    profileId: profile.profileId,
    scenarioVersion: profile.scenarioVersion,
    referenceCaseSetVersion: source.referenceCaseSetVersion,
  },
  generatedBy: 'build-recipe-fixture-candidates.mjs',
  candidateOnly: true,
  provenance: 'RECONSTRUCTED_SOURCE_CANDIDATE_NOT_OFFICIAL_JAR_TRUTH',
  counts,
  fixtures,
};
await writeFile(targetPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(counts));
