import { describe, expect, it } from 'vitest';
import { definePack, defineContentModule, type ModModule } from '@seedlands/stdlib/mod-api';
import { assembleWorldPacks, gameplayContentForComposition } from '@seedlands/stdlib/host';

function assemble(modules: readonly ModModule[]) {
  const pack = definePack({ id: 'test:playbook', kind: 'playbook', version: '1.0.0', modules });
  return assembleWorldPacks([
    {
      ...pack,
      integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
    },
  ]);
}

describe('registered content provider', () => {
  it('resolves later extension items and recipes into one world registry with explicit storage aliases', () => {
    const composition = assemble([
      defineContentModule({
        moduleId: 'test:content',
        items: [
          { id: 'test:wood', storageId: 'wood', name: 'Wood', itemType: 'resource', stackLimit: 64, capabilities: [] },
        ],
        meleeDefinitions: [],
      }),
      {
        descriptor: { id: 'test:extension', version: '1.0.0', requires: [{ id: 'seedlands:items', version: '1.0.0' }] },
        register(api) {
          api.registerItem({ id: 'test:plank', name: 'Plank', itemType: 'resource', stackLimit: 16, capabilities: [] });
          api.registerRecipe({
            id: 'test:planks',
            inputs: [{ itemId: 'test:wood', count: 1 }],
            outputs: [{ itemId: 'test:plank', count: 4 }],
          });
        },
      },
    ]);
    const content = gameplayContentForComposition(composition);
    expect(content.items.require('wood').name).toBe('Wood');
    expect(content.items.require('test:plank').stackLimit).toBe(16);
    expect(content.recipes.get('test:planks')?.inputs).toEqual([{ itemId: 'wood', count: 1 }]);
    expect(gameplayContentForComposition(composition)).toBe(content);
    expect(composition.definitionMap.items).toContainEqual({ id: 'test:wood', storageId: 'wood' });
  });

  it('rejects ambiguous storage IDs and registry access during registration', () => {
    expect(() =>
      assemble([
        defineContentModule({
          moduleId: 'test:content',
          items: [
            { id: 'test:a', storageId: 'same', name: 'A', itemType: 'resource', stackLimit: 1, capabilities: [] },
            { id: 'test:b', storageId: 'same', name: 'B', itemType: 'resource', stackLimit: 1, capabilities: [] },
          ],
          meleeDefinitions: [],
        }),
      ]),
    ).toThrow(/storage/i);
  });
});
