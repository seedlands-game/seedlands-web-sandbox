import { expect, it } from 'vitest';
import {
  createGameplayContent,
  resolveGameplayContent,
} from '../../packages/game-core/src/server/gameplay/gameplay-content';
import type { StationContentInput } from '../../packages/game-core/src/server/gameplay/station-content';

const definitions = [
  { id: 'test:tool', name: 'Tool', itemType: 'tool' as const, stackLimit: 1, durability: { max: 8 }, capabilities: [] },
];
const stations = (): StationContentInput => ({
  definitions: [{ kind: 'workbench', voxel: 11 }],
  recipes: [
    {
      kind: 'shapeless',
      id: 'test:repair',
      inputs: [{ itemId: 'test:tool', count: 1, instance: { durability: 2 } }],
      outputs: [{ itemId: 'test:tool', count: 1, instance: { durability: 8 } }],
    },
  ],
  furnaceRecipes: [],
  fuels: [],
});

it('creates an isolated frozen station catalogue using the owning world items', () => {
  const source = stations();
  const world = createGameplayContent({ items: definitions, recipes: [], meleeDefinitions: [], stations: source });
  expect(world.stations).toBeDefined();
  expect(world.stations!.codec.items).toBe(world.items);
  expect(resolveGameplayContent(world).stations).toBe(world.stations);
  const output = source.recipes[0]!.outputs[0]!;
  Object.assign(output.instance!, { durability: 3 });
  expect(world.stations!.recipe('test:repair')!.outputs[0]!.instance).toEqual({ durability: 8 });
  expect(Object.isFrozen(world.stations!.recipe('test:repair')!.outputs[0]!.instance)).toBe(true);
  const other = createGameplayContent({ items: definitions, recipes: [], meleeDefinitions: [] });
  expect(other.stations).toBeUndefined();
  expect(() => resolveGameplayContent({ ...other, stations: world.stations })).toThrow(/registry/);
});

it.each(['empty', 'duplicate', 'missing-instance'] as const)(
  'rejects %s station recipe before world activation',
  (bad) => {
    const source = stations();
    const recipe = source.recipes[0]!;
    const malformed =
      bad === 'empty'
        ? { ...recipe, inputs: [] }
        : bad === 'missing-instance'
          ? { ...recipe, outputs: [{ itemId: 'test:tool', count: 1 }] }
          : recipe;
    expect(() =>
      createGameplayContent({
        items: definitions,
        recipes: [],
        meleeDefinitions: [],
        stations: { ...source, recipes: bad === 'duplicate' ? [recipe, recipe] : [malformed] },
      }),
    ).toThrow();
  },
);

it('resolves station storage aliases through public Pack assembly', async () => {
  const { defineContentModule, definePack } = await import('@seedlands/game-core/mod-api');
  const { assembleWorldPacks, gameplayContentForComposition } =
    await import('@seedlands/game-core/server/composition/host-api');
  const pack = definePack({
    id: 'test:stations',
    kind: 'playbook',
    version: '1.0.0',
    modules: [
      defineContentModule({
        moduleId: 'test:content',
        items: definitions.map((item) => ({ ...item, storageId: 'stored-tool' })),
        meleeDefinitions: [],
        stations: stations(),
      }),
    ],
  });
  const composition = assembleWorldPacks([
    {
      ...pack,
      integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
    },
  ]);
  const content = gameplayContentForComposition(composition);
  expect(content.stations!.recipe('test:repair')!.outputs[0]).toEqual({
    itemId: 'stored-tool',
    count: 1,
    instance: { durability: 8 },
  });
});
