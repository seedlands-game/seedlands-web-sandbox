import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(path, 'utf8');

const voxelMaterials = source('apps/web/src/app/scene/voxel-materials.ts');
const entityPresenter = source('apps/web/src/app/gameplay/gameplay-entity-presenter.ts');
const firstPersonViewmodel = source('apps/web/src/app/player/first-person-viewmodel.ts');
const visualEffects = source('apps/web/src/app/scene/advanced-visual-effects.ts');
const qualityBudget = source('apps/web/src/app/scene/advanced-lighting-budget.ts');

describe('STATIC_RED_ONLY：统一表面受光接线合同', () => {
  it.each([
    { consumer: 'terrain', source: voxelMaterials, markers: ['voxelReceivedLightingGlsl', "set('lightmapPS'"] },
    { consumer: 'water', source: voxelMaterials, markers: ['voxelReceivedLightingGlsl', "set('lightmapPS'"] },
    {
      consumer: 'actor',
      source: entityPresenter,
      markers: ['SurfaceLightingSample', 'applySurfaceLightingToMaterial'],
    },
    {
      consumer: 'world-item',
      source: entityPresenter,
      markers: ['SurfaceLightingSample', 'applySurfaceLightingToMaterial'],
    },
    {
      consumer: 'viewmodel',
      source: firstPersonViewmodel,
      markers: ['SurfaceLightingSample', 'applySurfaceLightingToMaterial'],
    },
  ])('$consumer 消费同一 received-lighting 语义', ({ source: consumerSource, markers }) => {
    for (const marker of markers) expect(consumerSource).toContain(marker);
  });

  it('质量预算不选择 tone mapper', () => {
    const selection = visualEffects.match(/camera\.camera\.toneMapping\s*=([\s\S]*?);/)?.[1] ?? '';
    expect(selection).not.toContain('budget.');
    expect(qualityBudget).not.toMatch(/tone.?map/i);
  });
});
