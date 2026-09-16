import { describe, expect, it } from 'vitest';
import { pack } from '../src/pack';
import { overworldItems } from '../src/items';
import { overworldRecipes } from '../src/recipes';

describe('Classic persisted content identity', () => {
  it('preserves the frozen playbook identity and storage item vocabulary', () => {
    expect(pack.manifest).toMatchObject({ id: 'seedlands:overworld', version: '1.0.0', kind: 'playbook' });
    const ids = overworldItems.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['berry', 'wood-block', 'wood-axe', 'iron-ingot']));
  });

  it('keeps every recipe input and output inside its content registry', () => {
    const ids = new Set(overworldItems.map((item) => item.id));
    expect(overworldRecipes.length).toBeGreaterThan(0);
    for (const recipe of overworldRecipes)
      for (const stack of [...recipe.inputs, ...recipe.outputs]) expect(ids.has(stack.itemId)).toBe(true);
  });
});
