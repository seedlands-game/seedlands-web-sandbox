import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(path, 'utf8');

const voxelMaterials = source('apps/web/src/app/scene/voxel-materials.ts');
const entityPresenter = source('apps/web/src/app/gameplay/gameplay-entity-presenter.ts');
const firstPersonViewmodel = source('apps/web/src/app/player/first-person-viewmodel.ts');
const modelLighting = source('apps/web/src/app/scene/model-surface-lighting.ts');
const worldLighting = source('apps/web/src/app/scene/world-surface-lighting.ts');
const visualEffects = source('apps/web/src/app/scene/advanced-visual-effects.ts');
const qualityBudget = source('apps/web/src/app/scene/advanced-lighting-budget.ts');

describe('STATIC_RED_ONLY：统一表面受光接线合同', () => {
  it.each([
    { consumer: 'terrain', source: voxelMaterials, markers: ['voxelReceivedLightingGlsl', "set('lightmapPS'"] },
    { consumer: 'water', source: voxelMaterials, markers: ['voxelReceivedLightingGlsl', "set('lightmapPS'"] },
    {
      consumer: 'actor',
      source: entityPresenter,
      markers: ['SurfaceLightingSampler', 'ModelSurfaceLighting', 'surfaceLighting.apply'],
    },
    {
      consumer: 'world-item',
      source: entityPresenter,
      markers: ['SurfaceLightingSampler', 'ModelSurfaceLighting', 'surfaceLighting.apply'],
    },
    {
      consumer: 'viewmodel',
      source: firstPersonViewmodel,
      markers: ['SurfaceLightingSampler', 'ModelSurfaceLighting', 'surfaceLighting.apply'],
    },
  ])('$consumer 消费同一 received-lighting 语义', ({ source: consumerSource, markers }) => {
    for (const marker of markers) expect(consumerSource).toContain(marker);
  });

  it('实际模型helper消费统一sample、World使用同环境frame而不把block加入emission', () => {
    expect(modelLighting).toContain('applySurfaceLightingToMaterial');
    expect(modelLighting).toContain('this.sample(position, this.lighting.selfEmission(active))');
    expect(worldLighting).toContain('createSurfaceLightingSample');
    expect(worldLighting).toContain('skyVisibility: sky?.ready');
    expect(worldLighting).toContain('skyRadiance: frame.skyRadiance');
    expect(entityPresenter).not.toContain('blockLight * 0.72');
  });

  it('质量预算不选择 tone mapper', () => {
    const selection = visualEffects.match(/camera\.camera\.toneMapping\s*=([\s\S]*?);/)?.[1] ?? '';
    expect(selection).not.toContain('budget.');
    expect(qualityBudget).not.toMatch(/tone.?map/i);
  });
});
