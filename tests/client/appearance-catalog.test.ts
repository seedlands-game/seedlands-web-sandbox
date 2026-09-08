import { describe, expect, it } from 'vitest';
import { builtinAssets } from '../../src/client/presentation/asset-catalog';
import { appearanceObjects, assetCategory, materialSlots } from '../../src/client/presentation/appearance-catalog';

describe('appearance navigation', () => {
  it('projects every source into semantic resource categories without changing identities', () => {
    expect(new Set(builtinAssets.map(assetCategory))).toEqual(new Set(['model', 'material', 'image']));
    expect(builtinAssets).toHaveLength(108);
  });
  it('groups the placed lantern and its item contexts in one appearance', () => {
    const lantern = appearanceObjects(builtinAssets).find((entry) => entry.id === 'builtin:model:lantern')!;
    expect(lantern.contexts.map((context) => context.name)).toEqual(['模型', '放置', '手持', '掉落']);
    expect(lantern.contexts.find((context) => context.name === '放置')?.assetId).toContain('voxel/');
    expect(appearanceObjects(builtinAssets).filter((entry) => entry.name === '灯笼')).toHaveLength(1);
  });
  it('resolves material slots without navigating away from the model', () => {
    const model = builtinAssets.find((asset) => asset.id === 'builtin:model:lantern')!;
    expect(materialSlots(model, builtinAssets).length).toBeGreaterThan(0);
  });
});
