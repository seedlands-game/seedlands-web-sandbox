import { expectedLeafPaths } from './verify-design-ready.mjs';

const craftingRules = [
  {
    evidenceIndex: 0,
    keys: ['type', 'output', 'grid', 'symbols', 'alternatives', 'ingredients'],
    methodOrSection: 'registered shaped/shapeless recipe and ingredients',
  },
  {
    evidenceIndex: 1,
    keys: ['horizontalMirror', 'translationWithinGrid', 'extraOccupiedCellsAccepted', 'exactInputMultisetOrShape'],
    methodOrSection: 'shaped/shapeless recipe matching',
  },
  {
    evidenceIndex: 2,
    keys: ['consumePerOccupiedCell'],
    methodOrSection: 'SlotCrafting output claim and material consumption',
  },
];
const smeltingRules = [
  { evidenceIndex: 0, keys: ['input', 'output'], methodOrSection: 'FurnaceRecipes input/output registration' },
  {
    evidenceIndex: 1,
    keys: ['cookTicks', 'inputConsumption', 'outputRequiresMatchingIdAndAvailableStackCapacity'],
    methodOrSection: 'TileEntityFurnace update/canSmelt/smeltItem',
  },
];

export function recipeSourceBindings(caseEntry) {
  if (!['crafting', 'smelting'].includes(caseEntry.kind)) throw new Error(`Not a recipe: ${caseEntry.caseId}`);
  const paths = expectedLeafPaths(caseEntry.expected);
  const rules = caseEntry.kind === 'crafting' ? craftingRules : smeltingRules;
  const directBindings = rules
    .map((rule) => {
      const evidence = caseEntry.evidence[rule.evidenceIndex];
      if (!evidence?.uri) throw new Error(`Missing recipe source ${caseEntry.caseId} ${rule.evidenceIndex}`);
      return {
        uri: evidence.uri,
        methodOrSection: rule.methodOrSection,
        supportedExpectedPaths: paths.filter((path) => rule.keys.includes(path.split('/')[1])),
        evidenceLevel: 'RECONSTRUCTED_SOURCE_CANDIDATE_NOT_REVIEWED',
      };
    })
    .filter((binding) => binding.supportedExpectedPaths.length);
  const workstationBindings =
    caseEntry.kind === 'crafting'
      ? caseEntry.expected.workstations.map((workstation, index) => {
          const evidenceIndex =
            workstation === 'inventory-2x2' ? 3 : workstation === 'crafting-table-3x3' ? 4 : -1;
          const evidence = caseEntry.evidence[evidenceIndex];
          if (!evidence?.uri) throw new Error(`Missing workstation source ${caseEntry.caseId} ${workstation}`);
          return {
            uri: evidence.uri,
            methodOrSection: `${workstation} matrix capacity and shared recipe lookup; jointly review recipe shape and matcher`,
            supportedExpectedPaths: [`/workstations/${index}`],
            evidenceLevel: 'RECONSTRUCTED_COMPOSITE_SOURCE_CANDIDATE_NOT_REVIEWED',
          };
        })
      : [];
  const bindings = [...directBindings, ...workstationBindings];
  const mapped = new Set(bindings.flatMap((binding) => binding.supportedExpectedPaths));
  return {
    candidateSourceBindings: bindings,
    unmappedExpectedPaths: paths.filter((path) => !mapped.has(path)),
    sourceBindingReview: 'PENDING',
  };
}
